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
import { demo, demoMC } from "@/lib/demo";
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

  ask: async (municipality_id, question) => {
    if (demoData) return demo.ask(municipality_id, question);
    const row = unwrap(await supabase.from("research_tasks")
      .insert({ municipality_id, question, requested_by: "web" })
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
      .select("email, role, invited_at, claimed_at").order("invited_at", { ascending: false }));
  },

  // Goes through the server route rather than straight to the RPC, because
  // allow-listing the address is only half of it — the other half is the
  // invitation email, and sending that needs the service role.
  inviteUser: async (email, role) => {
    if (localUsers) return demo.inviteUser(email, role);
    return adminFetch("/invites", { method: "POST", body: { email, role } });
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

  // Passwords live in auth.users and are stored as bcrypt hashes, so there is
  // no read counterpart to these — only replace, or hand the choice back to
  // the account holder. Prefer recovery: it keeps the password known to one
  // person, which is what makes an audit trail worth having.
  setUserPassword: async (user, password, note = null) =>
    adminFetch(`/users/${user.id}/password`, {
      method: "POST", body: { mode: "set", password, note },
    }),

  sendPasswordRecovery: async (user, note = null) =>
    adminFetch(`/users/${user.id}/password`, {
      method: "POST", body: { mode: "recovery", note },
    }),

  createUser: async (u) => {
    if (localUsers) return localAuth.createUser(u);
    throw new Error(
      "Accounts are created by signup, not here: invite the address instead " +
      "and they sign up themselves (0005 makes signup invite-only)."
    );
  },

  deleteUser: async (user, note) => {
    if (localUsers) return localAuth.deleteUser(user.email);
    return adminFetch(`/users/${user.id}`, { method: "DELETE", body: { note } });
  },

  resetUsers: async () => {
    if (localUsers) return localAuth.reset();
    throw new Error("Not applicable once accounts live in Supabase Auth.");
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
