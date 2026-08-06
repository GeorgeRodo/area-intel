/**
 * Demo mode. Active only when Supabase env vars are absent.
 * Mirrors the Grandola seed and keeps state in memory so the full loop is
 * clickable in a design demo: ask -> finding -> approve -> brief updates.
 */

const today = () => new Date().toISOString().slice(0, 10);

let nextNodeId = 100;
let nextTaskId = 10;
let nextFindingId = 50;

export const demoMunicipalities = [
  {
    id: 1,
    name: "Grandola",
    district: "Setubal",
    region: "Alentejo Litoral",
    notes:
      "Pilot municipality. Covers Melides, Carvalhal/Comporta fringe, Grandola town.",
  },
  {
    id: 2,
    name: "Sines",
    district: "Setubal",
    region: "Alentejo Litoral",
    notes:
      "Planned second municipality. Data-center corridor: workforce rental demand vs industrial-town risk.",
  },
];

const S = (name, url) => [{ name, url }];

export let demoNodes = [
  {
    id: 1, municipality_id: 1, category: "regulatory", tier: "A", status: "verified",
    as_of: today(), fresh: true, verified_by: "team-seed",
    title: "IMT: flat 7.5% rate for non-resident buyers under DL 97/2026",
    body: "Decreto-Lei n. 97/2026 (published 20 May 2026, in force 25 May 2026) introduced the differentiated IMT treatment for non-resident buyers. Note: this is DL 97/2026, not 'Lei 9-A/2026' as circulated in some advisories. Model both regimes when underwriting for clients with pending residency applications.",
    sources: S("Diario da Republica", "https://diariodarepublica.pt"),
  },
  {
    id: 2, municipality_id: 1, category: "regulatory", tier: "A", status: "verified",
    as_of: today(), fresh: true, verified_by: "team-seed",
    title: "DL 108/2026 in force 3 August 2026: legalization pathway amendments to RJUE/RRU",
    body: "DL 108/2026 (DR 29 May 2026) amends RJUE (DL 555/99) and RRU, building on the Simplex urbanistico agenda. Delegates significant interpretive authority to municipal engineers; expect per-municipality variance in area tolerance, use classification, and documentation depth.",
    sources: S("Diario da Republica", "https://diariodarepublica.pt"),
  },
  {
    id: 3, municipality_id: 1, category: "enforcement", tier: "C", status: "verified",
    as_of: today(), fresh: true, verified_by: "team-seed",
    title: "Grandola camara: legalization processing posture unverified; lax-pattern suspected",
    body: "No direct file experience in this camara yet. Coastal Alentejo municipalities with high illegal-construction shares have historically sat at the lax end of the enforcement spectrum, but DL 108/2026 implementation could shift posture. Verification protocol: one local architect with recent Simplex filings; backlog figure at the urbanismo desk in person.",
    sources: S("Team field research", null),
  },
  {
    id: 4, municipality_id: 1, category: "market", tier: "B", status: "verified",
    as_of: today(), fresh: true, verified_by: "team-seed",
    title: "Melides median asking ~EUR 7,240/m2, +5.2% YoY; extreme dispersion",
    body: "Active listings span roughly EUR 349K to EUR 17M (~120 listings), meaning the median is thin and quality-mix driven. Treat any single price point as directional; re-derive from INE transaction data before publishing client-facing numbers.",
    sources: S("Confidencial Imobiliario", "https://www.confidencialimobiliario.com"),
  },
  {
    id: 5, municipality_id: 1, category: "liquidity", tier: "C", status: "verified",
    as_of: today(), fresh: true, verified_by: "team-seed",
    title: "Comporta/Alentejo coast gross yields ~3.4%; exit liquidity thin above EUR 1M",
    body: "Yield-vs-lifestyle tension defines this micro-market: prices are set by lifestyle premium buyers, not income math. Relationship-driven sales above EUR 1M with multi-year days-on-market tails. No verified days-on-market series exists yet; reconstruction from portal tracking is underway.",
    sources: S("Confidencial Imobiliario", "https://www.confidencialimobiliario.com"),
  },
  {
    id: 6, municipality_id: 1, category: "physical", tier: "C", status: "verified",
    as_of: today(), fresh: true, verified_by: "team-seed",
    title: "Brown-stock profile: ~60% pre-1990; illegal construction elevated on coast",
    body: "Census-derived modelling puts pre-1990 stock near 60% with illegal-construction share well above national average in coastal parishes. Implication: legalization-plus-renovation cost path applies to a large share of inventory. Needs parish-level verification via municipal archive and one structural engineer.",
    sources: S("Team field research", null),
  },
  {
    id: 7, municipality_id: 1, category: "regulatory", tier: "D", status: "verified",
    as_of: today(), fresh: true, verified_by: "team-seed",
    title: "AL (Alojamento Local) licensing status in Grandola: not yet confirmed",
    body: "National policy permits AL outside pressure zones, but individual camaras operate informal moratoria and condo-approval requirements that do not appear in national databases. Do not underwrite rental income for any client until written confirmation of AL eligibility for the specific parish is obtained.",
    sources: S("Camara Municipal de Grandola", "https://www.cm-grandola.pt"),
  },
  {
    id: 8, municipality_id: 1, category: "infrastructure", tier: "B", status: "verified",
    as_of: today(), fresh: true, verified_by: "team-seed",
    title: "Demand driver: Comporta spillover + Sines industrial build-out within commute radius",
    body: "Two independent demand vectors: lifestyle premium migrating south from Comporta into Melides, and the Sines data-center complex (Start Campus ~EUR 8.5B/1.2GW, Microsoft-linked announcements, Nscale ~EUR 695M) creating professional rental demand. These pull the market in opposite directions and should be scored separately.",
    sources: S("Team field research", null),
  },
];

export const demoEdges = [
  {
    relation: "DEPENDS_ON", municipality_id: 1,
    src: { id: 2, title: "DL 108/2026 in force 3 August 2026" },
    dst: { id: 3, title: "Grandola camara: legalization processing posture unverified" },
    note: "DL 108/2026 impact on any legalization is gated by camara posture",
  },
  {
    relation: "AMPLIFIES", municipality_id: 1,
    src: { id: 6, title: "Brown-stock profile: ~60% pre-1990" },
    dst: { id: 3, title: "Grandola camara: legalization processing posture unverified" },
    note: "High illegal-construction share raises the stakes of enforcement variance",
  },
  {
    relation: "AMPLIFIES", municipality_id: 1,
    src: { id: 7, title: "AL licensing status: not yet confirmed" },
    dst: { id: 5, title: "Exit liquidity thin above EUR 1M" },
    note: "AL uncertainty compounds thin exit liquidity for yield-motivated buyers",
  },
];

export let demoTasks = [
  {
    id: 1, municipality_id: 1, status: "answered",
    question: "What is the current AL licensing posture in Melides parish?",
    created_at: new Date().toISOString(), findings: 1,
  },
];

export let demoFindings = [
  {
    id: 1, task_id: 1, category: "regulatory", proposed_tier: "D",
    review_status: "pending",
    title: "[NEEDS VERIFICATION] AL licensing posture in Melides parish",
    body: "Agent draft: Turismo de Portugal registry shows no parish-level moratoria flag for Grandola, but two 2026 forum reports mention informal condo-approval requests at the camara. Field protocol: written confirmation from the camara urbanismo desk; cross-check Turismo de Portugal RNAL registry entry for the parish.",
    source_name: "RNAL registry (unconfirmed)",
    source_url: "https://rnt.turismodeportugal.pt",
    question: "What is the current AL licensing posture in Melides parish?",
  },
  {
    id: 2, task_id: 1, category: "financing", proposed_tier: "D",
    review_status: "pending",
    title: "[NEEDS VERIFICATION] Non-resident LTV quotes for Grandola villas",
    body: "Agent draft: broker marketing pages quote 60-70% LTV for EU non-residents; one 2026 report suggests Millennium BCP tightened US-citizen self-employed files to 50-60%. Field protocol: two broker quotes for the same synthetic profile, cross-checked before any tier above C.",
    source_name: "UNGROUNDED",
    source_url: "",
    question: "What is the current AL licensing posture in Melides parish?",
  },
];

// ---------- in-memory operations (mirror the real API surface) ----------

const FRESHNESS = { market: 90, financing: 90, liquidity: 90, enforcement: 120,
  regulatory: 180, tax: 180, esg: 180, infrastructure: 180 };
const CATS = ["market","regulatory","enforcement","physical","financing","condo",
  "tax","liquidity","professionals","operational","esg","infrastructure"];

export const demo = {
  municipalities: async () => demoMunicipalities,

  coverage: async (id) => {
    const out = {};
    for (const c of CATS) {
      const nodes = demoNodes.filter(
        (n) => n.municipality_id === Number(id) && n.category === c &&
               ["verified", "stale"].includes(n.status));
      const fresh = nodes.filter((n) => n.fresh && n.status === "verified");
      out[c] = {
        verified_fresh: fresh.length,
        total: nodes.length,
        best_tier: fresh.length ? fresh.map((n) => n.tier).sort()[0] : null,
        latest_as_of: nodes.length ? nodes.map((n) => n.as_of).sort().at(-1) : null,
      };
    }
    return out;
  },

  nodes: async (id, category) =>
    demoNodes
      .filter((n) => n.municipality_id === Number(id) &&
                     ["verified", "stale"].includes(n.status) &&
                     (!category || n.category === category))
      .sort((a, b) => a.tier.localeCompare(b.tier)),

  edges: async (id) => demoEdges.filter((e) => e.municipality_id === Number(id)),

  tasks: async (id) =>
    demoTasks.filter((t) => t.municipality_id === Number(id))
      .sort((a, b) => b.id - a.id),

  ask: async (municipality_id, question) => {
    const task = { id: nextTaskId++, municipality_id, question,
      status: "answered", created_at: new Date().toISOString(), findings: 1 };
    demoTasks.push(task);
    demoFindings.push({
      id: nextFindingId++, task_id: task.id, category: "market",
      proposed_tier: "D", review_status: "pending",
      title: `[NEEDS VERIFICATION] ${question.slice(0, 140)}`,
      body: "Agent draft (demo): structured research stub. In production this is a grounded finding from Claude + web search under Portuguese-first source rules, with a real source URL attached.",
      source_name: "UNGROUNDED", source_url: "", question,
    });
    return { task_id: task.id };
  },

  findings: async () => demoFindings.filter((f) => f.review_status === "pending"),

  approve: async (id, { tier, body = null, category = null, verified_by = "admin" }) => {
    const f = demoFindings.find((x) => x.id === id && x.review_status === "pending");
    if (!f) throw new Error("finding not found or already reviewed");
    const task = demoTasks.find((t) => t.id === f.task_id);
    const node = {
      id: nextNodeId++, municipality_id: task?.municipality_id ?? 1,
      category: category || f.category, tier, status: "verified",
      as_of: today(), fresh: true, verified_by,
      title: f.title.replace("[NEEDS VERIFICATION] ", ""),
      body: body || f.body,
      sources: f.source_name && f.source_name !== "UNGROUNDED"
        ? S(f.source_name, f.source_url) : [],
    };
    demoNodes.push(node);
    f.review_status = body || category ? "edited" : "approved";
    return { node_id: node.id, tier };
  },

  reject: async (id, { note }) => {
    const f = demoFindings.find((x) => x.id === id && x.review_status === "pending");
    if (!f) throw new Error("finding not found or already reviewed");
    f.review_status = "rejected";
    f.review_note = note;
    return { rejected: id };
  },

  onNewFindings: () => () => {},

  // ---------- admin: knowledge base management ----------
  // Unlike demo.nodes() (reader view: verified + stale only) this returns
  // every node in every status, which is what the admin panel manages.
  allNodes: async () =>
    demoNodes
      .map((n) => ({
        ...n,
        municipality:
          demoMunicipalities.find((m) => m.id === n.municipality_id)?.name || "—",
      }))
      .sort((a, b) => a.tier.localeCompare(b.tier) || b.id - a.id),

  updateNode: async (id, patch) => {
    const n = demoNodes.find((x) => x.id === id);
    if (!n) throw new Error("node not found");
    if (patch.tier && !["A", "B", "C", "D"].includes(patch.tier)) {
      throw new Error(`invalid tier: ${patch.tier}`);
    }
    Object.assign(n, patch);
    if (patch.status && patch.status !== "verified") n.fresh = false;
    if (patch.status === "verified") n.fresh = true;
    return { ...n };
  },

  deleteNode: async (id) => {
    const i = demoNodes.findIndex((x) => x.id === id);
    if (i === -1) throw new Error("node not found");
    demoNodes.splice(i, 1);
    return { deleted: id };
  },
};

// ---------- Mission Control demo data ----------

const minsAgo = (m) => new Date(Date.now() - m * 60000).toISOString();

// `planned: true` means the routine is on the roadmap but not implemented in
// worker.py. It is listed so the automation layer shows where it is going, and
// flagged so the UI never renders it as something that runs — a demo that
// advertises a working DRE parser is a demo that lies. Drop the flag when the
// producer lands (PLAN.md days 5 and 7).
export const demoRoutines = [
  { name: "agent_tasks", schedule: "every 60s",
    description: "Process open research questions into draft findings" },
  { name: "freshness_sweep", schedule: "hourly",
    description: "Degrade expired verified nodes to stale; queue refreshes" },
  { name: "dre_parser", schedule: "daily 08:00", planned: true,
    description: "Scan Diario da Republica for IMT / RJUE / AL / EPC changes" },
  { name: "portal_tracker", schedule: "daily 06:00", planned: true,
    description: "Snapshot listing counts + median asking per concelho" },
];

// Only implemented routines appear here: a planned routine has no run history
// because it has never run.
export let demoRuns = [
  { id: 3, routine: "agent_tasks", status: "ok", items_out: 2,
    detail: "2 finding(s) -> review queue", started_at: minsAgo(65) },
  { id: 4, routine: "freshness_sweep", status: "ok", items_out: 0,
    detail: "0 node(s) marked stale", started_at: minsAgo(62) },
  { id: 5, routine: "agent_tasks", status: "failed", items_out: 0,
    detail: "anthropic api timeout (retry scheduled)", started_at: minsAgo(15) },
];
let nextRunId = 6;

export const demoMC = {
  routines: async () => {
    return demoRoutines.map((r) => {
      const runs = demoRuns.filter((x) => x.routine === r.name)
        .sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
      return { ...r, last_run: runs[0] || null };
    });
  },

  runs: async (limit = 20) =>
    [...demoRuns].sort((a, b) => new Date(b.started_at) - new Date(a.started_at)).slice(0, limit),

  runNow: async (routine) => {
    if (demoRoutines.find((r) => r.name === routine)?.planned)
      throw new Error(`${routine} is planned, not implemented — nothing to run yet.`);
    const isAgent = routine === "agent_tasks";
    const run = {
      id: nextRunId++, routine, status: "ok",
      items_out: isAgent ? 1 : 0,
      detail: isAgent ? "1 finding(s) -> review queue (run-now)" : "manual run complete",
      started_at: new Date().toISOString(),
    };
    demoRuns.push(run);
    if (isAgent) {
      demoFindings.push({
        id: 90 + run.id, task_id: 1, category: "market", proposed_tier: "D",
        review_status: "pending",
        title: "[NEEDS VERIFICATION] Run-now demo finding",
        body: "Produced by the run-now trigger in demo mode. In production this is the worker executing the routine and logging back here.",
        source_name: "UNGROUNDED", source_url: "",
        question: "Manual trigger",
      });
    }
    return run;
  },

  kpis: async () => {
    const pending = demoFindings.filter((f) => f.review_status === "pending").length;
    const verified = demoNodes.filter((n) => n.status === "verified").length;
    const stale = demoNodes.filter((n) => n.status === "stale" || !n.fresh).length;
    const failed = demoRuns.filter((r) => r.status === "failed").length;
    return { pending_review: pending, verified_nodes: verified,
             stale_nodes: stale, failed_runs_24h: failed,
             municipalities: demoMunicipalities.length };
  },
};
