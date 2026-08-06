/**
 * Data layer over Supabase. Falls back to embedded demo data when Supabase
 * env vars are absent (see lib/demo.js) so the app is fully clickable with
 * zero setup. The review-gate and routine registry live in the database;
 * this file just calls RPCs/tables or their demo mirrors.
 */
import { supabase, configured } from "@/lib/supabase";
import { demo, demoMC } from "@/lib/demo";
import { localAuth } from "@/lib/users";

export const demoMode = !configured;

function unwrap({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
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
    if (demoMode) return demo.municipalities();
    return unwrap(await supabase.from("municipalities").select("*").order("name"));
  },

  coverage: async (id) => {
    if (demoMode) return demo.coverage(id);
    const rows = unwrap(await supabase.rpc("coverage", { p_muni_id: Number(id) }));
    return Object.fromEntries(
      rows.map((r) => [r.category, {
        verified_fresh: Number(r.verified_fresh), total: Number(r.total),
        best_tier: r.best_tier, latest_as_of: r.latest_as_of,
      }])
    );
  },

  nodes: async (id, category) => {
    if (demoMode) return demo.nodes(id, category);
    let q = supabase.from("nodes_view").select("*")
      .eq("municipality_id", Number(id)).in("status", ["verified", "stale"])
      .order("tier").order("as_of", { ascending: false });
    if (category) q = q.eq("category", category);
    const rows = unwrap(await q);
    return rows.map((n) => ({ ...n, sources: n.src_list || [] }));
  },

  edges: async (id) => {
    if (demoMode) return demo.edges(id);
    return unwrap(await supabase.from("edges_view").select("*").eq("municipality_id", Number(id)));
  },

  tasks: async (id) => {
    if (demoMode) return demo.tasks(id);
    const rows = unwrap(await supabase.from("research_tasks")
      .select("id, question, status, created_at, findings(count)")
      .eq("municipality_id", Number(id))
      .order("created_at", { ascending: false }).limit(20));
    return rows.map((t) => ({ ...t, findings: t.findings?.[0]?.count ?? 0 }));
  },

  ask: async (municipality_id, question) => {
    if (demoMode) return demo.ask(municipality_id, question);
    const row = unwrap(await supabase.from("research_tasks")
      .insert({ municipality_id, question, requested_by: "web" })
      .select("id").single());
    return { task_id: row.id };
  },

  // ---------- auth ----------
  // Demo mode authenticates against the local user base in lib/users.js
  // (temporary — see TASKS.md). Configured mode uses Supabase Auth, with the
  // role coming from profiles.role, which only the service role can change.
  signIn: async (email, password) => {
    if (demoMode) return localAuth.signIn(email, password);
    return unwrap(await supabase.auth.signInWithPassword({ email, password }));
  },
  signOut: async () => (demoMode ? localAuth.signOut() : supabase?.auth.signOut()),
  session: async () =>
    (demoMode ? localAuth.session() : (await supabase.auth.getSession()).data.session),
  myProfile: async () => {
    if (demoMode) return localAuth.myProfile();
    const { data: u } = await supabase.auth.getUser();
    if (!u?.user) return null;
    return unwrap(await supabase.from("profiles").select("role, display_name")
      .eq("id", u.user.id).single());
  },

  // ---------- admin ----------
  findings: async () => {
    if (demoMode) return demo.findings();
    const rows = unwrap(await supabase.from("findings")
      .select("*, research_tasks(question)")
      .eq("review_status", "pending").order("created_at"));
    return rows.map((f) => ({ ...f, question: f.research_tasks?.question }));
  },

  approve: async (id, { tier, title = null, body = null, category = null }) => {
    if (demoMode) {
      const me = await localAuth.myProfile();
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
    if (demoMode) return demo.reject(id, { note });
    unwrap(await supabase.rpc("reject_finding", { p_finding_id: id, p_note: note }));
    return { rejected: id };
  },

  onNewFindings: (handler) => {
    if (demoMode) return demo.onNewFindings(handler);
    const ch = supabase.channel("findings-feed")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "findings" }, handler)
      .subscribe();
    return () => supabase.removeChannel(ch);
  },

  // ---------- admin: knowledge base management ----------
  // Every node in every status, across every municipality. Reader-facing
  // calls (api.nodes) stay filtered to verified/stale; this is the admin view.
  allNodes: async () => {
    if (demoMode) return demo.allNodes();
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
    if (demoMode) return demo.updateNode(id, patch, note);
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
  invites: async () => {
    if (demoMode) return demo.invites();
    return unwrap(await supabase.from("invited_emails")
      .select("email, role, invited_at, claimed_at").order("invited_at", { ascending: false }));
  },

  inviteUser: async (email, role) => {
    if (demoMode) return demo.inviteUser(email, role);
    return unwrap(await supabase.rpc("invite_user", { p_email: email, p_role: role }));
  },

  revokeInvite: async (email) => {
    if (demoMode) return demo.revokeInvite(email);
    return unwrap(await supabase.rpc("revoke_invite", { p_email: email }));
  },

  audit: async (limit = 50) => {
    if (demoMode) return demo.audit(limit);
    return unwrap(await supabase.from("audit_log").select("*")
      .order("at", { ascending: false }).limit(limit));
  },

  // ---------- admin: users ----------
  users: async () => {
    if (demoMode) return localAuth.listUsers();
    return unwrap(await supabase.from("profiles").select("id, role, display_name"));
  },

  // Still service-role only: 0006 deliberately added invite_user but not
  // set_user_role, because an existing user's role is the rarer change and
  // deserves its own decision (edge function vs table editor) — see TASKS.md.
  // The common case, provisioning someone with the right role from the start,
  // is now covered by the invite carrying the role.
  setUserRole: async (email, role) => {
    if (demoMode) return localAuth.setRole(email, role);
    throw new Error(
      "Role changes require the service role (no client update policy on " +
      "profiles). Change it in the Supabase table editor, or invite the " +
      "person with the role you want. See TASKS.md."
    );
  },

  createUser: async (u) => {
    if (demoMode) return localAuth.createUser(u);
    throw new Error(
      "Accounts are created by signup, not here: invite the address instead " +
      "and they sign up themselves (0005 makes signup invite-only)."
    );
  },

  deleteUser: async (email) => {
    if (demoMode) return localAuth.deleteUser(email);
    throw new Error("Delete users in Supabase Auth, not here. See TASKS.md.");
  },

  resetUsers: async () => {
    if (demoMode) return localAuth.reset();
    throw new Error("Not applicable outside demo mode.");
  },

  // ---------- mission control ----------
  routines: async () => {
    if (demoMode) return demoMC.routines();
    const runs = unwrap(await supabase.from("routine_runs").select("*")
      .order("started_at", { ascending: false }).limit(100));
    return ROUTINE_REGISTRY.map((r) => ({
      ...r, last_run: runs.find((x) => x.routine === r.name) || null,
    }));
  },

  runs: async (limit = 20) => {
    if (demoMode) return demoMC.runs(limit);
    return unwrap(await supabase.from("routine_runs").select("*")
      .order("started_at", { ascending: false }).limit(limit));
  },

  runNow: async (routine) => {
    if (demoMode) return demoMC.runNow(routine);
    return unwrap(await supabase.from("routine_commands")
      .insert({ routine, requested_by: "dashboard" }).select().single());
  },

  kpis: async () => {
    if (demoMode) return demoMC.kpis();
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
