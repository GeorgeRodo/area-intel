-- 0011_routine_runs_require_session.sql
--
-- Closes a hole 0005 was written to close and missed.
--
-- 0005 §4 made reading require a session and §6 revoked the anon role's grants
-- outright, on the reasoning that the anon key ships in the browser bundle and
-- is therefore public: anything readable by anon is readable by anyone who
-- views source. Both lists were written against the tables that existed in
-- 0001/0002. routine_runs and routine_commands arrived in 0003, in between, and
-- were in neither list — so routine_runs kept the `using (true)` policy and the
-- anon grant it was created with, and has been world-readable ever since.
--
-- What that exposes is worse than a run count. routine_runs.detail carries
-- str(e)[:500] from any routine that raised (worker.py), so an unhandled
-- exception writes raw database and API error text — table names, constraint
-- names, connection failures, whatever the driver put in the message — into a
-- row anyone can fetch from the REST endpoint without signing in.
--
-- Admin-only rather than any-session: the only readers are the Automation tab
-- and the mission-control KPIs, both of which sit behind the admin panel, and
-- an operational log of what the worker is doing is not something a `user`
-- account has any reason to see.
--
-- routine_commands was already admin-gated by policy (cmd_read, re-pointed at
-- is_admin() in 0004), so anon was refused there — but only at the policy
-- layer, returning an empty set rather than an error. 0005 §6's stated
-- principle is that an unauthenticated request should be refused at the
-- privilege layer instead, so its grant goes too.

-- `if exists` so the file can be re-run: a script that half-applied and then
-- errored is worse than one that is simply idempotent.
drop policy if exists runs_read on routine_runs;
create policy runs_read on routine_runs for select using (is_admin());

revoke select on routine_runs, routine_commands from anon;
