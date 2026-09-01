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

  // Mirrors retier_node / set_node_status from 0006, including the parts that
  // refuse: demo mode exists to walk the real product, so a rule the database
  // enforces has to bite here too or the demo teaches the wrong thing.
  updateNode: async (id, patch, note) => {
    const n = demoNodes.find((x) => x.id === id);
    if (!n) throw new Error("node not found");
    if ((note || "").trim().length < 3) {
      throw new Error(
        patch.tier
          ? "a reason is required to re-tier a claim"
          : "a reason is required to change a claim's status"
      );
    }
    if (patch.tier) {
      if (!["A", "B", "C", "D"].includes(patch.tier))
        throw new Error(`invalid tier: ${patch.tier}`);
      if (n.tier === patch.tier) throw new Error(`node ${id} is already tier ${patch.tier}`);
    }
    if (patch.status) {
      if (!["verified", "stale", "rejected"].includes(patch.status))
        throw new Error(
          `status ${patch.status} cannot be set by hand (allowed: verified, stale, rejected)`
        );
      if (n.status === patch.status) throw new Error(`node ${id} is already ${patch.status}`);
    }

    demoAudit.unshift({
      id: nextAuditId++,
      at: new Date().toISOString(),
      actor_name: "admin",
      action: patch.tier ? "retier_node" : "set_node_status",
      entity: "knowledge_node",
      entity_id: String(id),
      before: patch.tier ? { tier: n.tier } : { status: n.status },
      after: patch.tier ? { tier: patch.tier } : { status: patch.status },
      note,
    });

    Object.assign(n, patch);
    if (patch.status && patch.status !== "verified") n.fresh = false;
    if (patch.status === "verified") n.fresh = true;
    return { ...n };
  },
};

// ---------- invites + audit (0005 / 0006 demo mirrors) ----------

let demoInvites = [
  { email: "admin@areaintel.pt", role: "admin", invited_at: new Date(Date.now() - 6 * 864e5).toISOString(), claimed_at: new Date(Date.now() - 6 * 864e5).toISOString() },
  { email: "user@areaintel.pt", role: "user", invited_at: new Date(Date.now() - 6 * 864e5).toISOString(), claimed_at: new Date(Date.now() - 6 * 864e5).toISOString() },
];

let demoAudit = [];
let nextAuditId = 1;

Object.assign(demo, {
  invites: async () => [...demoInvites],

  inviteUser: async (email, role) => {
    const e = String(email).trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error(`${email} is not a valid email address`);
    if (!["user", "admin"].includes(role)) throw new Error(`invalid role ${role}`);
    const existing = demoInvites.find((i) => i.email === e);
    if (existing?.claimed_at)
      throw new Error(`${e} has already signed up; change the role on their profile instead`);
    if (existing) {
      existing.role = role;
      existing.invited_at = new Date().toISOString();
    } else {
      demoInvites.unshift({ email: e, role, invited_at: new Date().toISOString(), claimed_at: null });
    }
    demoAudit.unshift({
      id: nextAuditId++, at: new Date().toISOString(), actor_name: "admin",
      action: "invite_user", entity: "invited_email", entity_id: e,
      before: existing ? { role: existing.role } : null, after: { role }, note: null,
    });
    return { invited: e };
  },

  revokeInvite: async (email) => {
    const e = String(email).trim().toLowerCase();
    const i = demoInvites.findIndex((x) => x.email === e);
    if (i === -1) throw new Error(`no invite for ${e}`);
    if (demoInvites[i].claimed_at)
      throw new Error(`${e} has already signed up; revoking the invite would not remove the account`);
    const [gone] = demoInvites.splice(i, 1);
    demoAudit.unshift({
      id: nextAuditId++, at: new Date().toISOString(), actor_name: "admin",
      action: "revoke_invite", entity: "invited_email", entity_id: e,
      before: { role: gone.role }, after: null, note: null,
    });
    return { revoked: e };
  },

  audit: async (limit = 50) => demoAudit.slice(0, limit),
});

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


/* ------------------------------------------------------------------ *
 * Wiki corpus (0007: wiki_articles / wiki_links)
 * ------------------------------------------------------------------ */

/**
 * Seven real articles lifted from the pt-buyers-kb vault, bodies trimmed at a
 * paragraph boundary. Real ones on purpose: the whole point of this surface is
 * that the prose is dense, bilingual and full of wikilinks, and invented filler
 * would have hidden every layout problem that content actually causes.
 *
 * Note what these are NOT. 0007 is explicit about it and the UI has to stay
 * explicit about it too: a wiki article is the team's compiled research, not a
 * verified claim. knowledge_nodes remains the only authority for anything shown
 * to a user as fact, and `wiki_verified` below is the vault's own frontmatter
 * flag on a different axis from the A-D tier ladder. It must never be rendered
 * in a way that reads as a tier.
 */
export const demoWikiArticles = [
  {
    path: "04-entities/alojamento-local.md",
    title: "Alojamento Local (AL) — Registry, Licensing & Containment Zones",
    doc_type: "entity",
    tags: ["phase-4", "phase-8", "agency", "inspection"],
    wiki_status: "draft",
    brand: "shared",
    wiki_verified: false,
    wiki_sources: ["src-buyers-agent-playbook-2026"],
    updated_in_wiki: "2026-07-14",
    links: ["entities-hub", "lisbon", "porto", "phase-4-due-diligence", "agency-checklists", "cpcv", "phase-8-post-purchase", "algarve", "legal-hub"],
    body: "# Alojamento Local (AL) — registry, licensing & containment zones\n\n*Alojamento Local* (AL, short-term/tourist rental) registration under **RNAAL**, the national AL registry, is required for any residential rental of 30 days or less to non-residents. Promoted from a one-liner in [[entities-hub]] on 2026-07-14 — cited across 8+ pages (regional dossiers, DD streams, post-purchase, market intelligence) with no dedicated page, past the atomicity \"promote at 3+\" threshold.\n\n## The post-Mais Habitação regime (2026)\n\nThe *Mais Habitação* package significantly altered AL licensing. As of 2026:\n\n*(fixture excerpt — the synced article continues)*",
  },
  {
    path: "03-domains/legal/dl-108-2026.md",
    title: "DL 108/2026 — The Verification-Shift Cascade",
    doc_type: "entity",
    tags: ["dl-108-2026", "dl-10-2024", "dl-67-2023", "phase-4", "phase-6", "phase-7", "condominio", "inspection", "agency"],
    wiki_status: "draft",
    brand: "shared",
    wiki_verified: false,
    wiki_sources: ["src-dl-108-2026-impact-assessment"],
    updated_in_wiki: "2026-07-20",
    links: ["dl-10-2024-simplex", "platform-home-inspection", "platform-buyers-agency", "instagram-renovation-detection", "condominio-law", "dl-67-2023", "phase-4-due-diligence", "phase-6-offer-cpcv", "cpcv", "phase-7-closing"],
    body: "# DL 108/2026 — the verification-shift cascade\n\nPublished 29 May 2026, **in force from 3 August 2026**. The second, sharper phase of the Simplex reform this KB already tracks as [[dl-10-2024-simplex|DL 10/2024]] — DL 108/2026 doesn't reverse DL 10/2024, it finishes what it started: after removing state *technical* inspection of new builds, it now removes state *documentary* verification at the point of sale too. The habitation license (*licença de utilização*) is no longer required to execute a deed. A notary must instead declare in the deed whether an urban title exists, whether the seller claims it exists without producing it, or whether the seller admits it doesn't.\n\n## Why this is the sharpest confirmation yet of the founding thesis\n\nBoth platforms exist because the state stopped verifying what it used to verify, while keeping the power to punish non-compliance indefinitely. DL 10/2024 did this for construction quality; DL 108/2026 does it for legal/documentary status. The buyer who can't tell the difference between a tacitly-approved property and a materially compliant one is exactly who both [[platform-home-inspection|inspection]] and [[platform-buyers-agency|agency]] exist to protect — and DL 108/2026 widens that gap right as this venture is getting started.\n\n## The mechanism\n\n*(fixture excerpt — the synced article continues)*",
  },
  {
    path: "01-ecosystem/phase-4-due-diligence.md",
    title: "Phase 4 — Comprehensive Due Diligence",
    doc_type: "phase",
    tags: ["phase-4", "inspection", "agency", "dl-67-2023", "dl-10-2024", "dl-108-2026"],
    wiki_status: "draft",
    brand: "shared",
    wiki_verified: false,
    wiki_sources: ["src-buyers-agent-playbook-2026", "src-construction-defects-prompt-chain"],
    updated_in_wiki: "2026-07-20",
    links: ["platform-home-inspection", "condominio-law\\", "acoustic-defects\\", "seismic-risk\\", "scie-fire-safety\\", "phase-5-financing\\", "cpcv", "instagram-renovation-detection", "dl-67-2023", "dl-10-2024-simplex", "dl-108-2026", "agency-checklists", "property-types-hub", "phase-6-offer-cpcv", "phase-3-viewings", "phase-5-financing", "buyer-journey", "inspection-in-the-buyer-journey"],
    body: "# Phase 4 — Comprehensive due diligence\n\nThe load-bearing phase of the whole venture. Four DD streams run in parallel; the technical stream is where the [[platform-home-inspection|inspection platform]] lives. Playbook Ch. 5; prompt-chain modules 1–10 supply the technical depth.\n\n## The four DD streams\n\n| Stream | What it verifies | Who executes | Key artifacts |\n|---|---|---|---|\n| Legal | Title chain, encumbrances, registered vs. actual areas, licensing (licença de utilização), [[condominio-law\\|condomínio]] health | Lawyer + agent | Certidão predial, caderneta predial, actas, ficha técnica |\n| **Technical** | Structure, envelope, MEP, [[acoustic-defects\\|acoustics]], [[seismic-risk\\|seismic]], [[scie-fire-safety\\|fire/SCIE]], moisture, geology | **Inspector / perito** | Inspection report, NDT results, defect register with photos |\n| Financial | True total cost of ownership, condomínio reserve fund adequacy, pending special assessments | Agent + tax advisor | TCO model → [[phase-5-financing\\|Phase 5]] |\n| Regulatory | AL licence validity/containment zones, PDM zoning, heritage classification, EPC honesty (check ADENE) | Agent + lawyer | RNAAL extract, PDM extract, EPC verification |\n\n## The four-phase inspection sequence (from the master checklist, module 10)\n\n*(fixture excerpt — the synced article continues)*",
  },
  {
    path: "03-domains/legal/cpcv.md",
    title: "CPCV — Contrato-Promessa de Compra e Venda",
    doc_type: "concept",
    tags: ["cpcv", "phase-6", "agency"],
    wiki_status: "draft",
    brand: "homeos",
    wiki_verified: false,
    wiki_sources: ["src-buyers-agent-playbook-2026"],
    updated_in_wiki: "2026-07-20",
    links: ["dl-67-2023", "phase-4-due-diligence", "registo-predial", "dl-108-2026", "phase-6-offer-cpcv", "platform-buyers-agency", "agency-checklists"],
    body: "# CPCV — the promissory contract\n\nThe CPCV, not the deed, is where the transaction is actually won or lost: the escritura merely executes what the CPCV fixed. Playbook Ch. 7.2–7.3 and Appendix C hold the protective clause library.\n\n## Protective architecture (buyer side)\n\n- **Contingencies as conditions precedent:** financing, due-diligence outcome, licensing (licença de utilização issued), condomínio debt clearance.\n- **Sinal mechanics:** deposit sizing; statutory default symmetry (seller default → return of double the sinal); escrow discipline.\n- **Defect clauses:** remediation schedules with holdbacks; DD-derived defects listed with agreed price adjustments; *reservas* language pre-agreed for the handover record ([[dl-67-2023]]).\n- **Timeline mechanics:** completion date with defined extension triggers, not open-ended \"when documentation is ready\".\n\n## Red flags\n\n- Pressure to sign a developer's \"reservation contract\" within 48 hours before DD.\n- CPCV drafted solely by the seller's lawyer with no buyer contingencies.\n- Área declared in CPCV inconsistent with certidão predial / caderneta (>2% discrepancy = illegal works risk).\n\n*(fixture excerpt — the synced article continues)*",
  },
  {
    path: "01-ecosystem/phase-6-offer-cpcv.md",
    title: "Phase 6 — Negotiation, Offer & CPCV",
    doc_type: "phase",
    tags: ["phase-6", "agency", "cpcv", "dl-67-2023", "dl-108-2026"],
    wiki_status: "draft",
    brand: "homeos",
    wiki_verified: false,
    wiki_sources: ["src-buyers-agent-playbook-2026", "src-construction-defects-prompt-chain"],
    updated_in_wiki: "2026-07-20",
    links: ["comparables", "dl-108-2026", "cpcv", "phase-4-due-diligence", "dl-67-2023", "platform-buyers-agency", "platform-home-inspection", "phase-5-financing", "phase-7-closing", "buyer-journey"],
    body: "# Phase 6 — Negotiation, offer & CPCV\n\nWhere all upstream work converts into money saved and risk contractually neutralized. Playbook Ch. 7.\n\n## Subtasks\n\n1. **Offer strategy** — anchored in the [[comparables|comparable set]] from Phase 2 and the defect register from Phase 4. Every euro of discount is justified in writing; asking prices 10%+ above the comparable ceiling require the seller to justify, not the buyer.\n2. **CPCV drafting & review** — the promissory contract is the real battlefield; the deed merely executes it. Protective clauses: financing contingency, DD contingency, licensing condition precedent, penalty symmetry (sinal doubling), defect remediation schedules, and — as of [[dl-108-2026|DL 108/2026]] (in force 3 August 2026) — explicit urban-title disclosure mirroring the notary's mandatory deed declaration. Detail: [[cpcv]].\n3. **Deposit protection, contingencies & timelines** — sinal sizing, escrow discipline, completion timeline with defined extension mechanics.\n\n## Defects as negotiation currency\n\nTier 2 findings from the [[phase-4-due-diligence|Phase 4 triage matrix]] convert directly:\n\n*(fixture excerpt — the synced article continues)*",
  },
  {
    path: "03-domains/legal/dl-67-2023.md",
    title: "DL 67/2023 — Hidden Defects & the 30-Day Rule",
    doc_type: "entity",
    tags: ["dl-67-2023", "phase-4", "phase-6", "phase-8", "inspection", "agency"],
    wiki_status: "draft",
    brand: "shared",
    wiki_verified: false,
    wiki_sources: ["src-construction-defects-prompt-chain"],
    updated_in_wiki: "2026-07-13",
    links: ["phase-8-post-purchase", "platform-home-inspection", "phase-4-due-diligence", "phase-6-offer-cpcv", "cpcv", "content-strategy"],
    body: "# DL 67/2023 — hidden defects (*vícios ocultos*)\n\nThe consumer-protection regime governing conformity of goods including immovables. For this venture it is the primary legal weapon: it gives buyers strong rights against hidden defects, but those rights run on strict clocks that untrained buyers miss.\n\n## What matters operationally\n\n- **The 30-day notification window.** Defects must be formally notified within 30 days of discovery. Miss it, lose the lawsuit. This deadline is the urgency engine behind snagging inspections ([[phase-8-post-purchase|Phase 8]]).\n- ***Reservas* on the *Auto de Receção Provisória*.** Signing a clean acceptance record is the single biggest buyer mistake — every known defect must be recorded as a reservation at handover, which triggers the formal notification mechanism.\n- **Evidence standard.** Winning requires technically articulated proof (e.g., ISO 16283 acoustic field test showing RRAA failure; phenolphthalein test proving carbonation). Generic \"it's damp\" reports lose; forensic reports settle cases — see *Perícia Extrajudicial* in [[platform-home-inspection]].\n\n## Where it appears in the journey\n\n[[phase-4-due-diligence|P4]]: frames the triage matrix (Tier 2 = negotiate under DL 67/2023). [[phase-6-offer-cpcv|P6]]: reservas language drafted into the [[cpcv|CPCV]]. [[phase-8-post-purchase|P8]]: snagging + 30-day clock management.\n\n*(fixture excerpt — the synced article continues)*",
  },
  {
    path: "02-platforms/platform-home-inspection.md",
    title: "Platform 2 — Home Inspection (Forensic Due Diligence)",
    doc_type: "platform",
    tags: ["inspection", "phase-3", "phase-4", "phase-7", "phase-8", "dl-67-2023", "dl-10-2024", "dl-108-2026"],
    wiki_status: "draft",
    brand: "inspectos",
    wiki_verified: false,
    wiki_sources: ["src-construction-defects-prompt-chain", "src-buyers-agent-playbook-2026", "src-inspectos-strategy-technical"],
    updated_in_wiki: "2026-07-20",
    links: ["inspection-in-the-buyer-journey", "dl-10-2024-simplex", "dl-67-2023", "phase-3-viewings\\", "phase-4-due-diligence\\", "phase-7-closing\\", "phase-8-post-purchase\\", "b2b-partnerships", "construction-defects-hub", "sops", "regions-hub", "src-inspectos-strategy-technical", "dl-108-2026", "inspectos-pca-pcs-strategy", "inspectos-iso17020-accreditation", "inspectos-inspector-app", "inspectos-technical-scope-benchmarks", "hiring-hub", "hiring-quality-gates"],
    body: "# Platform 2 — Home inspection\n\nPositioned not as \"home inspection\" but as **forensic due diligence & legal risk mitigation**. The product is a legally weaponized defect register, not a checklist walk-through. This platform is the technical due-diligence slice of the buyer journey — see [[inspection-in-the-buyer-journey|why it's a subset, not the frame]].\n\n## Thesis\n\nTwo laws created the market:\n\n- [[dl-10-2024-simplex|DL 10/2024 (Simplex)]] — the state no longer inspects new builds. Verification privatized overnight.\n- [[dl-67-2023|DL 67/2023]] — buyers hold strong hidden-defect rights, but they expire on 30-day clocks and require documented, technically-articulated evidence. An inspection report written in Eurocode language *is* that evidence.\n\n99% of Portuguese inspection content and practice is generic. The 12-module knowledge base (chemistry, physics, geology, law, fraud patterns) makes this platform the only actor speaking both Eurocode and Civil Code.\n\n## Product ladder (mapped to journey phases)\n\n*(fixture excerpt — the synced article continues)*",
  },
  {
    path: "05-strategy/agency-checklists.md",
    title: "Agency Checklists — Operational Reference",
    doc_type: "concept",
    tags: ["phase-3", "phase-4", "phase-7", "phase-8", "agency"],
    wiki_status: "draft",
    brand: "homeos",
    wiki_verified: false,
    wiki_sources: ["src-buyers-agent-playbook-2026"],
    updated_in_wiki: "2026-07-14",
    links: ["platform-buyers-agency", "sops", "phase-3-viewings", "property-types-hub", "property-type-historical", "property-type-new-build-off-plan", "property-type-land-development", "property-type-luxury", "property-type-rural-quinta", "phase-4-due-diligence", "phase-7-closing", "phase-8-post-purchase", "dl-67-2023"],
    body: "# Agency checklists — operational reference\n\nPrintable, on-site operating checklists for the [[platform-buyers-agency|buyer's agency platform]], consolidated from playbook Appendix B. These are the agency's counterpart to [[sops|the inspection platform's SOPs]]: canonical phase pages hold the reasoning, these checklists are the field-usable execution layer. Customise per engagement; regenerate from source rather than hand-edit.\n\n## B.1 — General on-site viewing checklist\n\nUniversal layer applied to every viewing: approach (parking, noise, neighbours), building exterior (facade, cracks, roof), common areas (lift age/service, security, CCTV), living areas (floor/wall/ceiling condition, light, noise insulation), windows/doors, kitchen, bathrooms, utilities (electric panel age/RCD, water meter, heating), basement/storage, outdoor space, parking, condominium noticeboard (pending works, arrears notices), general condition (smell, pests), and listing-agent pressure signals. Canonical: [[phase-3-viewings]].\n\n## B.2 — Property-type-specific viewing additions\n\nLayered on top of B.1 per type — full detail in each type's page under [[property-types-hub]]:\n\n*(fixture excerpt — the synced article continues)*",
  },
  {
    path: "01-ecosystem/phase-7-closing.md",
    title: "Phase 7 — Transaction Execution & Closing",
    doc_type: "phase",
    tags: ["phase-7", "agency", "dl-108-2026"],
    wiki_status: "draft",
    brand: "homeos",
    wiki_verified: false,
    wiki_sources: ["src-buyers-agent-playbook-2026"],
    updated_in_wiki: "2026-07-20",
    links: ["agency-checklists", "dl-108-2026", "platform-home-inspection", "phase-6-offer-cpcv", "phase-8-post-purchase", "buyer-journey"],
    body: "# Phase 7 — Transaction execution & closing\n\nCPCV to deed, typically 4–12 weeks. Failure mode here is coordination, not knowledge. Playbook Ch. 8.\n\n## Subtasks\n\n1. **Timeline management** — single owned timeline from CPCV to escritura; every counterparty (lawyer, notary, bank, seller's agent, condomínio administrator) mapped to dated deliverables.\n2. **Multi-party coordination** — the agent is the only actor with end-to-end visibility; weekly written status to the buyer.\n3. **Pre-closing verification** — re-confirm title, no new encumbrances, condomínio debt clearance (declaração de não dívida), utilities status, and a final walk-through confirming the property's state matches the CPCV (including agreed defect remediations). Checklist: [[agency-checklists|Appendix B.4]].\n4. **Deed day protocol** — funds choreography, document set, sworn translation where required, keys and access inventory. As of [[dl-108-2026|DL 108/2026]] (in force 3 August 2026), the notary must explicitly declare in the deed whether an urban title exists, whether the seller claims it exists without presenting it, or whether the seller admits it doesn't — a habitation license is no longer a deed prerequisite. If that declaration surfaces a gap not already priced into the CPCV, the buyer's one-year statutory annulment window starts running from this day.\n5. **Immediate post-deed actions** — registration, IMI\n\n*(fixture excerpt — the synced article continues)*",
  },
  {
    path: "01-ecosystem/phase-2-sourcing.md",
    title: "Phase 2 — Research, Strategy & Property Sourcing",
    doc_type: "phase",
    tags: ["phase-2", "agency"],
    wiki_status: "draft",
    brand: "homeos",
    wiki_verified: false,
    wiki_sources: ["src-buyers-agent-playbook-2026"],
    updated_in_wiki: "2026-07-13",
    links: ["market-intelligence", "sourcing-strategy", "property-types-hub", "platform-buyers-agency", "content-strategy", "phase-6-offer-cpcv", "comparables", "phase-1-onboarding", "phase-3-viewings", "buyer-journey"],
    body: "# Phase 2 — Research, strategy & property sourcing\n\nTurns the buyer's requirements into a structured market-intelligence operation. Done well: 8–20 qualified candidates in 4–6 weeks, 15–30% of eventually-shown properties sourced off-market. Playbook Ch. 3.\n\n## Subtasks\n\n1. **Deep market analysis** — continuously updated, not one-time. Portals show asking prices only; 15–35% of transactions happen off-market or developer-direct, so portal-only analysis is structurally biased. Full component table in [[market-intelligence]].\n2. **Five-layer sourcing stack** — portals (60–75% of market), agent network (10–20%), off-market direct-to-owner (10–20%), developer-direct (10–15%), bank/institutional distressed (1–5%). Detail in [[sourcing-strategy]].\n3. **Custom search brief** — written filter translating the dossier into daily scanning criteria; tuned per [[property-types-hub|property type]] — a Príncipe Real apartment brief and an Alentejo quinta brief share no template.\n4. **Cadence & communication** — daily portal scan logged in CRM, weekly agent-network outbound, bi-weekly written buyer report, monthly market one-pager, 24h post-viewing debriefs.\n\n## Red flags\n\n*(fixture excerpt — the synced article continues)*",
  },
  {
    path: "03-domains/market/property-type-rural-quinta.md",
    title: "Property Type: Rural / Quinta / Farm",
    doc_type: "concept",
    tags: ["phase-3", "phase-4", "phase-6", "agency", "alentejo", "madeira", "azores", "moisture"],
    wiki_status: "draft",
    brand: "homeos",
    wiki_verified: false,
    wiki_sources: ["src-buyers-agent-playbook-2026"],
    updated_in_wiki: "2026-07-14",
    links: ["property-types-hub", "phase-3-viewings", "phase-4-due-diligence", "phase-6-offer-cpcv"],
    body: "# Property type — rural / quinta / farm\n\nQuintas, *herdades*, and *casais* in the Alentejo, central Portugal, the Silver Coast interior, the Algarve *serra*, Madeira, and the Azores. This segment appeals to lifestyle retirement buyers, rural-tourism investors, and agricultural purchasers. It is the most property-type-specific DD profile of any segment: water rights, access, forestry compliance, and habitational licensing are routinely misunderstood, and they produce the most expensive post-purchase surprises in the entire market.\n\n## Distinctive due diligence\n\n*(fixture excerpt — the synced article continues)*",
  },
  {
    path: "03-domains/regions/regions-hub.md",
    title: "Regions Hub",
    doc_type: "hub",
    tags: ["lisbon", "porto", "algarve", "silver-coast", "alentejo", "madeira", "azores"],
    wiki_status: "draft",
    brand: "shared",
    wiki_verified: false,
    wiki_sources: ["src-buyers-agent-playbook-2026", "src-construction-defects-prompt-chain"],
    updated_in_wiki: "2026-07-13",
    links: ["lisbon", "porto", "algarve"],
    body: "# Regions hub\n\nPortugal is regional to a degree that surprises foreign buyers: pricing, supply elasticity, demand source, regulation, and — the inspection platform's edge — **geology and pathology** all vary by region. Each regional dossier combines market character + construction risk + regulatory quirks, per Paul's \"tag by geography\" rule.\n\n## Dossiers\n\n- [[lisbon|Lisbon]] — liquefaction alluvium, Pombalino vs. Placa stock, AL containment zones.\n- [[porto|Porto]] — granite + acid rain, heavy rising damp, historic-centre containment.\n- [[algarve|Algarve]] — expansive clays, coastal salinity, polybutylene era, AL economics.\n\n## Backlog\n\nSilver Coast (off-plan supply) · Alentejo/Comporta (luxury, branded residences) · Madeira & Azores (volcanic soils — *bagacina* zero-lateral-friction foundations, pyroclastic acid rain on metalwork) · Minho/North interior (highest rainfall in Europe + freeze-thaw *ciclos gelo-degelo* spalling renders and stone).",
  },
];

/**
 * Stands in for wiki_search() (0007), which does the real thing in Postgres:
 * websearch_to_tsquery over a 'simple' tsvector, ts_rank ordering and a
 * ts_headline snippet. This is a plain substring scan — enough to exercise the
 * UI, and deliberately not an attempt to reimplement ranking in JavaScript,
 * which would only drift from the definition that matters.
 */
function demoSnippet(body, needle) {
  const i = body.toLowerCase().indexOf(needle.toLowerCase());
  if (i === -1) return body.slice(0, 180).trim() + "…";
  const start = Math.max(0, i - 70);
  return (start > 0 ? "… " : "") + body.slice(start, start + 200).trim() + " …";
}

export const demoWiki = {
  articles: async () => demoWikiArticles.map(({ body, ...rest }) => rest),

  /**
   * Shaped exactly like the Supabase path: `links` comes back as
   * {dst_slug, dst_path} rows, not bare slugs, because that is what wiki_links
   * holds and what the reader resolves against. dst_path is null for a
   * dangling link.
   *
   * With only seven fixtures most links dangle, which is the honest demo: the
   * real vault resolves 754 of 754, and the reader has to render both states.
   */
  article: async (path) => {
    const found = demoWikiArticles.find((a) => a.path === path);
    if (!found) return null;
    const stem = (p) => p.split("/").pop().replace(/[.]md$/, "");
    return {
      ...found,
      links: (found.links || []).map((slug) => ({
        dst_slug: slug,
        dst_path: demoWikiArticles.find((a) => stem(a.path) === slug)?.path ?? null,
      })),
    };
  },

  search: async (query, limit = 20) => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return demoWikiArticles
      .filter((a) =>
        [a.title, a.body, a.tags.join(" ")].join(" ").toLowerCase().includes(q)
      )
      .slice(0, limit)
      .map((a) => ({
        path: a.path, title: a.title, tags: a.tags,
        wiki_verified: a.wiki_verified, updated_in_wiki: a.updated_in_wiki,
        snippet: demoSnippet(a.body, q),
        rank: 1,
      }));
  },
};
