"""
Knowledge base operations. Three responsibilities:

1. Read side  : what the dashboard serves (verified nodes + freshness state).
2. Loop side  : promote reviewed findings into nodes, wire citations.
3. Hygiene    : sweep verified nodes past their freshness deadline to STALE
                and open refresh tasks for them (the self-feeding loop).
"""
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from db.models import (
    KnowledgeNode, Municipality, Source, Citation, Finding, ResearchTask,
    NodeStatus, Tier, utcnow,
)


# ---------- read side ----------

def get_municipality(s: Session, name: str) -> Municipality | None:
    return s.scalar(select(Municipality).where(Municipality.name == name))


def nodes_for(s: Session, muni_id: int, category: str | None = None,
              include_pending: bool = False) -> list[KnowledgeNode]:
    q = select(KnowledgeNode).where(KnowledgeNode.municipality_id == muni_id)
    if category:
        q = q.where(KnowledgeNode.category == category)
    statuses = [NodeStatus.VERIFIED.value, NodeStatus.STALE.value]
    if include_pending:
        statuses.append(NodeStatus.PENDING_REVIEW.value)
    q = q.where(KnowledgeNode.status.in_(statuses))
    q = q.order_by(KnowledgeNode.tier, KnowledgeNode.as_of.desc())
    return list(s.scalars(q))


def coverage(s: Session, muni_id: int) -> dict[str, dict]:
    """Per-category summary: node count, best tier, freshest as_of.
    'Unknown - not yet verified' is a first-class answer, so absence matters."""
    from db.models import Category
    out = {}
    for cat in Category:
        nodes = nodes_for(s, muni_id, cat.value)
        fresh = [n for n in nodes if n.is_fresh() and n.status == NodeStatus.VERIFIED.value]
        out[cat.value] = {
            "verified_fresh": len(fresh),
            "total": len(nodes),
            "best_tier": min((n.tier for n in fresh), default=None),
            "latest_as_of": max((n.as_of for n in nodes), default=None),
        }
    return out


# ---------- loop side ----------

def promote_finding(s: Session, finding: Finding, tier: str, reviewer: str,
                    edited_title: str | None = None,
                    edited_body: str | None = None,
                    category: str | None = None) -> KnowledgeNode:
    """Human-approved finding becomes a verified node with provenance.
    `category` lets the reviewer correct agent mis-routing."""
    task = finding.task
    node = KnowledgeNode(
        municipality_id=task.municipality_id,
        category=category or finding.category,
        title=edited_title or finding.title,
        body=edited_body or finding.body,
        tier=tier,
        status=NodeStatus.VERIFIED.value,
        as_of=date.today(),
        verified_by=reviewer,
        verified_at=utcnow(),
        created_by="agent",
    )
    s.add(node)
    s.flush()

    if finding.source_name:
        src = s.scalar(select(Source).where(Source.name == finding.source_name))
        if not src:
            src = Source(name=finding.source_name, url=finding.source_url, kind="agent")
            s.add(src)
            s.flush()
        s.add(Citation(node_id=node.id, source_id=src.id,
                       quote_or_ref=finding.source_url or ""))

    finding.review_status = "approved" if not (edited_title or edited_body) else "edited"
    finding.reviewed_by = reviewer
    finding.promoted_node_id = node.id
    s.commit()
    return node


def reject_finding(s: Session, finding: Finding, reviewer: str, note: str):
    finding.review_status = "rejected"
    finding.reviewed_by = reviewer
    finding.review_note = note
    s.commit()


def pending_findings(s: Session) -> list[Finding]:
    return list(s.scalars(
        select(Finding).where(Finding.review_status == "pending")
        .order_by(Finding.created_at)
    ))


# ---------- hygiene ----------

def sweep_stale(s: Session, open_refresh_tasks: bool = True) -> list[KnowledgeNode]:
    """Degrade expired verified nodes to STALE and queue refresh research."""
    today = date.today()
    expired = [
        n for n in s.scalars(select(KnowledgeNode).where(
            KnowledgeNode.status == NodeStatus.VERIFIED.value))
        if not n.is_fresh(today)
    ]
    for n in expired:
        n.status = NodeStatus.STALE.value
        if open_refresh_tasks:
            s.add(ResearchTask(
                municipality_id=n.municipality_id,
                question=f"Refresh stale node #{n.id}: {n.title}",
                requested_by="system",
            ))
    s.commit()
    return expired
