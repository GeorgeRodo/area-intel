-- 0008_user_administration.sql
--
-- Closes TASKS.md #3 by taking its second option: an admin manages accounts
-- from the admin panel, not the Supabase table editor.
--
-- The work splits along a line the database cannot cross. A role lives in
-- public.profiles, so changing one is a normal security-definer RPC with an
-- is_admin() gate and an audit row — that is set_user_role(), below, and it
-- needs no elevated key. A password lives in auth.users, which no client role
-- can reach and which Supabase alone knows how to hash and to invalidate
-- sessions for; that half has to go through the Auth admin API from a server
-- route holding the service role key (web/app/api/admin/users/**).
--
-- write_audit_as() exists so that server-side half still lands in the same
-- append-only log as everything else, attributed to the human who asked for
-- it rather than to 'service_role'.

-- ---------- 1. role changes ----------

-- Three guards, each of which has locked someone out of a project before:
--   * you cannot change your own role — an admin who demotes themselves has
--     no way back, since the only path to admin is another admin;
--   * the last admin cannot be demoted, for the same reason at project scope;
--   * a reason is required, matching retier_node/set_node_status — a role is
--     a standing claim about a person, and the ladder's whole point is that
--     standing is attributable.
create or replace function public.set_user_role(
  p_user_id uuid, p_role text, p_note text
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_before text;
begin
  if not is_admin() then raise exception 'admin role required'; end if;

  if p_role not in ('user','admin') then
    raise exception 'invalid role %', p_role;
  end if;

  if p_user_id = auth.uid() then
    raise exception 'you cannot change your own role';
  end if;

  if coalesce(btrim(p_note), '') = '' then
    raise exception 'a reason is required';
  end if;

  select role into v_before from profiles where id = p_user_id;
  if not found then
    raise exception 'no profile for %', p_user_id;
  end if;

  -- Not an error: re-submitting the role someone already has is a no-op, and
  -- writing an audit row saying nothing changed would be noise in the log.
  if v_before = p_role then return; end if;

  if v_before = 'admin'
     and (select count(*) from profiles where role = 'admin') <= 1 then
    raise exception 'that is the last admin — promote someone else first';
  end if;

  update profiles set role = p_role where id = p_user_id;

  perform write_audit('set_user_role', 'profile', p_user_id::text,
                      jsonb_build_object('role', v_before),
                      jsonb_build_object('role', p_role), p_note);
end $$;

-- ---------- 2. audit for the Auth-side actions ----------

-- write_audit() stamps auth.uid(), which is null on a service-role connection,
-- so a password reset done through the Auth admin API would be logged as
-- 'service_role' with no actor. This variant takes the actor explicitly.
--
-- That makes it forgeable by whoever can call it, which is why execute is
-- granted to service_role alone: the only caller is the route handler, and it
-- has already verified the bearer token and read the caller's role before it
-- gets here. No client role can reach this, so the guarantee that an admin
-- cannot forge history from the browser is unchanged.
create or replace function public.write_audit_as(
  p_actor uuid, p_action text, p_entity text, p_entity_id text,
  p_before jsonb, p_after jsonb, p_note text
) returns void language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  select display_name into v_name from profiles where id = p_actor;
  insert into audit_log (actor, actor_name, action, entity, entity_id,
                         before, after, note)
  values (p_actor, coalesce(v_name, 'unknown'), p_action, p_entity, p_entity_id,
          p_before, p_after, p_note);
end $$;

revoke execute on function
  public.write_audit_as(uuid,text,text,text,jsonb,jsonb,text)
  from public, anon, authenticated;

-- ---------- 3. grants ----------

-- Postgres grants EXECUTE on a new function to PUBLIC by default, so granting
-- to authenticated is not enough on its own — anon inherits it and can reach
-- set_user_role. It would fail closed on is_admin(), but 0005's whole point
-- was that an unauthenticated request is refused at the privilege layer
-- rather than getting far enough to be told no.
revoke execute on function set_user_role(uuid,text,text) from public, anon;
grant execute on function set_user_role(uuid,text,text) to authenticated;
grant execute on function
  write_audit_as(uuid,text,text,text,jsonb,jsonb,text) to service_role;
