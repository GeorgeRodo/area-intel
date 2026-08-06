# Execution Plan: 10 Working Days to Live Pilot

Each day has a goal, concrete tasks, and an acceptance test. If a day's
acceptance test fails, do not move on — the sequence is deliberate. Days 1-3
are setup; 4-7 build the intelligence; 8-10 prove the model scales.

Effort assumes 2-4 focused hours/day. Tasks marked [TEAM] need a human other
than you (reviewer calibration, field calls).

---

## Day 1 — Supabase project + database gate live
- Create Supabase project (EU region — Frankfurt, for GDPR posture and latency).
- Run `supabase/migrations/` in order: `0001_schema.sql`, `0002_security.sql`,
  `0003_routines.sql`, `0004_admin_user_roles.sql`, `0005_invite_only_access.sql`.
  Do NOT run `tests/pg_harness.sql` — it is the local stub only.
- Before applying `0005`, change the bootstrap email at the bottom of it to
  your own: it seeds the only invite that exists, and signup is invite-only
  from that point on (including accounts made from the dashboard).
- Auth → create your account with that address; it comes out `admin`. For your
  teammate, insert a row into `invited_emails` (service role) with the role you
  want, then have them sign up.
- Save the direct Postgres connection string and the anon key somewhere safe.

**Accept:** in the SQL editor, `select is_admin();` errors politely for no
session; `select * from coverage(1);` returns 12 rows of zeros; a signup from
an uninvited address is refused and leaves no row in `auth.users`.

## Day 2 — Seed + worker running against Supabase
- Locally: `export DATABASE_URL=<supabase connection string>` then
  `python -m kb.seed_grandola`.
- Start the worker: `python worker.py` (locally is fine today; VPS is Day 3).
- Insert a test question via SQL or the table editor; watch the worker log
  pick it up within a minute.

**Accept:** `select count(*) from knowledge_nodes;` = 8; a pending row exists
in `findings` after your test question.

## Day 3 — Frontend on Vercel + worker on VPS
- Vercel: import the `web/` directory, set `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, deploy.
- VPS (Hetzner CX22 is plenty): `docker compose up -d worker` with
  `DATABASE_URL` and `ANTHROPIC_API_KEY` in `.env`.
- Walk the three views on the live URL: brief, ask, review (sign in, see queue).

**Accept:** a question submitted from the live Ask page produces a finding in
the live Review queue without you touching anything.

## Day 4 — [TEAM] Reviewer calibration on real questions
- Write 10 real client-grade questions about Grandola/Melides (pull from the
  gap framework: AL posture, camara backlog, EPC path, condo health, exit
  liquidity).
- Both reviewers work the queue independently on 5 each; then compare tier
  decisions on 2 shared items. Disagreement on tiers = write the tier rubric
  down as `docs/tier-rubric.md` (30 min, one page).

**Accept:** 10 findings dispositioned; rubric doc exists; you both agree what
separates B from C in one sentence.

## Day 5 — DRE parser as the first automated producer
- Adapt the DRE parser from the intelligence-OS spec into
  `agent/producers/dre.py`: fetch DR summaries daily, keyword-match
  (IMT, arrendamento, RJUE, certificação energética...), emit Findings with
  `proposed_tier='A'` and the DR link as source.
- Register it in `worker.py` on a daily cadence.

**Accept:** worker log shows a DRE run; at least one regulatory finding with a
real dre.pt URL sits in the queue (approve or reject it properly).

## Day 6 — [TEAM] Field verification sprint: close Grandola's C/D gaps
- The seed deliberately left enforcement/AL at tier C/D. Close them:
  one call to Camara de Grandola urbanismo desk (backlog, Simplex posture),
  one call/email re AL status for Melides parish, one local architect contacted.
- Promote what you verify to tier A/B with named sources ("phone,
  urbanismo desk, 2026-07-29" is a valid Tier A citation if it is direct).

**Accept:** enforcement and the AL node upgraded from C/D; zero categories
rely on "suspected" language for Grandola's headline claims.

## Day 7 — Portal price producer + market depth
- `agent/producers/portal.py`: pull Idealista/Imovirtual listing counts and
  median asking for the concelho (respect robots.txt; daily snapshot into a
  `portal_snapshots` table you add, plus a weekly Finding summarizing drift).
- First liquidity reconstruction: days-on-market tracking starts now — it only
  becomes valuable with time, which is why it starts on Day 7, not Day 30.

**Accept:** one week from today the snapshot table has 7 rows/segment; today,
a market finding referencing real portal numbers is in the queue.

## Day 8 — Second municipality: Sines
- Write `kb/seed_sines.py` (mirror Grandola's structure): data-center
  build-out (Start Campus / Microsoft-linked / Nscale figures), workforce
  rental demand vector, industrial-town risk pattern, explicit UNKNOWNs.
- Seed, verify the brief renders, add cross-gap edges (infrastructure →
  liquidity is the interesting one here).

**Accept:** dashboard dropdown shows two municipalities; Sines brief has ≥6
verified nodes and ≥2 honest UNKNOWN categories.

## Day 9 — Hardening
- Backups: enable Supabase PITR or schedule `pg_dump` from the VPS (cron, to
  object storage).
- Access: already closed by `0005` (session required to read, `anon` revoked).
  Verify it rather than decide it: hit the REST endpoint with the anon key and
  no session, confirm a 401 rather than an empty array.
- Alerts: worker failures → email/Slack (a try/except + webhook is enough).
- Delete unused FastAPI remnants if you have not already; one data path only.

**Accept:** you can restore yesterday's dump to a scratch DB; killing the
worker produces an alert within 10 minutes.

## Day 10 — Pilot review with Paul & George
- Prepare 3 numbers: verified nodes by tier, median queue latency
  (finding created → dispositioned), questions asked vs answered.
- Demo the loop live: ask → finding → promote → brief updates.
- Decide together: (a) which client sees this first, (b) third municipality,
  (c) who gets invited next, and who issues invites (it is a service-role
  action today — see TASKS.md).

**Accept:** a written go/no-go with owner and date for the first external user.

---

## Standing rhythm after Day 10
- **Daily (15 min):** clear the review queue. A queue older than 24h is the
  product failing silently.
- **Weekly:** freshness report — count of stale nodes per municipality; field
  sprint for whatever category has been UNKNOWN longest.
- **Monthly:** add one municipality; re-verify one tier-A regulatory claim at
  the source (regulations change under you — that is the business).
