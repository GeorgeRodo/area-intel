-- 0002_security.sql
-- The review-gate invariant, enforced by the database:
--   * no client role can INSERT/UPDATE knowledge_nodes directly
--   * the ONLY path from finding -> verified node is promote_finding(),
--     a security-definer function that checks the caller is a reviewer
-- The Python worker connects as the table owner (direct connection string)
-- and bypasses RLS by ownership; browser clients go through anon/authenticated.

-- ---------- helper ----------
create or replace function public.is_reviewer()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'reviewer'
  );
$$;

-- ---------- RLS ----------
alter table municipalities   enable row level security;
alter table sources          enable row level security;
alter table knowledge_nodes  enable row level security;
alter table citations        enable row level security;
alter table edges            enable row level security;
alter table research_tasks   enable row level security;
alter table findings         enable row level security;
alter table profiles         enable row level security;

-- municipalities: public read
create policy muni_read on municipalities for select using (true);

-- knowledge_nodes: readers see verified/stale; reviewers see everything.
-- No insert/update/delete policies exist => denied for all client roles.
create policy nodes_read on knowledge_nodes for select
  using (status in ('verified','stale') or is_reviewer());

-- citations/sources: readable when their node is readable (citations only ever
-- attach to promoted nodes, but keep the join constraint explicit)
create policy citations_read on citations for select
  using (exists (select 1 from knowledge_nodes n
                 where n.id = node_id
                   and (n.status in ('verified','stale') or is_reviewer())));
create policy sources_read on sources for select using (true);

-- edges: readable when both endpoints are readable
create policy edges_read on edges for select
  using (exists (select 1 from knowledge_nodes a where a.id = src_node_id
                   and (a.status in ('verified','stale') or is_reviewer()))
     and exists (select 1 from knowledge_nodes b where b.id = dst_node_id
                   and (b.status in ('verified','stale') or is_reviewer())));

-- research_tasks: anyone signed-in (or anon, pilot mode) may ask; you see your
-- own tasks, reviewers see all
create policy tasks_insert on research_tasks for insert
  with check (municipality_id is not null and length(question) between 5 and 2000);
create policy tasks_read on research_tasks for select
  using (requester = auth.uid() or requester is null or is_reviewer());

-- findings: reviewers only, read-only from the client side
create policy findings_read on findings for select using (is_reviewer());

-- profiles: you can read your own profile; reviewers can read all.
-- Role changes only via service role (no update policy for clients).
create policy profiles_read on profiles for select
  using (id = auth.uid() or is_reviewer());

-- ---------- the gate: promotion RPCs ----------
create or replace function public.promote_finding(
  p_finding_id integer,
  p_tier text,
  p_title text default null,
  p_body text default null,
  p_category text default null
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  f findings%rowtype;
  v_task research_tasks%rowtype;
  v_reviewer text;
  v_node_id integer;
  v_source_id integer;
begin
  if not is_reviewer() then
    raise exception 'reviewer role required';
  end if;
  if p_tier not in ('A','B','C','D') then
    raise exception 'invalid tier %', p_tier;
  end if;

  select * into f from findings where id = p_finding_id for update;
  if not found or f.review_status <> 'pending' then
    raise exception 'finding not found or already reviewed';
  end if;
  select * into v_task from research_tasks where id = f.task_id;
  select display_name into v_reviewer from profiles where id = auth.uid();

  insert into knowledge_nodes
    (municipality_id, category, title, body, tier, status, as_of,
     verified_by, verified_at, created_by)
  values
    (v_task.municipality_id,
     coalesce(p_category, f.category),
     coalesce(p_title, f.title),
     coalesce(p_body, f.body),
     p_tier, 'verified', current_date,
     v_reviewer, now(), 'agent')
  returning id into v_node_id;

  if f.source_name is not null and f.source_name <> '' then
    select id into v_source_id from sources where name = f.source_name limit 1;
    if v_source_id is null then
      insert into sources (name, url, kind) values (f.source_name, f.source_url, 'agent')
      returning id into v_source_id;
    end if;
    insert into citations (node_id, source_id, quote_or_ref)
    values (v_node_id, v_source_id, coalesce(f.source_url, ''));
  end if;

  update findings set
    review_status = case when p_title is not null or p_body is not null
                         then 'edited' else 'approved' end,
    reviewed_by = v_reviewer,
    promoted_node_id = v_node_id
  where id = p_finding_id;

  return v_node_id;
end $$;

create or replace function public.reject_finding(p_finding_id integer, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_reviewer text;
begin
  if not is_reviewer() then raise exception 'reviewer role required'; end if;
  if coalesce(length(p_note),0) < 3 then raise exception 'rejection note required'; end if;
  select display_name into v_reviewer from profiles where id = auth.uid();
  update findings set review_status='rejected', review_note=p_note, reviewed_by=v_reviewer
  where id = p_finding_id and review_status = 'pending';
  if not found then raise exception 'finding not found or already reviewed'; end if;
end $$;

-- ---------- read models ----------
-- Freshness windows live here, in one place (mirrors db/models.py FRESHNESS_DAYS)
create or replace function public.freshness_days(p_category text)
returns integer language sql immutable as $$
  select case p_category
    when 'market' then 90 when 'financing' then 90 when 'liquidity' then 90
    when 'enforcement' then 120
    when 'regulatory' then 180 when 'tax' then 180 when 'esg' then 180
    when 'infrastructure' then 180
    else 365 end;
$$;

create or replace view public.nodes_view
with (security_invoker = true) as
select
  n.*,
  (current_date <= n.as_of + freshness_days(n.category)) as fresh,
  coalesce(
    (select jsonb_agg(jsonb_build_object('name', s.name, 'url', s.url))
     from citations c join sources s on s.id = c.source_id
     where c.node_id = n.id),
    '[]'::jsonb) as src_list
from knowledge_nodes n;

create or replace view public.edges_view
with (security_invoker = true) as
select e.relation, e.note,
  jsonb_build_object('id', a.id, 'title', a.title) as src,
  jsonb_build_object('id', b.id, 'title', b.title) as dst,
  a.municipality_id
from edges e
join knowledge_nodes a on a.id = e.src_node_id
join knowledge_nodes b on b.id = e.dst_node_id;

create or replace function public.coverage(p_muni_id integer)
returns table (category text, verified_fresh bigint, total bigint,
               best_tier text, latest_as_of date)
language sql stable security invoker as $$
  with cats(category) as (
    values ('market'),('regulatory'),('enforcement'),('physical'),('financing'),
           ('condo'),('tax'),('liquidity'),('professionals'),('operational'),
           ('esg'),('infrastructure')
  )
  select c.category,
    count(n.id) filter (where n.status='verified'
      and current_date <= n.as_of + freshness_days(n.category)),
    count(n.id) filter (where n.status in ('verified','stale')),
    min(n.tier) filter (where n.status='verified'
      and current_date <= n.as_of + freshness_days(n.category)),
    max(n.as_of) filter (where n.status in ('verified','stale'))
  from cats c
  left join knowledge_nodes n
    on n.category = c.category and n.municipality_id = p_muni_id
  group by c.category;
$$;

-- ---------- realtime (review queue live updates) ----------
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table findings;
  end if;
end $$;

-- ---------- grants ----------
grant usage on schema public to anon, authenticated;
grant select on municipalities, sources, knowledge_nodes, citations, edges,
             research_tasks, findings, profiles, nodes_view, edges_view
  to anon, authenticated;
grant insert on research_tasks to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
grant execute on function is_reviewer(), coverage(integer), freshness_days(text)
  to anon, authenticated;
grant execute on function promote_finding(integer,text,text,text,text),
                          reject_finding(integer,text)
  to authenticated;
