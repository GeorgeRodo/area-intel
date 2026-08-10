# Area Intelligence Dashboard

Knowledge base → agent → user, with a human review loop. Pilot municipality: **Grandola** (Melides / Comporta coast).

The core thesis: automated research is commodity; the sellable asset is the **human-verified layer**. So nothing the agent produces reaches a user until a team member promotes it through the review queue, and every claim carries a reliability tier (A–D), a source, an as-of date, and a freshness deadline. "Unknown — not yet verified" is a first-class answer on the dashboard.

## Tech stack

| Layer | Tech | Where |
|---|---|---|
| Frontend | Next.js 14 (React, App Router) + Tailwind + supabase-js | `web/` (deploy: Vercel) |
| DB / Auth / API / Realtime | Supabase (Postgres + RLS + Auth + PostgREST) | `supabase/migrations/` |
| Review gate | Postgres functions `promote_finding` / `reject_finding` (security definer, role-checked) | `0002_security.sql` |
| Worker | Python: agent (Claude + web search), freshness sweep, producers | `worker.py`, `agent/` (deploy: small VPS) |
| Internal admin | Streamlit + CLI against the same DB | `dashboard/`, `review/cli.py` |

The review-gate invariant is enforced **by the database**: no client role can
insert into `knowledge_nodes`; the only path from finding to verified node is
the `promote_finding()` RPC, which verifies the caller's admin role from
`profiles`. RLS hides pending findings and draft nodes from readers. Every
later change to a claim goes through the same kind of gate — `retier_node()`
and `set_node_status()` (`0006`), each demanding a reason and writing an
`audit_log` row. There is no delete: a claim that stopped being true is retired
to `rejected` with that reason attached, because the record of what was once
believed is part of what is being sold.

This is tested in `tests/pg_rls_test.sql` (37 checks) against local Postgres
using `tests/pg_harness.sql` to stub the Supabase runtime.

Roles: `profiles.role` ∈ user | admin. Signup is invite-only (`0005`): an
account can only be created for an email already on `invited_emails`, and that
row carries the role the profile is created with. Changing a role afterwards is
a service-role action (Supabase table editor). **admin** manages the
knowledge base — the admin panel at `/` with the reliability ladder, review
queue, automation and accounts. **user** gets area briefs and Ask, and cannot
see any of it.

## Design demo (zero setup)

```powershell
cd web
npm install
npm run dev          # open http://localhost:3000
```

With no Supabase env vars set, the app runs on embedded demo data (amber
DEMO DATA ribbon on top) and signs you in against a **local test user base**
(`web/lib/users.js`, browser storage, plaintext passwords — temporary, see
**TASKS.md**):

| Email | Password | Role |
|---|---|---|
| `admin@areaintel.pt` | `admin1234` | admin |
| `user@areaintel.pt` | `user1234` | user |

Setting `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` switches
sign-in, profiles and invitations to Supabase Auth without touching a
component. The knowledge base moves separately, on
`NEXT_PUBLIC_SUPABASE_DATA=1` — the two halves are independent switches
(`localUsers` / `demoData` in `web/lib/api.js`) because they are ready at
different times: accounts exist as soon as the migrations run, whereas the
knowledge base needs the seed and the worker behind it. Real accounts over
demo data is a supported middle state, and the DEMO ribbon says which half is
which.

**Home depends on who you are.** An admin lands on the admin panel; a user
lands on the areas picker and never sees the panel exists.

Identity lives in the top bar: avatar, display name, role and sign-out sit in
the user menu at top right, on every signed-in page.

The admin panel is five sections over the same knowledge base, selected from a
rail on the left. The open section is held in the query string (`/?tab=queue`),
so a section is a shareable link and the back button walks the sections:

| Section | What it is |
|---|---|
| Overview | KPIs, routines, activity feed, waiting-on-you |
| Knowledge Base | The reliability ladder (A/B/C verified, D unverified) over every claim in every status; filter, re-tier, retire |
| Review Queue | The human gate: approve / edit / reject pending findings |
| Automation | Routines and agents, run-now, 24h health, full run log |
| Users | Accounts and roles |

That is the `run → log → review → open` loop from the content-engine playbook,
applied to real-estate intelligence: the worker is the routine runner,
`routine_runs` is the log, and Review Queue is the human gate that was already
the core of this product.

- `/` — admin panel (admin) · areas picker (user)
- `/areas` — municipality picker
- `/brief/[id]` — verification registry + tiered claims + cross-gap edges
- `/ask` — question → research task
- `/review`, `/mission-control` — legacy paths, redirect into the admin panel



**Supabase (once):** create a project and run the migrations in order in the
SQL editor — `0001_schema.sql`, `0002_security.sql`, `0003_routines.sql`,
`0004_admin_user_roles.sql`, `0005_invite_only_access.sql`,
`0006_audit_and_admin_rpcs.sql`.

`0005` closes the pilot: signup is invite-only, every read requires a session,
and the `anon` role is revoked outright. **Edit the bootstrap email at the
bottom of `0005` before applying it** — it seeds the only invite that exists,
and the trigger has no exception for the first account. Then create that
account in Auth using the same address; it comes out as `admin` because the
invite row carries the role. After that, admins issue invites from the Users
tab (`invite_user()` / `revoke_invite()`, added in `0006`).

**Seed + worker:**
```bash
pip install -r requirements.txt
export DATABASE_URL="postgresql+psycopg2://postgres:...@db.<ref>.supabase.co:5432/postgres"
python -m kb.seed_grandola
python worker.py                     # or: docker compose up -d worker
```

**Frontend:**
```bash
cd web && npm install
NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... npm run dev
```

**Local dev without Supabase:** the SQLite path still works for the Python
layer (`python -m kb.seed_grandola && streamlit run dashboard/app.py`), and the
RLS layer is testable on plain Postgres:
```bash
createdb intel_test
psql -d intel_test -f tests/pg_harness.sql \
  -f supabase/migrations/0001_schema.sql -f supabase/migrations/0002_security.sql
psql -d intel_test -f tests/pg_rls_test.sql   # expect: ALL RLS TESTS PASSED
```

See **PLAN.md** for the 10-day execution plan to a live pilot.

## Architecture

```
User question ──► ResearchTask ──► Agent (Claude+web search, or offline stub)
                                        │
                                        ▼
                                   Finding (review queue)
                                        │  approve / edit / reject (team)
                                        ▼
                              KnowledgeNode (tier A–D, as_of, provenance)
                                        │
        Dashboard ◄── coverage matrix + verified nodes + cross-gap edges
                                        │
        Freshness sweep ──► stale nodes ──► auto refresh tasks  (the loop)
```

- **db/models.py** — municipalities, nodes, citations, typed edges (the graph layer, kept in SQL until traversals outgrow it), research tasks, findings.
- **agent/researcher.py** — pluggable backend. With `ANTHROPIC_API_KEY` set it uses Claude + web search under Portuguese-first source rules; without it, an offline heuristic backend produces structured tier-D research stubs so the loop still runs.
- **review/cli.py** — the human gate (also available in the dashboard's Review Queue tab).
- **kb/store.py** — reads, promotion, freshness sweep. Verified nodes past their category's freshness window degrade to STALE and automatically open refresh tasks.
- **dashboard/app.py** — Streamlit: Area Brief / Ask / Review Queue.

## Quickstart

```bash
pip install -r requirements.txt
python -m kb.seed_grandola          # seed pilot municipality (8 tiered nodes, 3 edges)
streamlit run dashboard/app.py
```

Optional real research backend:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Postgres instead of SQLite:

```bash
export DATABASE_URL=postgresql+psycopg2://user:pass@host/dbname
```

Batch operations:

```bash
python -m agent.researcher                       # process open research tasks
python -m review.cli list / show N / approve N --tier B --reviewer NAME / reject N ...
python -c "from db.session import SessionLocal; from kb.store import sweep_stale; \
           s=SessionLocal(); print(len(sweep_stale(s)),'stale')"
```

Tests: `python tests/test_loop.py` (runs the full seed → ask → agent → promote → sweep loop on a throwaway DB).

Timestamps go through `db.models.utcnow()` — naive UTC, matching the naive
`DateTime` columns. Use it rather than `datetime.now()` anywhere a row is
written, or the mixed aware/naive comparison will bite in the freshness sweep.

## Tier + freshness policy

| Tier | Meaning |
|---|---|
| A | Verified primary (registry, official publication, direct measurement) |
| B | Verified secondary (reputable report, credentialed expert on record) |
| C | Professional hearsay (industry consensus, informal network intel) |
| D | Unverified (single source, potential capture, unconfirmed) |

Freshness windows per category (days): market/financing/liquidity 90 · enforcement 120 · regulatory/tax/esg/infrastructure 180 · physical/condo/professionals/operational 365.

## Deliberate scope cuts (v1)

- **One municipality.** Depth before breadth; the seed encodes the team's validated corrections (DL 97/2026 not "Lei 9-A", DL 108/2026 in force 3 Aug 2026, AL status explicitly unverified).
- **SQL, not a graph DB.** Edges table gives cross-gap relations (AMPLIFIES / DEPENDS_ON / CONTRADICTS / SUPERSEDES); migrate only when traversal queries strain SQL.
- **No InspectOS/Rezerva ingestion yet.** The modules from the intelligence-OS spec (DRE parser, gap monitor, EPC engine, brown-stock scorer) plug in as additional Finding producers writing to the same review queue — that's the integration point, nothing else changes.

## Roadmap

1. Wire the DRE parser as a scheduled Finding producer (regulatory category, proposed tier A when the source is the DR itself).
2. Portal price tracking → market category, auto tier B, with the human gate deciding what's brief-worthy.
3. Second municipality (Sines — data-center demand story) to validate the multi-area model.
4. Client-facing read-only view (verified nodes only, tier A/B, no queue).
