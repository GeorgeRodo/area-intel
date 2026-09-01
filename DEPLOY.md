# Deploying the dashboard

Covers `web/` on Vercel. The worker (`worker.py`) is not deployed by any of
this — see the last section.

Supabase is already cloud, so this is the only piece that has been running
locally.

---

## 1. Get the code onto a branch Vercel can see

Vercel deploys from GitHub. The repository is `GeorgeRodo/area-intel`.

Either merge into `main` or point Vercel at the working branch — but note that
Vercel treats one branch as Production and every other branch as a Preview, and
previews get their own changing URLs, which matters for step 4.

---

## 2. Import the project

Vercel → **Add New → Project** → import `GeorgeRodo/area-intel`.

One setting matters and it is not the default:

| Setting | Value | Why |
|---|---|---|
| **Root Directory** | `web` | The Next.js app is a subdirectory. Left at the repo root, the build finds no `package.json` and fails. |
| Framework Preset | Next.js | Auto-detected once Root Directory is right. |
| Node.js Version | 22.x | Already pinned in `web/package.json` (`engines.node`). |

Build and install commands need no changes — `npm ci` and `next build` are what
the lockfile expects.

---

## 3. Environment variables

Project Settings → **Environment Variables**. Set all three for Production
(and Preview, if you want preview deployments to work).

| Name | Where from | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API Keys | Public. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | same page | Public by design — it ships in the browser bundle and RLS is the actual protection. `NEXT_PUBLIC_SUPABASE_ANON_KEY` is accepted as an alias. |
| `SUPABASE_SERVICE_ROLE_KEY` | same page, `service_role` / `secret` | **Mark as Sensitive.** Bypasses RLS entirely. |

`web/.env.example` documents all three plus the optional data-mode flag.

> ### The build now refuses to go out without these. Here is why it has to.
>
> Before this was guarded, building with the env file removed **succeeded** —
> no error, no warning, deployment live.
>
> What shipped was the fallback. `lib/supabase.js` returns `null` when the URL or
> key is missing, which makes `configured` false, which makes `localUsers`
> true — and the app drops onto `web/lib/users.js`: the seeded local user base,
> with passwords compared in plaintext in the browser, the role kept in
> client-writable `localStorage`, and two published test accounts
> (`admin@areaintel.pt` / `admin1234`).
>
> On a public URL that means anyone who finds it signs in as an admin, and
> anyone signed in can set `role: "admin"` on themselves from devtools. TASKS.md
> §1 calls this scaffolding that must not ship; a deploy with missing env vars
> ships it without telling you.
>
> The amber ribbon does say "sign-in runs on a local test user base", so the
> app was not lying — but nobody reads a ribbon before opening a login form.
>
> `web/next.config.mjs` now fails the build when `VERCEL` is set and Supabase is
> not configured, so this cannot reach a URL by accident. The check is scoped to
> Vercel deliberately: the same fallback is what makes the app walkable with no
> setup locally, and `docker-compose.yml` passes the build args through empty on
> purpose for its self-host profile. Verified in all three states — local build
> unaffected, Vercel build without the variables refuses, Vercel build with them
> passes.
>
> If a deployment already went out without them, treat that URL as public and
> redeploy before sharing it.

Do **not** add a `NEXT_PUBLIC_` prefix to the service role key. That prefix is
precisely what would inline it into the browser bundle, and the Users tab's
whole security model assumes it never leaves the server.

Leave `NEXT_PUBLIC_SUPABASE_DATA` unset for now — see step 6.

---

## 4. Point Supabase Auth at the new domain — do not skip this

Supabase → **Authentication → URL Configuration**.

The app was only ever reached at `localhost:3000`, so that is all Supabase
currently trusts. Until this is changed:

- sign-in redirects fail,
- and every invitation link the Users tab mints is rejected, because
  `/api/admin/invites/link` sends `redirectTo: <origin>/signup` and Supabase
  refuses a `redirectTo` that is not allow-listed.

Set:

- **Site URL** → your production domain, e.g. `https://area-intel.vercel.app`
- **Redirect URLs** → add `https://<your-domain>/**`

If you want preview deployments to work too, add the wildcard Vercel uses for
them as well — `https://area-intel-*.vercel.app/**` — since every preview gets
a different hostname. Keep `http://localhost:3000/**` so local development
keeps working.

---

## 5. Make sure you can actually sign in

The deployed app uses **real Supabase Auth** (this is not affected by demo
mode). Signup is invite-only: `handle_new_user()` refuses any address without
an unclaimed row in `invited_emails`, so a fresh project has nobody who can get
in.

If you have not already done the bootstrap from TASKS.md §1: edit the seeded
invite at the bottom of `0005_invite_only_access.sql` to a real address, apply
the migrations, and create that account in Supabase Auth. Every later account
can then be invited from the Users tab.

---

## 6. What you will get

A working, shareable dashboard with **real accounts and fixture content**.

`NEXT_PUBLIC_SUPABASE_DATA` is unset, so areas, claims, findings, routines and
the knowledge base all come from `web/lib/demo.js`. The amber ribbon at the top
says exactly that — "accounts and invitations are live on Supabase Auth, but
every claim, area and routine below is illustrative fixture data" — so the
deployment is honest about itself without anyone having to explain it.

To switch to real data later, set `NEXT_PUBLIC_SUPABASE_DATA=1` **after** the
database actually has content:

```bash
python -m kb.seed_grandola    # knowledge_nodes — the verified layer
python -m kb.sync_wiki        # wiki_articles   — the research corpus (needs 0007 applied)
```

Setting it before then shows empty areas and zeroed KPIs, which reads as a bug
rather than as an empty database.

---

## Not covered here

**The worker.** `worker.py` runs the research agent and the freshness sweep, and
Vercel is the wrong shape for it — it is a long-running loop, not a request
handler. `Dockerfile.worker` builds it for any container host (Fly.io, Railway,
a small VPS); it needs `DATABASE_URL` and `ANTHROPIC_API_KEY`. Nothing is lost
by deferring it: with the data layer on fixtures there is nothing for it to do.

**Custom SMTP.** Still not configured, so onboarding is "Copy link" and "Add
account" from the Users tab. Neither sends mail, so neither is affected by the
move to a new domain — but both mint links pointing at it, which is what step 4
is for.
