"""
Data model for the intelligence knowledge base.

Design decisions:
- Relational (SQLite dev / Postgres prod via DATABASE_URL). Graph semantics are
  modeled as an Edge table between nodes; migrate to a graph DB only when
  cross-gap traversals outgrow SQL.
- Every claim is a KnowledgeNode with confidence tier (A-D), freshness date,
  status (draft/pending_review/verified/stale/rejected) and provenance.
- Agent output NEVER goes straight to 'verified'. It lands in pending_review;
  a human promotes it. That review loop is the product.
"""
from datetime import datetime, date, timezone
from enum import Enum

from sqlalchemy import (
    Column, Integer, String, Text, Date, DateTime, ForeignKey, Float, Boolean
)
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()


def utcnow() -> datetime:
    """UTC now, timezone-naive.

    Every DateTime column below is naive and has always held UTC. The aware
    value from datetime.now(timezone.utc) cannot be dropped in as-is: it would
    store an offset that comparisons against the existing naive rows refuse to
    touch (TypeError). Stripping tzinfo keeps what is written byte-identical to
    the old datetime.utcnow() while avoiding its 3.12 deprecation warning.
    Make the columns timezone-aware and this helper goes away.
    """
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Tier(str, Enum):
    A = "A"  # Verified primary (registry, official publication, direct measurement)
    B = "B"  # Verified secondary (reputable report, credentialed expert on record)
    C = "C"  # Professional hearsay (industry consensus, informal network intel)
    D = "D"  # Unverified (single source, potential capture, unconfirmed)


class NodeStatus(str, Enum):
    DRAFT = "draft"
    PENDING_REVIEW = "pending_review"
    VERIFIED = "verified"
    STALE = "stale"
    REJECTED = "rejected"


class Category(str, Enum):
    MARKET = "market"                    # prices, inventory, liquidity
    REGULATORY = "regulatory"            # DRE, DL 108/2026, AL, IMT
    ENFORCEMENT = "enforcement"          # camara posture, backlogs (Gap 1)
    PHYSICAL = "physical"                # condition, EPC, brown stock (Gap 2)
    FINANCING = "financing"              # bank appetite, LTV reality (Gap 3)
    CONDO = "condo"                      # reserves, assessments (Gap 4)
    TAX = "tax"                          # audit posture, effective rates (Gap 5)
    LIQUIDITY = "liquidity"              # days on market by bracket (Gap 6)
    PROFESSIONALS = "professionals"      # ecosystem quality (Gap 7)
    OPERATIONAL = "operational"          # management, maintenance (Gap 8)
    ESG = "esg"                          # stranded asset trajectory (Gap 9)
    INFRASTRUCTURE = "infrastructure"    # projects, timelines


# Freshness policy: days after which a verified node auto-degrades to STALE.
FRESHNESS_DAYS = {
    Category.MARKET: 90,
    Category.REGULATORY: 180,
    Category.ENFORCEMENT: 120,
    Category.PHYSICAL: 365,
    Category.FINANCING: 90,
    Category.CONDO: 365,
    Category.TAX: 180,
    Category.LIQUIDITY: 90,
    Category.PROFESSIONALS: 365,
    Category.OPERATIONAL: 365,
    Category.ESG: 180,
    Category.INFRASTRUCTURE: 180,
}


class Municipality(Base):
    __tablename__ = "municipalities"
    id = Column(Integer, primary_key=True)
    name = Column(String(120), unique=True, nullable=False)
    district = Column(String(120))
    region = Column(String(120))
    notes = Column(Text)
    nodes = relationship("KnowledgeNode", back_populates="municipality")


class Source(Base):
    __tablename__ = "sources"
    id = Column(Integer, primary_key=True)
    name = Column(String(255), nullable=False)          # e.g. "INE", "CM Grandola", "Team field visit"
    url = Column(Text)
    kind = Column(String(50))                            # official / commercial / press / human / field
    accessed_at = Column(DateTime, default=utcnow)


class KnowledgeNode(Base):
    __tablename__ = "knowledge_nodes"
    id = Column(Integer, primary_key=True)
    municipality_id = Column(Integer, ForeignKey("municipalities.id"), nullable=False)
    category = Column(String(40), nullable=False)
    title = Column(String(255), nullable=False)          # one-line claim
    body = Column(Text, nullable=False)                  # the substance
    tier = Column(String(1), nullable=False, default=Tier.D.value)
    status = Column(String(20), nullable=False, default=NodeStatus.DRAFT.value)
    as_of = Column(Date, nullable=False, default=date.today)   # when the fact was true
    verified_by = Column(String(120))                    # team member who signed off
    verified_at = Column(DateTime)
    created_by = Column(String(120), default="agent")    # agent | team | import
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    municipality = relationship("Municipality", back_populates="nodes")
    citations = relationship("Citation", back_populates="node", cascade="all, delete-orphan")

    def freshness_deadline(self) -> date:
        from datetime import timedelta
        days = FRESHNESS_DAYS.get(Category(self.category), 180)
        return self.as_of + timedelta(days=days)

    def is_fresh(self, today: date | None = None) -> bool:
        return (today or date.today()) <= self.freshness_deadline()


class Citation(Base):
    __tablename__ = "citations"
    id = Column(Integer, primary_key=True)
    node_id = Column(Integer, ForeignKey("knowledge_nodes.id"), nullable=False)
    source_id = Column(Integer, ForeignKey("sources.id"), nullable=False)
    quote_or_ref = Column(Text)                          # pointer, never long verbatim text
    node = relationship("KnowledgeNode", back_populates="citations")
    source = relationship("Source")


class Edge(Base):
    """Typed relation between nodes: the 'graph engineering' layer.
    Examples: AMPLIFIES (enforcement backlog amplifies legalization cost),
    DEPENDS_ON, CONTRADICTS, SUPERSEDES."""
    __tablename__ = "edges"
    id = Column(Integer, primary_key=True)
    src_node_id = Column(Integer, ForeignKey("knowledge_nodes.id"), nullable=False)
    dst_node_id = Column(Integer, ForeignKey("knowledge_nodes.id"), nullable=False)
    relation = Column(String(40), nullable=False)
    note = Column(Text)


class ResearchTask(Base):
    """A user question or a scheduled refresh. The agent consumes these."""
    __tablename__ = "research_tasks"
    id = Column(Integer, primary_key=True)
    municipality_id = Column(Integer, ForeignKey("municipalities.id"))
    question = Column(Text, nullable=False)
    requested_by = Column(String(120), default="user")
    status = Column(String(20), default="open")          # open / in_progress / answered / closed
    created_at = Column(DateTime, default=utcnow)
    answered_at = Column(DateTime)

    municipality = relationship("Municipality")
    findings = relationship("Finding", back_populates="task", cascade="all, delete-orphan")


class Finding(Base):
    """Raw agent output awaiting human review. Promoting a finding creates a
    KnowledgeNode; rejecting it records why (so the agent learns the pattern)."""
    __tablename__ = "findings"
    id = Column(Integer, primary_key=True)
    task_id = Column(Integer, ForeignKey("research_tasks.id"), nullable=False)
    category = Column(String(40), nullable=False)
    title = Column(String(255), nullable=False)
    body = Column(Text, nullable=False)
    proposed_tier = Column(String(1), default=Tier.D.value)
    source_name = Column(String(255))
    source_url = Column(Text)
    review_status = Column(String(20), default="pending")   # pending / approved / edited / rejected
    review_note = Column(Text)
    reviewed_by = Column(String(120))
    created_at = Column(DateTime, default=utcnow)
    promoted_node_id = Column(Integer, ForeignKey("knowledge_nodes.id"))

    task = relationship("ResearchTask", back_populates="findings")


class RoutineRun(Base):
    """One execution of a worker routine (agent_tasks, freshness_sweep, dre_parser...).
    Mission Control reads this to show what ran, what didn't, and why."""
    __tablename__ = "routine_runs"
    id = Column(Integer, primary_key=True)
    routine = Column(String(60), nullable=False)
    status = Column(String(20), nullable=False, default="ok")   # ok / failed / skipped
    detail = Column(Text)                                        # e.g. "3 findings", error msg
    items_out = Column(Integer, default=0)
    started_at = Column(DateTime, default=utcnow)
    finished_at = Column(DateTime)


class RoutineCommand(Base):
    """Run-now requests from the dashboard. Worker polls and executes."""
    __tablename__ = "routine_commands"
    id = Column(Integer, primary_key=True)
    routine = Column(String(60), nullable=False)
    requested_by = Column(String(120), default="dashboard")
    status = Column(String(20), default="pending")               # pending / done / failed
    created_at = Column(DateTime, default=utcnow)
    executed_at = Column(DateTime)
