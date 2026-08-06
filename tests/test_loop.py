"""End-to-end test of the knowledge loop on a throwaway SQLite DB."""
import os, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.mkstemp(suffix='.db')[1]}"

from datetime import date, timedelta

from sqlalchemy import select

import db.session as dbs
from db.models import ResearchTask, Finding, KnowledgeNode, NodeStatus
from kb.seed_grandola import seed
from kb.store import get_municipality, nodes_for, coverage, promote_finding, sweep_stale
from agent.researcher import process_open_tasks


def test_full_loop():
    seed()
    with dbs.SessionLocal() as s:
        muni = get_municipality(s, "Grandola")
        assert muni is not None

        # seeded brief
        nodes = nodes_for(s, muni.id)
        assert len(nodes) == 8
        cov = coverage(s, muni.id)
        assert cov["regulatory"]["verified_fresh"] >= 2
        assert cov["condo"]["verified_fresh"] == 0  # unknown is first-class

        # ask -> agent -> findings in review queue
        s.add(ResearchTask(municipality_id=muni.id,
                           question="What is the AL alojamento local licensing backlog at the camara?"))
        s.commit()
        n = process_open_tasks(s)
        assert n >= 1
        f = s.scalar(select(Finding).where(Finding.review_status == "pending"))
        assert f is not None
        assert f.proposed_tier == "D"  # heuristic backend never claims verification

        # human promotes -> verified node with provenance
        node = promote_finding(s, f, tier="B", reviewer="tester",
                               edited_body="Camara confirmed 4-month AL backlog by phone, 2 staff.")
        assert node.status == NodeStatus.VERIFIED.value
        assert node.verified_by == "tester"
        assert f.review_status == "edited"

        # freshness sweep degrades old nodes and opens refresh tasks
        node.as_of = date.today() - timedelta(days=4000)
        s.commit()
        expired = sweep_stale(s)
        assert any(x.id == node.id for x in expired)
        refresh = s.scalar(select(ResearchTask).where(
            ResearchTask.question.like(f"%#{node.id}%")))
        assert refresh is not None
    print("test_full_loop passed")


if __name__ == "__main__":
    test_full_loop()
