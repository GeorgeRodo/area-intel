-- 0006_audit_and_admin_rpcs.sql
--
-- Gives admins the maintenance paths they have been missing, without breaking
-- the invariant that makes the product worth anything: no client role writes
-- to knowledge_nodes directly. Every mutation here goes through a security
-- definer function that checks is_admin() and records who did it, to what,
-- from what, and why.
--
--   * audit_log        — append-only record of admin mutations
--   * retier_node      — change a claim's reliability tier
--   * set_node_status  — retire/restore a claim (no hard delete; see below)
--   * invite_user      — issue an invite (0005 left this service-role only)
--   * revoke_invite    — withdraw an unclaimed invite
--
-- Deliberately NOT here: a delete_node(). The product's whole claim is
-- provenance, so a claim that stopped being true becomes status='rejected'
-- with an audit row explaining why — it does not vanish. Deleting history to
-- tidy a list is the one edit this system should refuse to make.
--
-- Scope note: promote_finding/reject_finding do not write audit_log. Their
-- provenance already lives on the row (findings.reviewed_by, promoted_node_id,
-- knowledge_nodes.verified_by/verified_at), so nothing is lost — but it does
-- mean audit_log is "admin maintenance", not "everything that ever happened".
-- Read it as such until they are folded in.

-- ---------- 0. fix: 0005 created invited_emails but never granted it ----------
-- The invites_read policy has been dead since 0005 landed: RLS narrows access
-- that a GRANT has to open first, and no grant was ever issued, so admins get
-- a permission error rather than the invite list. Policy + grant, both needed.
grant select on invited_emails to authenticated;

-- ---------- 1. the audit log ----------

create table audit_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  -- actor survives the profile: display_name is snapshotted because an audit
  -- row has to stay readable after the account that wrote it is gone.
  actor      uuid references profiles(id) on delete set null,
  actor_name text not null,
  action     text not null,
  entity     text not null,
  entity_id  text not null,
  before     jsonb,
  after      jsonb,
  note       text
);

comment on table audit_log is
  'Append-only record of admin mutations. Written only by security definer '
  'functions; no client role has insert/update/delete. Admins read.';

create index idx_audit_entity on audit_log (entity, entity_id, at desc);
create index idx_audit_at on audit_log (at desc);

alter table audit_log enable row level security;

-- Read-only to admins. The absence of insert/update/delete policies is the
-- point: not even an admin can forge or edit a row from the client.
create policy audit_read on audit_log for select using (is_admin());

-- ---------- 2. internal writer ----------

-- Called only from the security definer functions below, which already run as
-- the table owner. Execute is revoked from every client role: a caller who
-- could reach this directly could write whatever history they liked.
create or replace function public.write_audit(
  p_action text, p_entity text, p_entity_id text,
  p_before jsonb, p_after jsonb, p_note text
) returns void language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  select display_name into v_name from profiles where id = auth.uid();
  insert into audit_log (actor, actor_name, action, entity, entity_id, before, after, note)
  values (auth.uid(), coalesce(v_name, 'service_role'), p_action, p_entity,
          p_entity_id, p_before, p_after, p_note);
end $$;

revoke execute on function public.write_audit(text,text,text,jsonb,jsonb,text)
  from public, anon, authenticated;

-- ---------- 3. re-tiering ----------

-- A tier change is a fresh act of verification, so verified_by/verified_at
-- move to whoever made it: leaving the previous reviewer's name on a claim
-- they did not assign this tier to would be exactly the kind of borrowed
-- authority the tier ladder exists to prevent.
create or replace function public.retier_node(
  p_node_id integer, p_tier text, p_note text
) returns void language plpgsql security definer set search_path = public as $$
declare
  n knowledge_nodes%rowtype;
  v_name text;
begin
  if not is_admin() then raise exception 'admin role required'; end if;
  if p_tier not in ('A','B','C','D') then
    raise exception 'invalid tier %', p_tier;
  end if;
  -- The note is the audit. A re-tier with no stated reason is not reviewable
  -- later, which defeats the purpose of recording it at all.
  if coalesce(length(trim(p_note)), 0) < 3 then
    raise exception 'a reason is required to re-tier a claim';
  end if;

  select * into n from knowledge_nodes where id = p_node_id for update;
  if not found then raise exception 'node % not found', p_node_id; end if;
  if n.tier = p_tier then
    raise exception 'node % is already tier %', p_node_id, p_tier;
  end if;

  select display_name into v_name from profiles where id = auth.uid();

  update knowledge_nodes
     set tier = p_tier, verified_by = coalesce(v_name, verified_by), verified_at = now()
   where id = p_node_id;

  perform write_audit('retier_node', 'knowledge_node', p_node_id::text,
                      jsonb_build_object('tier', n.tier),
                      jsonb_build_object('tier', p_tier),
                      p_note);
end $$;

-- ---------- 4. status changes (retire / restore) ----------

-- Only the three statuses an admin has any business setting by hand. 'draft'
-- and 'pending_review' belong to the agent/review pipeline: pushing a node
-- back into the queue from here would produce a pending item with no finding
-- behind it, which the review queue cannot render or dispose of.
create or replace function public.set_node_status(
  p_node_id integer, p_status text, p_note text
) returns void language plpgsql security definer set search_path = public as $$
declare
  n knowledge_nodes%rowtype;
begin
  if not is_admin() then raise exception 'admin role required'; end if;
  if p_status not in ('verified','stale','rejected') then
    raise exception 'status % cannot be set by hand (allowed: verified, stale, rejected)', p_status;
  end if;
  if coalesce(length(trim(p_note)), 0) < 3 then
    raise exception 'a reason is required to change a claim''s status';
  end if;

  select * into n from knowledge_nodes where id = p_node_id for update;
  if not found then raise exception 'node % not found', p_node_id; end if;
  if n.status = p_status then
    raise exception 'node % is already %', p_node_id, p_status;
  end if;

  update knowledge_nodes set status = p_status where id = p_node_id;

  perform write_audit('set_node_status', 'knowledge_node', p_node_id::text,
                      jsonb_build_object('status', n.status),
                      jsonb_build_object('status', p_status),
                      p_note);
end $$;

-- ---------- 5. invitations ----------

-- 0005 made signup invite-only but left issuing an invite a service-role
-- action, so an admin could not add a colleague without the Supabase
-- dashboard. This closes that: same is_admin() gate as everything else.
create or replace function public.invite_user(
  p_email text, p_role text default 'user'
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(trim(p_email));
  v_existing invited_emails%rowtype;
begin
  if not is_admin() then raise exception 'admin role required'; end if;
  if p_role not in ('user','admin') then
    raise exception 'invalid role %', p_role;
  end if;
  if position('@' in v_email) < 2 or v_email like '%@' then
    raise exception '% is not a valid email address', p_email;
  end if;

  select * into v_existing from invited_emails where email = v_email;

  if found and v_existing.claimed_at is not null then
    raise exception '% has already signed up; change the role on their profile instead', v_email;
  end if;

  if found then
    -- Re-inviting an unclaimed address is how you correct the role you meant
    -- to grant, so let it through rather than making them revoke first.
    update invited_emails
       set role = p_role, invited_by = auth.uid(), invited_at = now()
     where email = v_email;
    perform write_audit('invite_user', 'invited_email', v_email,
                        jsonb_build_object('role', v_existing.role),
                        jsonb_build_object('role', p_role),
                        'invite re-issued');
  else
    insert into invited_emails (email, role, invited_by)
    values (v_email, p_role, auth.uid());
    perform write_audit('invite_user', 'invited_email', v_email,
                        null, jsonb_build_object('role', p_role), null);
  end if;
end $$;

-- Only unclaimed invites can be withdrawn. Once an account exists, deleting
-- the invite row would not remove the account — it would just erase the record
-- of how they got in.
create or replace function public.revoke_invite(p_email text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(trim(p_email));
  v_existing invited_emails%rowtype;
begin
  if not is_admin() then raise exception 'admin role required'; end if;

  select * into v_existing from invited_emails where email = v_email;
  if not found then raise exception 'no invite for %', v_email; end if;
  if v_existing.claimed_at is not null then
    raise exception '% has already signed up; revoking the invite would not remove the account', v_email;
  end if;

  delete from invited_emails where email = v_email;

  perform write_audit('revoke_invite', 'invited_email', v_email,
                      jsonb_build_object('role', v_existing.role), null, null);
end $$;

-- ---------- 6. grants ----------
-- RLS still decides what comes back; these only open the door far enough for
-- the policies above to be the thing that says no.

grant select on audit_log to authenticated;

grant execute on function retier_node(integer,text,text),
                          set_node_status(integer,text,text),
                          invite_user(text,text),
                          revoke_invite(text)
  to authenticated;
