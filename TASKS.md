# TASKS

Known gaps and follow-up work. Ordered by what blocks a pilot.

---

## 1. Replace the local user base with real auth — BLOCKING

**Status: temporary scaffolding, must not ship.**

Demo mode (no Supabase env vars) authenticates against `web/lib/users.js`: a
hardcoded seed list persisted to `localStorage`. It exists so both roles are
walkable with zero setup.

Test accounts:

| Email | Password | Role |
|---|---|---|
| `admin@areaintel.pt` | `admin1234` | admin |
| `user@areaintel.pt` | `user1234` | user |

Why it has to go:

- Passwords are stored and compared **in plaintext, in the browser**.
- The role lives in client-writable storage, so any user can open devtools and
  set `role: "admin"` on themselves. The gate is cosmetic in this mode.
- No sessions, no expiry, no password reset, no audit trail of who verified
  what. `verified_by` on a promoted node is only as trustworthy as the browser
  that claimed it.
- Accounts are per-browser: they do not follow a user to another machine.

The fix: set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
Auth then goes to Supabase Auth and the role comes from `profiles.role`, which
`0004_admin_user_roles.sql` already constrains to `user | admin` and which only
the service role can change. No component changes are needed: `lib/api.js`
switches on `demoMode` and everything above it is role-driven already.

Signup policy is now decided: `0005_invite_only_access.sql` makes it
invite-only, so an uninvited signup aborts before the account exists and the
invite row carries the role.

Remaining work to actually make that switch:

- [ ] Edit the bootstrap email at the bottom of `0005` to a real address, apply
      the migrations, and create that account in Supabase Auth.
- [ ] Invite the rest of the team: insert into `invited_emails` (service role).
- [ ] Delete `web/lib/users.js` and its `demoMode` branches in `lib/api.js`
      once demo mode is no longer needed for sales demos. If demo mode stays,
      keep it clearly labelled by the amber DEMO ribbon.

---

## 2. Admin write paths against Supabase are missing

The Knowledge Base tab can re-tier, re-status, and delete claims **in demo mode
only**. Against Supabase these calls throw a descriptive error instead of
silently failing, because `0002_security.sql` deliberately gives no client role
insert/update/delete on `knowledge_nodes`: `promote_finding()` is the only
sanctioned way in.

That invariant is correct and should stay. What is missing is the equivalent
gated path for maintenance:

- [ ] `retier_node(p_node_id, p_tier, p_note)` — security definer, `is_admin()`
      check, writes an audit row (who, when, from tier, to tier, why).
- [ ] `set_node_status(p_node_id, p_status, p_note)` — same shape; covers
      retiring a claim that stopped being true without deleting history.
- [ ] Decide whether hard delete should exist at all, or whether
      `status = 'rejected'` plus an audit trail is the honest version. Leaning
      the latter: the product's whole claim is provenance.
- [ ] Wire `api.updateNode` / `api.deleteNode` to those RPCs.

## 3. User management against Supabase is read-only

`Users` tab lists `profiles` when configured, but role changes, creation, and
deletion all throw: there is no client update policy on `profiles` (by design)
and user creation belongs to Supabase Auth.

- [ ] Either accept the Supabase table editor as the admin path and drop the
      controls when `!demoMode` (currently they render disabled), or
- [ ] add a service-role edge function `set_user_role(user_id, role)` with an
      `is_admin()` check and an audit row.

Since `0005`, inviting is the more pressing half: `invited_emails` is
readable by admins but writable only by the service role, so an admin cannot
add a colleague from the UI at all.

- [ ] `invite_user(p_email, p_role)` — security definer, `is_admin()` check,
      inserts into `invited_emails` and records who issued it.
- [ ] Surface it in the Users tab (pending invites, claimed vs unclaimed, and
      a revoke that deletes an unclaimed row).

## 4. Routine registry is split across two files

`ROUTINE_REGISTRY` in `web/lib/api.js` lists two routines; `demoRoutines` in
`web/lib/demo.js` lists four (adding `dre_parser` and `portal_tracker`, which
are on the roadmap but not implemented in `worker.py`).

- [x] Mark not-yet-implemented routines as `planned` in the UI rather than
      showing them as if they run. `planned: true` now drops the status dot,
      the schedule, the run button and the fabricated run history, and the
      "Registered" count only counts routines that can actually run.
- [ ] Move the registry into the database (`routines` table: name, schedule,
      description, enabled) so the worker and the UI read the same source.
      Until then the two lists are kept honest by hand.

## 5. Smaller items

- [x] `datetime.utcnow()` deprecation warnings on Python 3.12 — replaced by
      `db.models.utcnow()`, which returns naive UTC. It is not
      `datetime.now(UTC)`: the columns are naive, so an aware value would
      store an offset and later comparisons would raise TypeError. Making the
      columns `timestamptz`-aware end to end is the real fix, and a migration.
- [ ] The Automation tab polls every 15s; move to Supabase realtime on
      `routine_runs` like the review queue already does on `findings`.
- [ ] No tests cover the role gate on the web side. Worth a smoke test that a
      `user` session cannot render the admin panel.
- [ ] `api/main.py` (FastAPI) is a second, unused data path — the web app talks
      to Supabase directly. PLAN.md day 9 says delete it; decide and do it.
