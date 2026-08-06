"""
Seed the pilot municipality: Grandola (Melides / Comporta coast).

Tier assignments follow the team's validated-calendar corrections. Anything we
have not re-derived from a primary source is deliberately seeded at tier C/D or
left absent - absence is signal on the dashboard, not a bug.

Re-runnable: skips if municipality already exists.
"""
from datetime import date

from db.models import (
    Municipality, Source, KnowledgeNode, Citation, Edge,
    NodeStatus, Category, utcnow,
)
from db.session import SessionLocal, init_db
from sqlalchemy import select

REVIEWER = "team-seed"

SOURCES = {
    "DRE": ("Diario da Republica", "https://diariodarepublica.pt", "official"),
    "INE": ("INE - Instituto Nacional de Estatistica", "https://www.ine.pt", "official"),
    "CMG": ("Camara Municipal de Grandola", "https://www.cm-grandola.pt", "official"),
    "CI": ("Confidencial Imobiliario", "https://www.confidencialimobiliario.com", "commercial"),
    "TEAM": ("Team field research", None, "field"),
}

# (source_key, category, tier, title, body)
NODES = [
    ("DRE", Category.REGULATORY, "A",
     "IMT: flat 7.5% rate for non-resident buyers under DL 97/2026",
     "Decreto-Lei n. 97/2026 (published 20 May 2026, in force 25 May 2026) introduced "
     "the differentiated IMT treatment for non-resident buyers. Note: this is DL 97/2026, "
     "not 'Lei 9-A/2026' as circulated in some advisories; the 1 September 2026 date "
     "refers to separate rental measures. Model both regimes when underwriting for "
     "clients with pending residency applications."),

    ("DRE", Category.REGULATORY, "A",
     "DL 108/2026 in force 3 August 2026: legalization pathway amendments to RJUE/RRU",
     "DL 108/2026 (DR 29 May 2026) amends RJUE (DL 555/99) and RRU, building on the "
     "Simplex urbanistico agenda (DL 10/2024). Delegates significant interpretive "
     "authority to municipal engineers; expect per-municipality variance in area "
     "tolerance, use classification, and documentation depth. Grandola-specific "
     "posture not yet verified - see enforcement category."),

    ("TEAM", Category.ENFORCEMENT, "C",
     "Grandola camara: legalization processing posture unverified; Algarve-pattern lax enforcement suspected",
     "No direct file experience in this camara yet. Coastal Alentejo municipalities "
     "with high illegal-construction shares have historically sat at the lax end of "
     "the enforcement spectrum, but DL 108/2026 implementation could shift staffing "
     "and posture. Verification protocol: engage one local architect with recent "
     "Simplex filings; request current backlog figure at the urbanismo desk in person."),

    ("CI", Category.MARKET, "B",
     "Melides median asking ~EUR 7,240/m2, +5.2% YoY; extreme dispersion",
     "Active listings span roughly EUR 349K to EUR 17M (~120 listings), meaning the "
     "median is thin and quality-mix driven. Luxury segment (JamesEdition) averages "
     "~EUR 6,800/m2. Treat any single price point as directional; re-derive from "
     "INE transaction data for the concelho before publishing client-facing numbers."),

    ("CI", Category.LIQUIDITY, "C",
     "Comporta/Alentejo coast gross yields ~3.4%; exit liquidity thin above EUR 1M",
     "Yield-vs-lifestyle tension is the defining trade of this micro-market: prices "
     "are set by lifestyle premium buyers, not income math. Silver Coast/Alentejo "
     "emerging markets show relationship-driven sales above EUR 1M with multi-year "
     "days-on-market tails. No verified days-on-market series for Melides exists yet; "
     "reconstruct from portal tracking before quoting to clients."),

    ("TEAM", Category.PHYSICAL, "C",
     "Brown-stock profile: ~60% pre-1990 in Grandola concelho; illegal construction share elevated on coast",
     "Estimates from census-derived modelling put pre-1990 stock near 60% with "
     "illegal-construction share well above national average in coastal parishes. "
     "Implication: legalization-plus-renovation cost path (EUR 900-1,400/m2 Centro "
     "benchmark, likely higher here) applies to a large share of inventory. Needs "
     "parish-level verification via municipal archive and one structural engineer."),

    ("CMG", Category.REGULATORY, "D",
     "AL (Alojamento Local) licensing status in Grandola: not yet confirmed",
     "National policy permits AL outside pressure zones, but individual camaras "
     "operate informal moratoria and condo-approval requirements that do not appear "
     "in national databases. Do not underwrite rental income for any client until "
     "written confirmation of AL eligibility for the specific parish is obtained "
     "from the camara or Turismo de Portugal registry."),

    ("TEAM", Category.INFRASTRUCTURE, "B",
     "Demand driver: Comporta spillover + Sines industrial build-out within commute radius",
     "Two independent demand vectors: (1) lifestyle premium migrating south from "
     "Comporta into Melides as Comporta pricing saturates; (2) Sines data-center "
     "complex (Start Campus ~EUR 8.5B/1.2GW, Microsoft-linked ~$10B announcements, "
     "Nscale ~EUR 695M) creating professional rental demand in the wider corridor. "
     "These pull the market in opposite directions - luxury illiquidity vs. workforce "
     "rental depth - and should be scored separately."),
]

# (src_idx, dst_idx, relation, note)
EDGES = [
    (1, 2, "DEPENDS_ON", "DL 108/2026 impact on any legalization is gated by camara posture"),
    (5, 2, "AMPLIFIES", "High illegal-construction share raises stakes of enforcement variance"),
    (6, 4, "AMPLIFIES", "AL uncertainty compounds thin exit liquidity for yield-motivated buyers"),
]


def seed():
    init_db()
    with SessionLocal() as s:
        if s.scalar(select(Municipality).where(Municipality.name == "Grandola")):
            print("Grandola already seeded, skipping.")
            return
        muni = Municipality(
            name="Grandola", district="Setubal", region="Alentejo Litoral",
            notes="Pilot municipality. Covers Melides, Carvalhal/Comporta fringe, Grandola town.",
        )
        s.add(muni)
        s.flush()

        src_objs = {}
        for key, (name, url, kind) in SOURCES.items():
            src = Source(name=name, url=url, kind=kind)
            s.add(src)
            s.flush()
            src_objs[key] = src

        node_objs = []
        for src_key, cat, tier, title, body in NODES:
            node = KnowledgeNode(
                municipality_id=muni.id, category=cat.value, title=title, body=body,
                tier=tier, status=NodeStatus.VERIFIED.value, as_of=date.today(),
                verified_by=REVIEWER, verified_at=utcnow(), created_by="team",
            )
            s.add(node)
            s.flush()
            s.add(Citation(node_id=node.id, source_id=src_objs[src_key].id))
            node_objs.append(node)

        for si, di, rel, note in EDGES:
            s.add(Edge(src_node_id=node_objs[si].id, dst_node_id=node_objs[di].id,
                       relation=rel, note=note))
        s.commit()
        print(f"Seeded Grandola: {len(node_objs)} nodes, {len(EDGES)} edges, {len(src_objs)} sources.")


if __name__ == "__main__":
    seed()
