-- 0005_invite_only_access.sql
--
-- Turns the pilot's open posture into a closed one, in three moves:
--
--   1. Signup becomes invite-only. handle_new_user() previously created a
--      profile for anyone who reached auth.users; now an uninvited signup
--      aborts the transaction, so the account is never created at all.
--
--   2. Reading the knowledge base requires a session. The anon key is shipped
--      in the browser bundle and is therefore public: with `using (true)` on
--      municipalities and no auth check on nodes_read, anyone holding that key
--      could read every verified claim straight off the REST endpoint. The
--      React <Gate> is a client-side control and never protected this.
--
--   3. Asking becomes an authenticated action. research_tasks previously took
--      inserts from anon, and worker.py turns those rows into LLM agent runs —
--      an unmetered spend vector open to anyone who could reach the API.
--
-- Roles remain service-role-only to change (no client UPDATE policy on
-- profiles, by design): the Supabase table editor is the admin path.

-- ---------- 1. the invite list ----------

create table invited_emails (
  email      text primary key,
  role       text not null default 'user' check (role in ('user','admin')),
  invited_by uuid references profiles(id),
  invited_at timestamptz not null default now(),
  claimed_at timestamptz
);

comment on table invited_emails is
  'Allowlist consulted by handle_new_user(). A row must exist before the '
  'account can be created — including accounts made from the Supabase '
  'dashboard. Service role writes only.';

alter table invited_emails enable row level security;

-- Admins can see who has been invited and whether they have signed up.
-- No insert/update/delete policy: issuing an invite is a service-role action.
create policy invites_read on invited_emails for select using (is_admin());

create index idx_invites_unclaimed on invited_emails (email) where claimed_at is null;

-- ---------- 2. invite-only signup ----------

-- Raising here rolls back the auth.users insert, so a rejected signup leaves
-- no orphan account behind. The invite also carries the role, which is what
-- lets you provision an admin without a second table-editor step afterwards.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_invite invited_emails%rowtype;
begin
  select * into v_invite
  from invited_emails
  where lower(email) = lower(new.email)
    and claimed_at is null;

  if not found then
    raise exception 'signup is invite-only: % is not on the invite list', new.email
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.profiles (id, role, display_name)
  values (
    new.id,
    v_invite.role,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1))
  );

  update invited_emails
  set claimed_at = now()
  where email = v_invite.email;

  return new;
end $$;

-- ---------- 3. bootstrap ----------
-- The trigger above has no exception for the first account, so the first
-- invite has to be seeded here. EDIT THIS EMAIL before applying, then create
-- the account through Supabase Auth using the same address.
insert into invited_emails (email, role)
values ('admin@areaintel.pt', 'admin')
on conflict (email) do nothing;

-- ---------- 4. reading requires a session ----------

drop policy muni_read on municipalities;
create policy muni_read on municipalities for select
  using (auth.uid() is not null);

drop policy sources_read on sources;
create policy sources_read on sources for select
  using (auth.uid() is not null);

drop policy nodes_read on knowledge_nodes;
create policy nodes_read on knowledge_nodes for select
  using (auth.uid() is not null and (status in ('verified','stale') or is_admin()));

drop policy citations_read on citations;
create policy citations_read on citations for select
  using (auth.uid() is not null
         and exists (select 1 from knowledge_nodes n
                     where n.id = node_id
                       and (n.status in ('verified','stale') or is_admin())));

drop policy edges_read on edges;
create policy edges_read on edges for select
  using (auth.uid() is not null
     and exists (select 1 from knowledge_nodes a where a.id = src_node_id
                   and (a.status in ('verified','stale') or is_admin()))
     and exists (select 1 from knowledge_nodes b where b.id = dst_node_id
                   and (b.status in ('verified','stale') or is_admin())));

-- ---------- 5. asking requires a session ----------

-- requester defaults to auth.uid(); pinning it in the check stops a client
-- from filing a question under someone else's id.
drop policy tasks_insert on research_tasks;
create policy tasks_insert on research_tasks for insert
  with check (auth.uid() is not null
              and requester = auth.uid()
              and municipality_id is not null
              and length(question) between 5 and 2000);

-- `requester is null` used to make every anonymous question readable by every
-- signed-in user. With anon inserts gone, those rows should not exist; drop
-- the clause so any legacy ones stay admin-only.
drop policy tasks_read on research_tasks;
create policy tasks_read on research_tasks for select
  using (requester = auth.uid() or is_admin());

-- ---------- 6. take the anon role off the table ----------
-- Belt and braces: the policies above already fail closed without a session,
-- but revoking the grants means an un-authenticated request is refused at the
-- privilege layer rather than quietly returning an empty set.

revoke select on municipalities, sources, knowledge_nodes, citations, edges,
                 research_tasks, findings, profiles, nodes_view, edges_view
  from anon;
revoke insert on research_tasks from anon;
revoke execute on function coverage(integer), freshness_days(text) from anon;
revoke usage, select on all sequences in schema public from anon;
