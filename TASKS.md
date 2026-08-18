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

That invariant is correct and should stay. The equivalent gated path for
maintenance landed in `0006_audit_and_admin_rpcs.sql`:

- [x] `retier_node(p_node_id, p_tier, p_note)` — security definer, `is_admin()`
      check, writes an audit row (who, when, from tier, to tier, why).
- [x] `set_node_status(p_node_id, p_status, p_note)` — same shape; covers
      retiring a claim that stopped being true without deleting history.
      Refuses `draft` / `pending_review`: those belong to the review pipeline.
- [x] Decided: **no hard delete.** `status = 'rejected'` plus an audit row is
      the honest version, because the product's whole claim is provenance.
      `api.deleteNode` is gone; the UI offers Retire.
- [x] Wire `api.updateNode` to those RPCs. The reason is mandatory, so the
      Knowledge Base tab stages the change and asks why before sending it.
- [ ] **Unverified against a real database.** No `psql` or Docker on the dev
      machine, so `0006` and the rewritten `pg_rls_test.sql` have never been
      executed. Run them before trusting either.
- [ ] `promote_finding` / `reject_finding` do not write `audit_log`. Their
      provenance lives on the row instead, so nothing is lost — but the log is
      "admin maintenance", not "everything". Fold them in for one timeline.

## 3. User management against Supabase is read-only

`Users` tab lists `profiles` when configured, but role changes, creation, and
deletion all throw: there is no client update policy on `profiles` (by design)
and user creation belongs to Supabase Auth.

Inviting was the more pressing half, and `0006` closed it:

- [x] `invite_user(p_email, p_role)` — security definer, `is_admin()` check,
      inserts into `invited_emails` and records who issued it. Re-inviting an
      unclaimed address corrects the role; a claimed one is refused.
- [x] `revoke_invite(p_email)` — unclaimed invites only, since deleting a
      claimed one erases the record without removing the account.
- [x] Surface both in the Users tab, with claimed vs pending state.
- [x] Fixed in passing: `0005` created `invited_emails` and a read policy for
      admins but never granted `select` to `authenticated`, so that policy had
      never actually worked. RLS narrows access a grant has to open first.

Changing an *existing* user's role was left undecided between the table editor
and an RPC. `0008` took the RPC:

- [x] `set_user_role(p_user_id, p_role, p_note)` — security definer,
      `is_admin()` check, reason required, audit row. Refuses to change your
      own role or to demote the last admin: the only route to admin is another
      admin, so either one is a one-way door.
- [x] Account administration proper, in the Users tab: set a password, send a
      recovery link, delete an account.

That last group could not be an RPC. Passwords and email addresses live in
`auth.users`, which no client role can read and which only Supabase knows how
to hash and to invalidate sessions for, so it goes through the Auth admin API
from server routes under `web/app/api/admin/users/**`, holding
`SUPABASE_SERVICE_ROLE_KEY`. Consequences worth keeping in view:

- The web app is now a privileged service, not just a client. The key bypasses
  RLS entirely, so the routes' own `requireAdmin()` — verify the bearer token,
  then re-read the caller's role server-side — *is* the access control. There
  is no database policy underneath it to catch a mistake.
- `write_audit_as()` (`0008`) lets those routes attribute their audit rows to
  the human who asked, instead of `service_role`. Execute is granted to
  `service_role` alone, so an admin still cannot forge history from a browser.
- Passwords are never logged, echoed, or written to `audit_log` — only that
  one was set, by whom, and why.

Closed since:

- [~] Rate-limit the account routes — **built, then deliberately removed.**
      An earlier `0010` added a `consume_rate_limit()` function and a counter
      table, charging per-admin hourly budgets on invites, password resets and
      deletions. It is gone: managing accounts is an admin's job, and a cap on
      how fast they can do it is friction on every real day of use in exchange
      for slowing an attacker who already holds an admin session.

      Two things follow from that, and are accepted knowingly rather than
      overlooked. Supabase's 2/hour mailer cap used to be an accidental brake on
      how fast accounts could be created; the mail-free paths (Copy link, Add
      account) removed it, so nothing now bounds account creation. And a stolen
      admin token can delete every account in the project as fast as the API
      will answer. What stands behind both is `requireAdmin()` and the audit
      log — prevention gave way to attribution, on purpose.

      If that trade ever stops looking right, the thing to add back is a cap on
      **deletion only** — it is the one action with no opposite to re-run.
- [x] A mail-free way in, pending SMTP: `POST /api/admin/invites/link` mints an
      invite or recovery link instead of sending one, and the Users tab copies
      it to the clipboard. Refuses accounts that have already been signed in to
      — for those a link is a silent way into a live account, and `password/`
      already declined to build one for that reason.
- [x] Direct account creation: `POST /api/admin/users`, "Add account" in the
      Users tab. Allow-lists the address and creates the account in one call,
      with no email anywhere in the path — so onboarding works today, against
      the mailer as it is. Same two steps and the same order as the emailed
      invite, because there is no way to create an account that skips
      `handle_new_user()`: `invite_user()` first (it carries the role), then
      `createUser({ email_confirm: true })`, since nobody will click a
      confirmation that was never sent.

      **This is interim and should be removed when SMTP lands.** It is the only
      path in the system where someone other than the account holder knows
      their password, which is the property every other path was shaped to
      preserve — `set_user_role`'s reason, the audit log, the anon-key recovery
      mail, `/invites/link` refusing live accounts. Ranked by preference while
      it stays: invite → Copy link → Add account.

      Note this does not remove the bootstrap invite in `0005`. Creating an
      account requires being signed in as an admin, so the first admin still
      has to arrive through the seeded allow-list row.
- [x] `0010`: `invited_emails.invited_by` had no `on delete` action, so
      deleting any admin who had issued an invite failed on the cascade from
      `auth.users` → `profiles`. Now `on delete set null`, matching
      `audit_log.actor`. Same migration puts a lowercase check on
      `invited_emails.email`, which every writer assumed and nothing enforced.
- [x] `0013`: `invited_emails` and `audit_log` were the only two tables where a
      client role's grant was never revoked, so RLS alone stood between a
      signed-out visitor and every invited address plus the whole
      administrative record. Both had inherited a full set of privileges from
      Supabase's default grants — they were created after the revokes in `0005`
      §6 and `0011` that would have caught them. Nothing leaked, because the
      policies are `is_admin()` and there is no write policy at all; but a
      single over-broad policy added later would have been the only mistake
      needed. `anon` now holds nothing on either table, `authenticated` keeps
      `select` and loses the writes it never used (every write is
      security-definer or service-key), and the default grant is revoked so the
      next new table does not repeat it.

Still open:

- [x] **Decided: no SMTP, so every email path is removed.** Not deferred —
      deleted. Supabase's built-in mailer only delivers to members of the
      Supabase organisation and drops everything else *after reporting the send
      as successful*: no error, no bounce, nothing in any log. A control that
      cannot tell you it failed is worse than no control, so rather than leave
      three of them wired to it, they went:

      * `POST /api/admin/invites` (emailed invitation) — route deleted
      * "Send reset link" and the password route's `recovery` mode — deleted
      * `isMailRateLimit`, and the 429 handling that existed only for the
        mailer's hourly cap — deleted with them

      What remains reaches people without email at all: an invitation link you
      pass on yourself, and Add account. `0012` adds `link_generated_at` so the
      Users tab can say whether a link is live, expired, or already used.

      One email path is left, and it is not ours: `supabase.auth.signUp()` on
      the cold `/signup` form sends a confirmation if the project has email
      confirmation switched on. It cannot be removed from the client, so the
      page no longer claims the mail was sent — it says to ask an admin for a
      link if nothing arrives.

- [ ] **Custom SMTP — now optional rather than blocking.** If it is ever set
      up, restore in this order: the password route's `recovery` mode (so a
      reset stops requiring an admin to know the password), then the emailed
      invitation. For reference, the mailer's other limit:

      * It **only delivers to members of the Supabase organisation.** An
        invitation to an outside colleague is accepted by the API and then
        dropped — there is no error to catch, so from the app it looks sent.
        This is the blocker, not the rate.
      * It is capped at **a couple of sends per hour for the entire project**,
        one bucket shared by invites, recovery and confirmations, so a few
        invites can exhaust what a user's own password reset needs. Supabase
        has changed this number repeatedly (30/h → 4/h → 2/h); read the current
        value under Authentication → Rate Limits rather than trusting this.

      Neither limit can be hit any more, because nothing in the app sends mail.
      The 429 handling that read the mailer's refusal went with the routes that
      could provoke it.

      Interim answers, already in place: "Add account" creates the account
      outright (above), and `POST /api/admin/invites/link` calls
      `generateLink()`, which returns a URL and sends nothing, so neither limit
      touches it. It covers onboarding completely. What it deliberately does
      *not* cover is recovery for an account that has already been signed in
      to — those are refused, so custom SMTP is still the only way to reset a
      live user's password without an admin setting it for them.

      If SMTP does land, note that the per-admin rate limiter that used to sit
      in front of these routes is gone (above) and is not a prerequisite for
      bringing the mail paths back — the two were removed for unrelated
      reasons.
- [ ] **Setting a password does not end the target's sessions.**
      `auth.admin.updateUserById({ password })` replaces the credential but
      leaves existing refresh tokens valid, so the case the feature exists for
      — someone has left, or their account is compromised — is not actually
      closed by it. supabase-js exposes no admin session revocation; it needs a
      security definer function over `auth.sessions` / `auth.refresh_tokens`,
      which means pinning a GoTrue schema assumption. Decide and do it.
- [ ] `listUsers({ perPage: 1000 })` in `/api/admin/users` and
      `/api/admin/invites/link` silently truncates past 1000 accounts. Fine at
      team size; the link route degrades badly if it ever is not, since a missed
      account is read as "no account" and it tries to invite them again.
- [x] `0010`–`0013` are applied to the pilot project and were verified against
      it rather than read: the `invited_by` FK by creating an account, pointing
      an invite at it and deleting it (the row survived, `invited_by` went
      null); the lowercase check by trying to insert a mixed-case address; the
      `anon` revokes by reading every table signed out with only the
      publishable key. Every probe row was removed afterwards.

      Also probed with real sessions, one non-admin and one admin, hitting
      PostgREST directly rather than through our routes: a non-admin gets no
      rows from `profiles`, `invited_emails`, `audit_log` or `routine_runs`,
      `admin role required` from `invite_user()` and `revoke_invite()`, and
      cannot promote itself — `PATCH profiles SET role='admin'` on its own row
      matches nothing.
- [ ] Still untested: the routes themselves. Every check above is at the
      database layer, so nothing proves the Users tab still drives them
      correctly after the email paths came out. Needs a click-through, or
      better, the route-level test that `#5` has wanted all along.
- [ ] `INVITE_LINK_TTL_HOURS` in `UsersPanel.jsx` is hardcoded to 24 and the
      Users tab renders a live countdown from it. Nobody has checked it against
      Authentication → Emails → Email OTP Expiration. If the real value is
      lower, the tab tells admins a dead link is still good — the same silent
      failure the email paths were removed for. Read it from somewhere real or
      stop displaying a number.

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

## 4b. Worker and agent robustness — fixed, but see the last item

Found while auditing the whole app rather than the users half:

- [x] **`routine_runs` was world-readable.** `0003` created it with
      `using (true)` and a grant to `anon`; `0005` §4/§6 closed exactly this
      hole for every table that existed in `0001`/`0002` but was written before
      `0003` landed, so the runs table was in neither list. `detail` carries
      `str(e)[:500]` from any routine that raised, so raw database and API error
      text was fetchable from the REST endpoint by anyone with the public anon
      key and no session. `0011` makes it `is_admin()` and revokes the grants.
- [x] **A database error killed the worker permanently.** `execute()` committed
      in a `finally` outside the `except`, so after a DB error the session was
      already rolled back and the commit raised `PendingRollbackError` straight
      past the handler and out of the process — the loop the docstring says it
      keeps alive. The same shape also committed a failed routine's partial
      writes. Now: commit or roll back the routine's work first, then write the
      run row in its own transaction, with the main loop catching too.
- [x] **A failed research call stranded the question forever.** `backend.run()`
      raising left the task `in_progress`, and only `open` tasks are ever
      selected — so one network blip on the Anthropic call silently lost a
      question while the UI told the asker it would be picked up in a minute.
      Now reopened on failure.
- [x] Malformed model output (`f["title"]`) raised `KeyError` and took down the
      whole batch; one bad finding now costs that finding only.
- [x] `freshness_deadline()` called `Category(self.category)` before its own
      default, so an unrecognised category raised `ValueError` — and since
      `sweep_stale()` walks every verified node in one pass, one such row
      aborted the sweep and nothing degraded to stale. Also corrects the
      fallback from 180 to 365 to match `freshness_days()` in `0002`.
- [x] `api.ask` sent the question untrimmed and unbounded, so anything over
      2000 characters came back as "new row violates row-level security
      policy". Validated client-side with a message the asker can act on.

- [ ] **The agent model is `claude-sonnet-4-6`** (`agent/researcher.py`), with
      the matching basic `web_search_20250305` tool. Not a bug — that pairing is
      valid — but it is a generation behind. Moving to `claude-opus-5` would
      also mean `web_search_20260209` (dynamic filtering, which cuts what
      reaches the context window). Left alone deliberately: it roughly doubles
      per-token cost, and that is a call to make on purpose, not in an audit.

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
