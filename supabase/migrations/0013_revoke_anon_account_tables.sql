-- 0013 — stop relying on RLS alone for the two account tables.
--
-- 0005 §6 revoked the anon role's access to the knowledge layer and 0011 did
-- the same for routine_runs and routine_commands. Two tables were missed, both
-- for the same reason: they did not exist yet when the revoke above them was
-- written. 0005 created invited_emails in that very file, and 0006 created
-- audit_log afterwards. Supabase grants every new table in `public` to anon and
-- authenticated by default, so both quietly picked up a full set of privileges.
--
-- Probed live before writing this, signed out, with only the publishable key:
--
--   invited_emails  select  200 []     insert  42501 RLS     update/delete 204, 0 rows
--   audit_log       select  200 []     insert  42501 RLS     delete        204, 0 rows
--
-- Every other table in the schema answers 401 "permission denied". A 42501 or a
-- 204 that matches nothing means the grant is real and RLS is the only barrier.
-- Nothing leaks and nothing is writable today — the policies are is_admin()
-- (0005 §4, 0006 §2) and there is no write policy at all — so this is not a
-- live hole. It is a missing second lock.
--
-- Worth fixing because of which two tables these are. invited_emails is every
-- address that has ever been admitted and the role each was given; audit_log is
-- the whole administrative record of who did what to whom, and it is meant to
-- be append-only. As it stands, one policy written slightly too permissively —
-- a `using (true)` meant for a debug session, a policy added for a future
-- feature without a matching revoke — is all that separates a signed-out
-- visitor from reading both or erasing the audit trail. Everywhere else in this
-- schema a client role has to clear a grant *and* a policy. These two should
-- meet that bar rather than a lower one.

revoke all on invited_emails, audit_log from anon;

-- authenticated keeps select on both: the Users tab reads them directly
-- (lib/api.js invites() and audit()), gated by the same is_admin() policies.
--
-- Writes do not go through the client role and never have. Every mutation of
-- these tables runs security-definer as the table owner — invite_user() and
-- revoke_invite() (0006 §5), handle_new_user() (0005), write_audit_as() (0006,
-- already revoked from authenticated) — or over the service key from the admin
-- routes. So the insert/update/delete grants authenticated inherited are
-- unused, and dropping them costs nothing while removing the same single-lock
-- problem one role further in.
--
-- If a feature ever does need a direct client write here, grant it explicitly
-- alongside the policy that permits it. That is the pattern 0002 already uses.
revoke insert, update, delete on invited_emails, audit_log from authenticated;

-- Both tables acquired their grants by inheritance, so close that off too:
-- otherwise the next migration that adds a table reopens this on a table nobody
-- thought to check. Applies to tables created by the role running this file,
-- which for a migration in the SQL editor is postgres — the same role whose
-- default privileges granted them in the first place.
alter default privileges in schema public revoke all on tables from anon;
