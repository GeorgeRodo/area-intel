-- 0004_admin_user_roles.sql
-- Renames the role vocabulary from reader/reviewer to user/admin.
-- 'admin' = manages the knowledge base (review queue, promote/reject findings,
-- mission-control run-now). 'user' = consumes the app (ask, briefs, areas).
-- Behavior is unchanged; only names change, so is_reviewer() becomes
-- is_admin() and every RLS policy/RPC that called it is repointed.

alter table profiles drop constraint profiles_role_check;
update profiles set role = 'user' where role = 'reader';
update profiles set role = 'admin' where role = 'reviewer';
alter table profiles add constraint profiles_role_check
  check (role in ('user','admin'));
alter table profiles alter column role set default 'user';

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- knowledge_nodes / citations / edges: re-create using is_admin()
drop policy nodes_read on knowledge_nodes;
create policy nodes_read on knowledge_nodes for select
  using (status in ('verified','stale') or is_admin());

drop policy citations_read on citations;
create policy citations_read on citations for select
  using (exists (select 1 from knowledge_nodes n
                 where n.id = node_id
                   and (n.status in ('verified','stale') or is_admin())));

drop policy edges_read on edges;
create policy edges_read on edges for select
  using (exists (select 1 from knowledge_nodes a where a.id = src_node_id
                   and (a.status in ('verified','stale') or is_admin()))
     and exists (select 1 from knowledge_nodes b where b.id = dst_node_id
                   and (b.status in ('verified','stale') or is_admin())));

drop policy tasks_read on research_tasks;
create policy tasks_read on research_tasks for select
  using (requester = auth.uid() or requester is null or is_admin());

drop policy findings_read on findings;
create policy findings_read on findings for select using (is_admin());

drop policy profiles_read on profiles;
create policy profiles_read on profiles for select
  using (id = auth.uid() or is_admin());

drop policy cmd_read on routine_commands;
create policy cmd_read on routine_commands for select using (is_admin());
drop policy cmd_insert on routine_commands;
create policy cmd_insert on routine_commands for insert
  with check (is_admin());

-- ---------- promotion RPCs: swap is_reviewer() -> is_admin() ----------
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
  if not is_admin() then
    raise exception 'admin role required';
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
  if not is_admin() then raise exception 'admin role required'; end if;
  if coalesce(length(p_note),0) < 3 then raise exception 'rejection note required'; end if;
  select display_name into v_reviewer from profiles where id = auth.uid();
  update findings set review_status='rejected', review_note=p_note, reviewed_by=v_reviewer
  where id = p_finding_id and review_status = 'pending';
  if not found then raise exception 'finding not found or already reviewed'; end if;
end $$;

drop function if exists public.is_reviewer();

grant execute on function is_admin() to anon, authenticated;
