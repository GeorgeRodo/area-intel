-- 0009_reason_only_for_deletion.sql
--
-- Narrows where a written reason is demanded, to the one place it cannot be
-- reconstructed later.
--
-- 0008 required a reason for a role change, on the same principle as
-- retier_node: a claim's standing should be attributable. In use the analogy
-- broke down. A re-tiered claim keeps its old tier only in the audit row, so
-- without a reason the record is genuinely poorer. A role change leaves the
-- account sitting there with its current role, its history, and a person you
-- can ask — and the audit row still names who changed it, from what, to what,
-- and when. What the mandatory field actually produced was "role change"
-- typed a hundred times, which is worse than an honest null: it looks like a
-- justification without being one.
--
-- Deletion keeps the requirement, enforced in the route handler
-- (web/app/api/admin/users/[id]/route.js). There the subject of the action
-- does not survive it, so the audit row is the only thing left that can say
-- why it happened.

create or replace function public.set_user_role(
  p_user_id uuid, p_role text, p_note text default null
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

  select role into v_before from profiles where id = p_user_id;
  if not found then
    raise exception 'no profile for %', p_user_id;
  end if;

  if v_before = p_role then return; end if;

  if v_before = 'admin'
     and (select count(*) from profiles where role = 'admin') <= 1 then
    raise exception 'that is the last admin — promote someone else first';
  end if;

  update profiles set role = p_role where id = p_user_id;

  -- nullif keeps a whitespace-only note out of the log as null rather than as
  -- an empty string pretending to be an explanation.
  perform write_audit('set_user_role', 'profile', p_user_id::text,
                      jsonb_build_object('role', v_before),
                      jsonb_build_object('role', p_role),
                      nullif(btrim(coalesce(p_note, '')), ''));
end $$;

-- create or replace keeps the existing privileges on the function, but the
-- default argument makes (uuid,text) a callable form that did not exist
-- before, so re-state the grants rather than assume they carried.
revoke execute on function set_user_role(uuid,text,text) from public, anon;
grant execute on function set_user_role(uuid,text,text) to authenticated;
