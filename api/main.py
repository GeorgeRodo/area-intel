"""
HTTP API over the knowledge base. Serves the Next.js frontend.

Auth model (MVP):
  - Reader endpoints are open (put the whole API behind your reverse proxy /
    VPN until client launch).
  - Reviewer endpoints require header  X-Reviewer-Key: $REVIEWER_KEY
    (env, default "dev-reviewer-key").
  - Seam for Clerk/NextAuth later: swap require_reviewer() for JWT validation;
    nothing else changes.

Run:  uvicorn api.main:app --reload --port 8000
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI, Depends, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import select

from db.models import (
    Municipality, ResearchTask, Finding, KnowledgeNode, Edge, Category, utcnow,
)
from db.session import SessionLocal, init_db
from kb.store import (
    nodes_for, coverage, pending_findings, promote_finding, reject_finding,
    sweep_stale,
)
from agent.researcher import process_open_tasks, get_backend

REVIEWER_KEY = os.getenv("REVIEWER_KEY", "dev-reviewer-key")

app = FastAPI(title="Area Intelligence API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:3000").split(","),
    allow_methods=["*"], allow_headers=["*"],
)


@app.on_event("startup")
def _startup():
    init_db()


def require_reviewer(x_reviewer_key: str = Header(default="")):
    if x_reviewer_key != REVIEWER_KEY:
        raise HTTPException(401, "Invalid reviewer key")
    return True


# ---------- schemas ----------

class AskIn(BaseModel):
    municipality_id: int
    question: str = Field(min_length=5, max_length=2000)
    run_agent: bool = True


class ApproveIn(BaseModel):
    tier: str = Field(pattern="^[ABCD]$")
    reviewer: str = Field(min_length=1, max_length=120)
    title: str | None = None
    body: str | None = None
    category: str | None = None


class RejectIn(BaseModel):
    reviewer: str = Field(min_length=1, max_length=120)
    note: str = Field(min_length=3)


def node_out(n: KnowledgeNode) -> dict:
    return {
        "id": n.id, "category": n.category, "title": n.title, "body": n.body,
        "tier": n.tier, "status": n.status, "as_of": str(n.as_of),
        "fresh": n.is_fresh(), "verified_by": n.verified_by,
        "sources": [{"name": c.source.name, "url": c.source.url} for c in n.citations],
    }


# ---------- reader endpoints ----------

@app.get("/api/municipalities")
def list_municipalities():
    with SessionLocal() as s:
        return [
            {"id": m.id, "name": m.name, "district": m.district,
             "region": m.region, "notes": m.notes}
            for m in s.scalars(select(Municipality).order_by(Municipality.name))
        ]


@app.get("/api/municipalities/{muni_id}/coverage")
def get_coverage(muni_id: int):
    with SessionLocal() as s:
        if not s.get(Municipality, muni_id):
            raise HTTPException(404, "Municipality not found")
        cov = coverage(s, muni_id)
    return {k: {**v, "latest_as_of": str(v["latest_as_of"]) if v["latest_as_of"] else None}
            for k, v in cov.items()}


@app.get("/api/municipalities/{muni_id}/nodes")
def get_nodes(muni_id: int, category: str | None = Query(default=None)):
    if category and category not in {c.value for c in Category}:
        raise HTTPException(400, "Unknown category")
    with SessionLocal() as s:
        if not s.get(Municipality, muni_id):
            raise HTTPException(404, "Municipality not found")
        nodes = nodes_for(s, muni_id, category)
        return [node_out(n) for n in nodes]


@app.get("/api/municipalities/{muni_id}/edges")
def get_edges(muni_id: int):
    with SessionLocal() as s:
        node_ids = [n.id for n in nodes_for(s, muni_id)]
        if not node_ids:
            return []
        edges = s.scalars(select(Edge).where(Edge.src_node_id.in_(node_ids)))
        out = []
        for e in edges:
            src, dst = s.get(KnowledgeNode, e.src_node_id), s.get(KnowledgeNode, e.dst_node_id)
            out.append({"relation": e.relation, "note": e.note,
                        "src": {"id": src.id, "title": src.title},
                        "dst": {"id": dst.id, "title": dst.title}})
        return out


@app.post("/api/ask")
def ask(payload: AskIn):
    with SessionLocal() as s:
        if not s.get(Municipality, payload.municipality_id):
            raise HTTPException(404, "Municipality not found")
        task = ResearchTask(municipality_id=payload.municipality_id,
                            question=payload.question.strip(), requested_by="web")
        s.add(task); s.commit()
        task_id = task.id
        n_findings = process_open_tasks(s) if payload.run_agent else 0
    return {"task_id": task_id, "findings_created": n_findings,
            "backend": get_backend().__class__.__name__}


@app.get("/api/municipalities/{muni_id}/tasks")
def get_tasks(muni_id: int):
    with SessionLocal() as s:
        tasks = s.scalars(
            select(ResearchTask).where(ResearchTask.municipality_id == muni_id)
            .order_by(ResearchTask.created_at.desc()).limit(20))
        return [{"id": t.id, "question": t.question, "status": t.status,
                 "created_at": str(t.created_at), "findings": len(t.findings)}
                for t in tasks]


# ---------- reviewer endpoints ----------

@app.get("/api/findings", dependencies=[Depends(require_reviewer)])
def list_findings():
    with SessionLocal() as s:
        rows = pending_findings(s)
        return [{
            "id": f.id, "category": f.category, "title": f.title, "body": f.body,
            "proposed_tier": f.proposed_tier, "source_name": f.source_name,
            "source_url": f.source_url, "task_id": f.task_id,
            "question": f.task.question, "created_at": str(f.created_at),
        } for f in rows]


@app.post("/api/findings/{finding_id}/approve", dependencies=[Depends(require_reviewer)])
def approve(finding_id: int, payload: ApproveIn):
    with SessionLocal() as s:
        f = s.get(Finding, finding_id)
        if not f or f.review_status != "pending":
            raise HTTPException(404, "Finding not found or already reviewed")
        if payload.category and payload.category not in {c.value for c in Category}:
            raise HTTPException(400, "Unknown category")
        node = promote_finding(s, f, payload.tier, payload.reviewer,
                               edited_title=payload.title, edited_body=payload.body,
                               category=payload.category)
        return {"node_id": node.id, "status": node.status, "tier": node.tier}


@app.post("/api/findings/{finding_id}/reject", dependencies=[Depends(require_reviewer)])
def reject(finding_id: int, payload: RejectIn):
    with SessionLocal() as s:
        f = s.get(Finding, finding_id)
        if not f or f.review_status != "pending":
            raise HTTPException(404, "Finding not found or already reviewed")
        reject_finding(s, f, payload.reviewer, payload.note)
        return {"rejected": finding_id}


@app.post("/api/sweep", dependencies=[Depends(require_reviewer)])
def run_sweep():
    with SessionLocal() as s:
        expired = sweep_stale(s)
    return {"stale": len(expired), "at": utcnow().isoformat()}
