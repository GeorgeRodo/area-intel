"""
Intelligence dashboard. Run:  streamlit run dashboard/app.py

Three views:
  Area Brief   - coverage matrix + verified nodes with tier/freshness labels
  Ask          - user question -> ResearchTask -> agent -> review queue
  Review Queue - promote or reject agent findings (the human gate)
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from datetime import date

import streamlit as st
from sqlalchemy import select

from db.models import Municipality, ResearchTask, Edge, KnowledgeNode, Category, NodeStatus
from db.session import SessionLocal, init_db
from kb.store import nodes_for, coverage, pending_findings, promote_finding, reject_finding, sweep_stale
from agent.researcher import process_open_tasks, get_backend

st.set_page_config(page_title="Area Intelligence", layout="wide")

TIER_COLORS = {"A": "#1B7F4B", "B": "#155E90", "C": "#9A6A00", "D": "#8A2B2B"}
TIER_LABELS = {
    "A": "A · verified primary", "B": "B · verified secondary",
    "C": "C · professional hearsay", "D": "D · unverified",
}
CAT_LABELS = {
    "market": "Market", "regulatory": "Regulatory", "enforcement": "Enforcement (câmara)",
    "physical": "Physical / brown stock", "financing": "Financing reality",
    "condo": "Condominium health", "tax": "Tax practice", "liquidity": "Exit liquidity",
    "professionals": "Professional ecosystem", "operational": "Operational friction",
    "esg": "ESG / stranded asset", "infrastructure": "Infrastructure",
}

st.markdown("""
<style>
  html, body, [class*="css"] { font-family: 'IBM Plex Sans', -apple-system, sans-serif; }
  .tierchip { display:inline-block; padding:2px 10px; border-radius:3px; color:#fff;
              font-size:0.72rem; font-weight:600; letter-spacing:.04em; }
  .fresh { color:#1B7F4B; font-size:0.75rem; }
  .stale { color:#8A2B2B; font-size:0.75rem; font-weight:600; }
  .unknown { color:#8A6E1F; font-weight:600; }
  .nodecard { border-left:3px solid #14202B; padding:.4rem .9rem; margin:.5rem 0;
              background:#F6F7F5; }
  .src { color:#5B6770; font-size:0.78rem; }
</style>
""", unsafe_allow_html=True)


def chip(tier: str) -> str:
    return (f'<span class="tierchip" style="background:{TIER_COLORS.get(tier, "#555")}">'
            f'{TIER_LABELS.get(tier, tier)}</span>')


init_db()

with SessionLocal() as s:
    munis = list(s.scalars(select(Municipality).order_by(Municipality.name)))

if not munis:
    st.warning("Knowledge base is empty. Seed it first:  `python -m kb.seed_grandola`")
    st.stop()

st.sidebar.title("Area Intelligence")
muni_name = st.sidebar.selectbox("Municipality", [m.name for m in munis])
view = st.sidebar.radio("View", ["Area Brief", "Ask", "Review Queue"])
st.sidebar.caption(f"Agent backend: **{get_backend().__class__.__name__}**")
if st.sidebar.button("Run freshness sweep"):
    with SessionLocal() as s:
        expired = sweep_stale(s)
    st.sidebar.success(f"{len(expired)} node(s) marked stale; refresh tasks opened.")

with SessionLocal() as s:
    muni = s.scalar(select(Municipality).where(Municipality.name == muni_name))
    muni_id = muni.id

# ---------------- Area Brief ----------------
if view == "Area Brief":
    st.title(f"{muni.name} — {muni.region or ''}")
    if muni.notes:
        st.caption(muni.notes)

    with SessionLocal() as s:
        cov = coverage(s, muni_id)

    st.subheader("Coverage")
    st.caption("Unknown is an answer. A category with no fresh verified nodes is a gap we have not closed, not a fact we forgot to type.")
    cols = st.columns(4)
    for i, (cat, info) in enumerate(cov.items()):
        with cols[i % 4]:
            label = CAT_LABELS.get(cat, cat)
            if info["verified_fresh"]:
                st.markdown(
                    f"**{label}**<br>{info['verified_fresh']} fresh · best tier "
                    f"{chip(info['best_tier'])}<br>"
                    f"<span class='src'>as of {info['latest_as_of']}</span>",
                    unsafe_allow_html=True)
            else:
                st.markdown(
                    f"**{label}**<br><span class='unknown'>UNKNOWN — not yet verified</span>",
                    unsafe_allow_html=True)
            st.divider()

    st.subheader("Verified intelligence")
    cat_filter = st.selectbox(
        "Category", ["all"] + [c.value for c in Category],
        format_func=lambda c: "All categories" if c == "all" else CAT_LABELS.get(c, c))

    with SessionLocal() as s:
        nodes = nodes_for(s, muni_id, None if cat_filter == "all" else cat_filter)
        node_data = []
        for n in nodes:
            cites = [(c.source.name, c.source.url) for c in n.citations]
            node_data.append((n, n.is_fresh(), cites))

    for n, fresh, cites in node_data:
        fresh_html = ('<span class="fresh">fresh</span>' if fresh and n.status == "verified"
                      else '<span class="stale">STALE — refresh queued</span>')
        srcs = " · ".join(name for name, _ in cites) or "no citation"
        st.markdown(
            f"<div class='nodecard'>{chip(n.tier)} &nbsp;{fresh_html}"
            f"<br><strong>{n.title}</strong><br>{n.body}"
            f"<br><span class='src'>[{CAT_LABELS.get(n.category, n.category)}] "
            f"as of {n.as_of} · verified by {n.verified_by or '—'} · source: {srcs}</span></div>",
            unsafe_allow_html=True)

    with SessionLocal() as s:
        node_ids = [n.id for n, _, _ in node_data]
        edges = list(s.scalars(select(Edge).where(Edge.src_node_id.in_(node_ids)))) if node_ids else []
        edge_rows = []
        for e in edges:
            src = s.get(KnowledgeNode, e.src_node_id)
            dst = s.get(KnowledgeNode, e.dst_node_id)
            edge_rows.append((e.relation, src.title, dst.title, e.note))
    if edge_rows:
        st.subheader("Cross-gap interactions")
        for rel, src_t, dst_t, note in edge_rows:
            st.markdown(f"- **{rel}** — *{src_t}* → *{dst_t}*  \n  {note or ''}")

# ---------------- Ask ----------------
elif view == "Ask":
    st.title(f"Ask about {muni.name}")
    st.caption("Questions become research tasks. The agent drafts findings; nothing reaches the brief until a team member verifies it.")
    q = st.text_area("Question", placeholder="e.g. What is the current AL licensing posture in Melides parish?")
    run_now = st.checkbox("Run agent immediately", value=True)
    if st.button("Submit") and q.strip():
        with SessionLocal() as s:
            task = ResearchTask(municipality_id=muni_id, question=q.strip(), requested_by="dashboard")
            s.add(task); s.commit()
            tid = task.id
            n = process_open_tasks(s) if run_now else 0
        st.success(f"Task #{tid} created." + (f" Agent produced {n} finding(s) — now in the review queue." if run_now else ""))

    with SessionLocal() as s:
        tasks = list(s.scalars(select(ResearchTask)
                     .where(ResearchTask.municipality_id == muni_id)
                     .order_by(ResearchTask.created_at.desc()).limit(15)))
        task_rows = [(t.id, t.status, t.question, len(t.findings)) for t in tasks]
    if task_rows:
        st.subheader("Recent tasks")
        for tid, status, question, n_findings in task_rows:
            st.markdown(f"- **#{tid}** `{status}` — {question}  \n  findings: {n_findings}")

# ---------------- Review Queue ----------------
else:
    st.title("Review queue")
    st.caption("The human gate. Approve (with a tier), edit, or reject. Approvals become verified nodes with provenance.")
    reviewer = st.text_input("Reviewer name", value="")
    with SessionLocal() as s:
        rows = pending_findings(s)
        pend = [(f.id, f.category, f.proposed_tier, f.title, f.body,
                 f.source_name, f.source_url, f.task.question) for f in rows]

    if not pend:
        st.info("Queue empty.")
    for fid, cat, ptier, title, body, sname, surl, question in pend:
        with st.expander(f"#{fid} · {CAT_LABELS.get(cat, cat)} · proposed {ptier} — {title}"):
            st.markdown(f"**Task:** {question}")
            st.markdown(body)
            st.markdown(f"<span class='src'>source: {sname or '—'} {surl or ''}</span>",
                        unsafe_allow_html=True)
            c1, c2, c3 = st.columns([1, 1, 2])
            tier = c1.selectbox("Tier", list("ABCD"), index="ABCD".index(ptier if ptier in "ABCD" else "D"),
                                key=f"tier{fid}")
            if c2.button("Approve", key=f"ap{fid}", disabled=not reviewer):
                with SessionLocal() as s:
                    f = s.get(type(rows[0]), fid) if rows else None
                    from db.models import Finding
                    f = s.get(Finding, fid)
                    node = promote_finding(s, f, tier, reviewer)
                st.success(f"Promoted → node #{node.id}"); st.rerun()
            note = c3.text_input("Rejection note", key=f"note{fid}")
            if c3.button("Reject", key=f"rj{fid}", disabled=not (reviewer and note)):
                with SessionLocal() as s:
                    from db.models import Finding
                    f = s.get(Finding, fid)
                    reject_finding(s, f, reviewer, note)
                st.warning("Rejected."); st.rerun()
    if pend and not reviewer:
        st.caption("Enter a reviewer name to enable actions.")
