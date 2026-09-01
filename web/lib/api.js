/**
 * Data layer over Supabase. Falls back to embedded demo data when Supabase
 * env vars are absent (see lib/demo.js) so the app is fully clickable with
 * zero setup. The review-gate and routine registry live in the database;
 * this file just calls RPCs/tables or their demo mirrors.
 *
 * Two independent switches, because the two halves migrate to Supabase at
 * different times:
 *
 *   localUsers — sign-in, profiles and invitations. Flips to Supabase Auth as
 *                soon as the env vars exist. Roles come from profiles.role,
 *                which only the service role can change.
 *   demoData   — municipalities, claims, findings, routines. Stays on the
 *                embedded fixtures until NEXT_PUBLIC_SUPABASE_DATA=1, so the
 *                app can run on real accounts against a database that has no
 *                knowledge base in it yet.
 *
 * Real accounts over demo data is the deliberate middle state, not an
 * accident: it is what lets the invite-only gate (0005) be exercised before
 * the seed lands. Setting NEXT_PUBLIC_SUPABASE_DATA without the URL/key does
 * nothing — there is no client to talk to.
 */
import { supabase, configured } from "@/lib/supabase";
import { demo, demoMC, demoWiki } from "@/lib/demo";
import { localAuth } from "@/lib/users";

export const localUsers = !configured;
export const demoData =
  !configured || process.env.NEXT_PUBLIC_SUPABASE_DATA !== "1";

function unwrap({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Call one of the server routes under /api/admin. Those hold the service role
 * key and do the work the anon key is not allowed to do — read email addresses
 * out of auth.users, set a password, delete an account.
 *
 * The access token goes up as a bearer header and the route verifies it and
 * re-reads the caller's role server-side. Nothing here is a permission check:
 * this function is reachable from any console. The gate is on the other end.
 */
async function adminFetch(path, { method = "GET", body } = {}) {
  const { data: { session } = {} } = await supabase.auth.getSession();
  if (!session) throw new Error("Your session has expired — sign in again.");

  const res = await fetch(`/api/admin${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.access_token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || `Request failed (${res.status}).`);
  return payload;
}

// Mirrors the routines worker.py actually schedules. Roadmap routines belong
// here only with `planned: true`, which the UI renders as a listed-but-not-
// running row (see components/mission.jsx) — keep the two lists honest until
// the registry moves into the database and both read the same source.
const ROUTINE_REGISTRY = [
  { name: "agent_tasks", schedule: "every 60s",
    description: "Process open research questions into draft findings" },
  { name: "freshness_sweep", schedule: "hourly",
    description: "Degrade expired verified nodes to stale; queue refreshes" },
];

export const api = {
  // ---------- user ----------
  municipalities: async () => {
    if (demoData) return demo.municipalities();
    return unwrap(await supabase.from("municipalities").select("*").order("name"));
  },

  coverage: async (id) => {
    if (demoData) return demo.coverage(id);
    const rows = unwrap(await supabase.rpc("coverage", { p_muni_id: Number(id) }));
    return Object.fromEntries(
      rows.map((r) => [r.category, {
        verified_fresh: Number(r.verified_fresh), total: Number(r.total),
        best_tier: r.best_tier, latest_as_of: r.latest_as_of,
      }])
    );
  },

  nodes: async (id, category) => {
    if (demoData) return demo.nodes(id, category);
    let q = supabase.from("nodes_view").select("*")
      .eq("municipality_id", Number(id)).in("status", ["verified", "stale"])
      .order("tier").order("as_of", { ascending: false });
    if (category) q = q.eq("category", category);
    const rows = unwrap(await q);
    return rows.map((n) => ({ ...n, sources: n.src_list || [] }));
  },

  edges: async (id) => {
    if (demoData) return demo.edges(id);
    return unwrap(await supabase.from("edges_view").select("*").eq("municipality_id", Number(id)));
  },

  tasks: async (id) => {
    if (demoData) return demo.tasks(id);
    const rows = unwrap(await supabase.from("research_tasks")
      .select("id, question, status, created_at, findings(count)")
      .eq("municipality_id", Number(id))
      .order("created_at", { ascending: false }).limit(20));
    return rows.map((t) => ({ ...t, findings: t.findings?.[0]?.count ?? 0 }));
  },

  // The insert has to satisfy tasks_insert (0005): a session, a municipality,
  // and a question of 5–2000 characters. RLS states its refusals as "new row
  // violates row-level security policy", which tells the asker nothing about
  // which of those was wrong — so the two the person can actually fix are
  // checked here, in language they can act on. The trim matters as well as the
  // length: the policy counts the stored string, so trailing whitespace could
  // push a question past 2000 that the UI had measured as under it.
  ask: async (municipality_id, question) => {
    const text = String(question || "").trim();
    if (text.length < 5) throw new Error("That question is too short to research.");
    if (text.length > 2000) {
      throw new Error(
        `That question is ${text.length} characters; the limit is 2000. ` +
          `Split it into separate questions — each one becomes its own task.`
      );
    }
    if (demoData) return demo.ask(municipality_id, text);
    const row = unwrap(await supabase.from("research_tasks")
      .insert({ municipality_id, question: text, requested_by: "web" })
      .select("id").single());
    return { task_id: row.id };
  },

  // ---------- auth ----------
  // Without env vars this authenticates against the local user base in
  // lib/users.js (temporary — see TASKS.md). With them, Supabase Auth, and the
  // role comes from profiles.role, which only the service role can change.
  signIn: async (email, password) => {
    if (localUsers) return localAuth.signIn(email, password);
    return unwrap(await supabase.auth.signInWithPassword({ email, password }));
  },
  signOut: async () => (localUsers ? localAuth.signOut() : supabase?.auth.signOut()),
  session: async () =>
    (localUsers ? localAuth.session() : (await supabase.auth.getSession()).data.session),
  // Self-serve account creation. There is no allow-list check here on purpose:
  // handle_new_user() (0005) raises for an uninvited address and rolls the
  // auth.users insert back with it, so the rule is enforced by the database
  // and cannot be walked around by calling this from a console. What arrives
  // back is a raw Postgres failure, so it is translated into something the
  // person reading it can act on.
  //
  // display_name is passed as user metadata `name`, which is exactly where
  // handle_new_user() looks before falling back to the local part of the email.
  signUp: async (email, password, display_name) => {
    if (localUsers) {
      throw new Error("Sign-up needs Supabase — this is the local test user base.");
    }
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name: display_name?.trim() || undefined } },
    });
    if (error) {
      const raw = error.message || "";
      if (/invite|Database error saving new user/i.test(raw)) {
        throw new Error(
          "That address has not been invited. Ask an admin to invite it first — " +
            "accounts cannot be created without one."
        );
      }
      throw new Error(raw);
    }
    // With email confirmation on, signUp returns a user but no session.
    return { user: data.user, session: data.session, needsConfirmation: !data.session };
  },

  // The account holder setting their own password — the far end of a recovery
  // link, and the only path where the password is known to nobody but them.
  // Acts on whatever session exists, including the short-lived one that
  // clicking a recovery link establishes.
  setMyPassword: async (password) => {
    if (localUsers) {
      throw new Error("The local test user base has no password reset.");
    }
    return unwrap(await supabase.auth.updateUser({ password }));
  },

  // profiles has no email column — the address lives in auth.users, which no
  // client role can read. Carrying id and email over from the session is what
  // lets the Users tab recognise which row is you (see UsersPanel/UserRow).
  myProfile: async () => {
    if (localUsers) return localAuth.myProfile();
    const { data: u } = await supabase.auth.getUser();
    if (!u?.user) return null;
    const row = unwrap(await supabase.from("profiles").select("role, display_name")
      .eq("id", u.user.id).single());
    return { ...row, id: u.user.id, email: u.user.email };
  },

  // ---------- admin ----------
  findings: async () => {
    if (demoData) return demo.findings();
    const rows = unwrap(await supabase.from("findings")
      .select("*, research_tasks(question)")
      .eq("review_status", "pending").order("created_at"));
    return rows.map((f) => ({ ...f, question: f.research_tasks?.question }));
  },

  approve: async (id, { tier, title = null, body = null, category = null }) => {
    if (demoData) {
      // Through api.myProfile, not localAuth: in the middle state the signed-in
      // admin is a Supabase account, and the fixture should be stamped with the
      // real person who approved it.
      const me = await api.myProfile();
      return demo.approve(id, {
        tier, title, body, category, verified_by: me?.display_name || "admin",
      });
    }
    const node_id = unwrap(await supabase.rpc("promote_finding", {
      p_finding_id: id, p_tier: tier, p_title: title, p_body: body, p_category: category,
    }));
    return { node_id, tier };
  },

  reject: async (id, { note }) => {
    if (demoData) return demo.reject(id, { note });
    unwrap(await supabase.rpc("reject_finding", { p_finding_id: id, p_note: note }));
    return { rejected: id };
  },

  onNewFindings: (handler) => {
    if (demoData) return demo.onNewFindings(handler);
    const ch = supabase.channel("findings-feed")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "findings" }, handler)
      .subscribe();
    return () => supabase.removeChannel(ch);
  },

  // ---------- admin: knowledge base management ----------
  // Every node in every status, across every municipality. Reader-facing
  // calls (api.nodes) stay filtered to verified/stale; this is the admin view.
  allNodes: async () => {
    if (demoData) return demo.allNodes();
    const [rows, munis] = await Promise.all([
      supabase.from("nodes_view").select("*").order("tier").order("as_of", { ascending: false }),
      supabase.from("municipalities").select("id, name"),
    ]);
    const names = Object.fromEntries((munis.data || []).map((m) => [m.id, m.name]));
    return unwrap(rows).map((n) => ({
      ...n,
      sources: n.src_list || [],
      municipality: names[n.municipality_id] || "—",
    }));
  },

  // The database denies direct writes to knowledge_nodes from any client role
  // (0002_security.sql), so these go through the security-definer RPCs added
  // in 0006. Each one demands a reason and writes an audit row: the point of
  // the tier ladder is that a claim's standing is always attributable.
  updateNode: async (id, patch, note) => {
    if (demoData) return demo.updateNode(id, patch, note);
    if (patch.tier)
      return unwrap(await supabase.rpc("retier_node", {
        p_node_id: Number(id), p_tier: patch.tier, p_note: note,
      }));
    if (patch.status)
      return unwrap(await supabase.rpc("set_node_status", {
        p_node_id: Number(id), p_status: patch.status, p_note: note,
      }));
    throw new Error("updateNode: nothing to change (expected tier or status).");
  },

  // There is no hard delete, by design: a claim that stopped being true is
  // retired to 'rejected' with a reason attached, so the record of what was
  // once believed — and why it was dropped — survives. See 0006.
  retireNode: async (id, note) => api.updateNode(id, { status: "rejected" }, note),

  // ---------- admin: invitations ----------
  // Part of the users half, not the data half: an invite is how an account
  // comes to exist, so these follow Supabase Auth rather than the knowledge
  // base. They need 0006 applied — 0005 created invited_emails and its RLS
  // policy but never granted select, so without 0006 these fail at the
  // privilege layer ("permission denied for table invited_emails").
  invites: async () => {
    if (localUsers) return demo.invites();
    return unwrap(await supabase.from("invited_emails")
      .select("email, role, invited_at, claimed_at, link_generated_at")
      .order("invited_at", { ascending: false }));
  },

  // The only invitation path. Allow-lists the address and hands back a link for
  // you to pass on; nothing is emailed.
  //
  // There used to be an `inviteUser` alongside this that went through
  // Supabase's built-in mailer. It is gone rather than deprecated, because it
  // could not be relied on and failed in the worst possible way: that mailer
  // only delivers to members of the Supabase organisation, and a message to
  // anyone else was accepted, reported as sent, and silently dropped — no
  // error, no bounce, nothing in any log. A button that cannot tell you it did
  // not work is worse than no button. Custom SMTP would have fixed it; not
  // doing SMTP means removing the path instead of leaving it to mislead.
  //
  // Returns { link, email, role, mode }. `mode` is 'invite' for a new account
  // or 'recovery' for one that exists but has never been signed in to.
  inviteLink: async (email, role) => {
    // The local user base has no Supabase Auth behind it, so there is no link
    // to mint — allow-list the address so the demo still walks, and say so.
    if (localUsers) {
      await demo.inviteUser(email, role);
      return { email, role, link: null, mode: "invite" };
    }
    return adminFetch("/invites/link", { method: "POST", body: { email, role } });
  },

  revokeInvite: async (email) => {
    if (localUsers) return demo.revokeInvite(email);
    return unwrap(await supabase.rpc("revoke_invite", { p_email: email }));
  },

  // Follows the users half too: with real accounts the invite RPCs are already
  // writing real audit rows, so reading them from the fixtures would be a lie.
  // Node re-tiers stay demo until the data half flips, so the log is sparse in
  // the middle state — sparse and true beats complete and invented.
  audit: async (limit = 50) => {
    if (localUsers) return demo.audit(limit);
    return unwrap(await supabase.from("audit_log").select("*")
      .order("at", { ascending: false }).limit(limit));
  },

  // ---------- admin: users ----------
  // The directory comes from the server route, not from profiles directly:
  // the email address lives in auth.users and no client role can read it, so
  // a straight profiles select can only show uuids.
  users: async () => {
    if (localUsers) return localAuth.listUsers();
    return adminFetch("/users");
  },

  // A role is a column in profiles, so this is a plain RPC with an is_admin()
  // gate — no elevated key involved (0008). The guards against self-demotion
  // and removing the last admin live in the function, where a second client
  // cannot route around them.
  // note is optional (0009): only deletion demands one, because only deletion
  // destroys the thing you would otherwise go and look at.
  setUserRole: async (user, role, note = null) => {
    if (localUsers) return localAuth.setRole(user.email, role);
    return unwrap(await supabase.rpc("set_user_role", {
      p_user_id: user.id, p_role: role, p_note: note ?? null,
    }));
  },

  // Passwords live in auth.users as bcrypt hashes, so there is no read
  // counterpart — only replace. There used to be a `sendPasswordRecovery`
  // beside this that mailed the holder a reset link instead, which is the
  // better shape; it went with the rest of the email paths, because Supabase's
  // built-in mailer silently drops anything addressed outside the Supabase
  // organisation. Bring it back with custom SMTP, not before.
  //
  // The route ends the account's sessions as well (0014) and reports what it
  // removed — `{ revoked, revocation_failed, self }` — because replacing the
  // credential on its own left every session that already existed working.
  setUserPassword: async (user, password, note = null) =>
    adminFetch(`/users/${user.id}/password`, {
      method: "POST", body: { password, note },
    }),


  // Creates the account outright — allow-lists the address and then makes it,
  // with no email anywhere in the path. The interim answer while Supabase's
  // built-in mailer cannot reliably deliver an invitation (TASKS.md #3): the
  // admin sets the password and passes it on over a channel they already have.
  //
  // Note what this trades away. Every other path here was shaped so that only
  // the account holder ever knows their password; this one cannot be. Prefer
  // an invitation, or Copy link, where either will actually reach the person.
  createUser: async (u) => {
    if (localUsers) return localAuth.createUser(u);
    return adminFetch("/users", { method: "POST", body: u });
  },

  deleteUser: async (user, note) => {
    if (localUsers) return localAuth.deleteUser(user.email);
    return adminFetch(`/users/${user.id}`, { method: "DELETE", body: { note } });
  },

  resetUsers: async () => {
    if (localUsers) return localAuth.reset();
    throw new Error("Not applicable once accounts live in Supabase Auth.");
  },

  // ---------- knowledge base (the wiki corpus, 0007) ----------
  //
  // Read-only here, and it stays that way: 0007 gives no client role an
  // insert/update/delete policy, so content enters through kb/sync_wiki.py
  // running as the service role and nowhere else. That is the same posture
  // 0002 takes with knowledge_nodes, for the same reason.
  //
  // Keep the distinction these functions sit on top of. wiki_articles is the
  // team's compiled research — what we know. knowledge_nodes is what we have
  // verified, tiered and dated, and it remains the only thing the product may
  // present as fact. The UI must never let a reader mistake one for the other,
  // which is why nothing here returns a `tier` and why `wiki_verified` is
  // passed through under its own name rather than normalised into one.

  // Metadata only, no bodies: the index page lists ~108 articles and pulling
  // every body for a list nobody has clicked into is the whole corpus over the
  // wire to render titles.
  wikiArticles: async () => {
    if (demoData) return demoWiki.articles();
    return unwrap(
      await supabase
        .from("wiki_articles")
        .select("path, title, doc_type, tags, wiki_status, brand, wiki_verified, updated_in_wiki")
        .order("path")
    );
  },

  // One article with its body, plus the wikilinks out of it. dst_path is null
  // for a dangling link — the target was written but never created — and 0007
  // keeps those rows deliberately, so the reader can show where the vault is
  // thin instead of silently dropping them.
  wikiArticle: async (path) => {
    if (demoData) return demoWiki.article(path);

    const article = unwrap(
      await supabase.from("wiki_articles").select("*").eq("path", path).maybeSingle()
    );
    if (!article) return null;

    const links = unwrap(
      await supabase
        .from("wiki_links")
        .select("dst_slug, dst_path")
        .eq("src_path", path)
    );
    return { ...article, links: links || [] };
  },

  // Ranked search with highlighted snippets. This is wiki_search() (0007) and
  // not a .ilike() chain on purpose: the ranking definition — a 'simple'
  // tsvector, because these articles mix English prose with Portuguese legal
  // terms in one sentence and either stemmer mangles the half it was not built
  // for — belongs in one place, and that place is the migration.
  wikiSearch: async (query, limit = 20) => {
    const q = String(query || "").trim();
    if (!q) return [];
    if (demoData) return demoWiki.search(q, limit);
    return unwrap(await supabase.rpc("wiki_search", { p_query: q, p_limit: limit }));
  },

  /**
   * Corpus articles that touch a given area, for the Area Brief.
   *
   * The corpus is mostly *not* municipality-scoped — DL 108/2026, AL
   * licensing, expansive clay, the buyer journey — so this is deliberately a
   * loose topical match and is labelled as background, never as coverage of
   * the area. An area with nothing here is not a gap in the product; it means
   * the team has not written the region up, which is worth seeing.
   *
   * The OR matters. websearch_to_tsquery ANDs bare terms, so "Grandola
   * Alentejo Litoral" compiles to 'grandola' & 'alentejo' & 'litoral' and
   * returns nothing at all — the pilot municipality is named in no article,
   * while six discuss the Alentejo coast. Joining with `or` is what makes the
   * query ask the question actually intended.
   */
  wikiRelated: async (municipality, limit = 4) => {
    if (!municipality) return [];

    const terms = [municipality.name, municipality.region, municipality.district]
      .filter(Boolean)
      .join(" ")
      // Split on anything that is not a letter or digit so accents survive:
      // "Setúbal" must stay one term, not become "set" and "bal".
      .split(/[^\p{L}\p{N}]+/u)
      .map((t) => t.trim())
      // Two-letter fragments ("do", "de") match half the corpus and drown the
      // place names they sit between.
      .filter((t) => t.length > 2);

    const unique = [...new Set(terms.map((t) => t.toLowerCase()))];
    if (!unique.length) return [];

    return api.wikiSearch(unique.join(" or "), limit);
  },

  // ---------- mission control ----------
  routines: async () => {
    if (demoData) return demoMC.routines();
    const runs = unwrap(await supabase.from("routine_runs").select("*")
      .order("started_at", { ascending: false }).limit(100));
    return ROUTINE_REGISTRY.map((r) => ({
      ...r, last_run: runs.find((x) => x.routine === r.name) || null,
    }));
  },

  runs: async (limit = 20) => {
    if (demoData) return demoMC.runs(limit);
    return unwrap(await supabase.from("routine_runs").select("*")
      .order("started_at", { ascending: false }).limit(limit));
  },

  runNow: async (routine) => {
    if (demoData) return demoMC.runNow(routine);
    return unwrap(await supabase.from("routine_commands")
      .insert({ routine, requested_by: "dashboard" }).select().single());
  },

  kpis: async () => {
    if (demoData) return demoMC.kpis();
    const [nodes, findings, runs, munis] = await Promise.all([
      supabase.from("knowledge_nodes").select("status"),
      supabase.from("findings").select("id", { count: "exact", head: true }).eq("review_status", "pending"),
      supabase.from("routine_runs").select("status").gte("started_at", new Date(Date.now() - 864e5).toISOString()),
      supabase.from("municipalities").select("id", { count: "exact", head: true }),
    ]);
    const nodeRows = nodes.data || [];
    return {
      pending_review: findings.count ?? 0,
      verified_nodes: nodeRows.filter((n) => n.status === "verified").length,
      stale_nodes: nodeRows.filter((n) => n.status === "stale").length,
      failed_runs_24h: (runs.data || []).filter((r) => r.status === "failed").length,
      municipalities: munis.count ?? 0,
    };
  },
};
