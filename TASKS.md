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
- [x] **Setting a password now ends the target's sessions.** `0014` adds
      `revoke_user_sessions(p_user_id)`, and the password route calls it
      immediately after the credential is replaced — never before, or the old
      password would still open a fresh session in the gap.

      The GoTrue assumption is pinned deliberately rather than discovered
      later, and it is written out at the top of the migration: `auth.sessions`
      keyed by uuid, `auth.refresh_tokens` keyed by the same id as `varchar`.
      Both are deleted — the cascade from `sessions` covers most tokens, but
      older rows can carry a null `session_id` and hang off no session at all.
      If `auth.sessions` ever stops existing the function raises instead of
      returning zero, because a revocation that silently revokes nothing is the
      same failure the email paths were deleted for.

      Two things it does not do, both reported rather than glossed. The access
      token is a signed JWT and nothing in the database can withdraw one, so a
      token already in a browser works until it expires (an hour by default);
      what this ends is the ability to renew past that. Closing the window
      entirely means rotating the project's JWT secret, which signs everyone
      out. And if the revocation call itself fails, the password has already
      changed — so the route returns `revocation_failed` instead of throwing,
      and the Users tab says the sessions are still live rather than letting an
      admin believe a departed colleague is locked out.

      Granted to `service_role` alone: it is called on a service-key
      connection where `auth.uid()` is null, so an `is_admin()` gate would
      refuse its own caller, exactly as with `write_audit_as()`. Access control
      is `requireAdmin()`, and nothing widens — an admin who can reach the
      route can already replace the credential.
- [x] `listUsers({ perPage: 1000 })` in `/api/admin/users` and
      `/api/admin/invites/link` no longer truncates. Both go through
      `listAllUsers` / `findUserByEmail` in `lib/server/admin.js`, which page to
      the end of the directory.

      The subtlety worth keeping: the loop stops on an **empty** page, never a
      short one. GoTrue clamps an oversized `perPage` to its own maximum rather
      than refusing it, so a full page under a server-side cap is
      indistinguishable from a short final page — which is why `1000` was never
      the guarantee it looked like. One extra request removes the ambiguity.

      `findUserByEmail` exits early on a match but returns null only after
      reaching the end, because the link route acts on the negative answer:
      truncation there does not degrade the result, it inverts it, turning an
      existing colleague into a new address to invite. Past 10,000 accounts
      both raise rather than returning a prefix — the Users tab renders one
      unpaged list, so that is a wall to hit loudly.
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
- [ ] **`0014` has not been applied or executed.** Still no `psql`, Docker or
      Supabase CLI on the dev machine, so like `0006` before it the migration
      has been read and not run. The web build passes, which covers the
      JavaScript half and nothing else. Before trusting it: apply `0014`, then
      sign in as a second account, set its password from the Users tab, and
      confirm that session cannot refresh — and check the call does not come
      back `permission denied for table sessions`, which is the one plausible
      failure and has its fix noted at the bottom of the migration.
- [ ] `INVITE_LINK_TTL_HOURS` in `UsersPanel.jsx` is hardcoded to 24 and the
      Users tab renders a live countdown from it. Nobody has checked it against
      Authentication → Emails → Email OTP Expiration. If the real value is
      lower, the tab tells admins a dead link is still good — the same silent
      failure the email paths were removed for. Read it from somewhere real or
      stop displaying a number.

## 3b. Knowledge base in the web app — read path built, not yet fed

`0007` created `wiki_articles` / `wiki_links` and `kb/sync_wiki.py` fills them,
but until now nothing read them: the agent globbed the vault off the local
filesystem via `WIKI_PATH`, and the web app had no reference to the tables at
all. The dashboard half is now built.

- [x] `api.wikiArticles` / `wikiArticle` / `wikiSearch` in `lib/api.js`, with
      `demoData` branches like every other reader. Search goes through
      `wiki_search()` rather than an `.ilike()` chain, so the ranking definition
      — a `simple` tsvector, because these articles mix English prose and
      Portuguese legal terms in one sentence — stays in the migration.
- [x] `/knowledge` — browse by vault folder, or ranked search with snippets.
- [x] `/knowledge/[...path]` — the article, markdown rendered, with Obsidian
      wikilinks resolved through `wiki_links`. Dangling links render as marked
      text rather than disappearing: `0007` keeps those rows deliberately
      because an unresolved link says where the vault is thin, and the reader
      shows a count of them at the foot of each article.
- [x] "Background from the knowledge base" at the foot of the Area Brief,
      below the verified layer and behind a corpus notice.
- [x] Twelve real articles as demo fixtures, chosen to be mutually linked (34
      internal links) so the demo exercises resolved *and* dangling states —
      an arbitrary set left every link dangling, which is the opposite of the
      real vault's 754/754.
- [x] `react-markdown` kept out of `wiki.jsx`. It is ~47 kB and only the
      article reader needs it; while it sat next to `ArticleCard`, every Area
      Brief a buyer opened paid for a markdown parser it never called
      (234 kB → 191 kB first load).

The distinction this surface has to preserve, restated because it is the thing
most likely to erode: a wiki article is not a verified claim. Nothing on these
screens renders a `TierChip`, borrows the tier colours, or maps
`wiki_verified` — the vault's own frontmatter flag, on a different axis — onto
the A–D ladder. `knowledge_nodes` stays the only authority for anything shown
as fact.

Still open:

- [ ] **`0007` is not applied to the pilot project.** Probed signed-out with
      the publishable key: `wiki_articles` answers `PGRST205` ("could not find
      the table"), where every real table answers `42501` ("permission
      denied"). So the corpus surfaces run on fixtures and nothing else today.
- [ ] **Nothing has been synced.** `python -m kb.sync_wiki --dry-run` against
      the vault reports 108 articles and 754 wikilinks with 0 unresolved, so
      the job is ready; it needs `DATABASE_URL` and `WIKI_PATH` pointed at
      `TestingGrounds/pt-buyers-kb/pt-buyers-kb` (also `GeorgeRodo/pt-buyers-kb`
      on GitHub).
- [ ] **`NEXT_PUBLIC_SUPABASE_DATA` is still commented out** in
      `web/.env.local`, so the whole data layer — areas, claims, findings,
      routines, and now the corpus — reads from `lib/demo.js`. Flipping it also
      needs `knowledge_nodes` seeded (`python -m kb.seed_grandola`), or the
      Area Brief goes empty.
- [ ] Apply order note: `0007` predates `0013` by number but will be applied
      after it, and that is *safer*, not a problem. `0013` revoked the schema's
      default table grants from `anon`, so `wiki_articles` inherits nothing. In
      numeric order it would have picked up a full anon grant, leaving RLS as
      the only lock — the exact hole `0013` was written to close. The comment
      in `0007` credits `0005` for this and is wrong about which migration
      protects it.
- [ ] Six vault plumbing files are ingested as articles: `Home.md`,
      `index.md`, `log.md`, `README.md`, and — worse — `AGENTS.md` and
      `CLAUDE.md`, which are instructions written *for* AI agents. `SKIP_DIRS`
      in `kb/wiki_parse.py` only skips directories. `log.md` already turns up
      in the agent's top-5 retrieval for unrelated questions, and feeding an
      agent-instruction file to the agent as domain knowledge is the wrong
      shape regardless of ranking. Needs a skip list for root-level files.
- [ ] The agent still reads the filesystem, not Postgres
      (`agent/kb_context.py`), so the worker remains tied to a machine holding
      the vault. Its keyword scorer is also unnormalised — `len(query ∩
      article)` with no stopwords, no IDF and no length penalty — so long
      articles win on common words. A real query returned the right article
      first and then three pieces of filler plus the changelog, all of which
      go into the prompt under "the team's compiled source of truth". Deciding
      what the agent does with the corpus is a separate conversation.

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
- [x] `api/main.py` (FastAPI) is **deleted**, closing PLAN.md day 9's "one data
      path only". It was a second HTTP layer over the same tables from before
      the web app talked to Supabase directly, and it had already stopped being
      a live option: nothing imported it, no doc referenced it, and `fastapi`
      and `uvicorn` were never in `requirements.txt`, so it could not start
      without an install nobody would have known to do. Its auth model — an
      open reader surface plus a shared `X-Reviewer-Key` header — is also two
      generations behind where `0005`/`0006` ended up, which is the real reason
      not to keep it warm: reviving it would mean rewriting the security model
      rather than dusting it off.
- [x] `dashboard/app.py` (Streamlit) is **deleted**, and `streamlit` and
      `pandas` with it — `requirements.txt` is down to four lines.

      It was the original UI, and the product's thesis was written there first:
      the tier chips, the coverage matrix, "UNKNOWN — not yet verified" as an
      answer. The Next.js app has all three of its views now, so what remained
      was a second front door the security model does not cover. It had no
      authentication of any kind — the Review Queue took a reviewer's name from
      a text box and wrote that string to `verified_by` — and it connects as
      table owner, so RLS does not apply to it either.

      The deciding reason was the review gate. `promote_finding` exists twice:
      as a security-definer SQL function with an `is_admin()` check (`0004`),
      and as a plain Python helper in `kb/store.py` with no check at all. The
      Streamlit app used the second one. Two implementations of the one rule
      the product is sold on is a drift risk that outlived its usefulness.

- [ ] **`review/cli.py` has the same property and was kept anyway.** It is 81
      lines, has no UI to rot, and is a real fallback when the web app or
      PostgREST is down but Postgres is up. But it too calls the Python
      promotion helper rather than the SQL function, so the database's role
      check is not what stands behind it. Either point it at the SQL
      `promote_finding()` so there is one enforced gate, or leave it and keep
      it on a trusted machine — but do not let a third caller appear.
