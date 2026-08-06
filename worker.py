"""Scheduled worker, Mission Control edition.

Every producer is a named routine in ROUTINES. Each execution is logged to
routine_runs (what ran, what it produced, or why it failed) and the dashboard
reads that log. Run-now buttons insert into routine_commands; this loop polls
and executes them.

Connects to Supabase Postgres via DATABASE_URL as table owner (bypasses RLS -
trusted infrastructure). Future producers (DRE parser, portal tracker)
register in ROUTINES and inherit logging + run-now for free.
"""
import os, time, logging
from sqlalchemy import select

from db.session import SessionLocal, init_db
from db.models import RoutineRun, RoutineCommand, utcnow
from kb.store import sweep_stale
from agent.researcher import process_open_tasks

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
INTERVAL = int(os.getenv("WORKER_INTERVAL", "60"))
SWEEP_EVERY = int(os.getenv("SWEEP_EVERY", "3600"))


def run_agent_tasks(s) -> tuple[int, str]:
    n = process_open_tasks(s)
    return n, f"{n} finding(s) -> review queue"


def run_freshness_sweep(s) -> tuple[int, str]:
    stale = sweep_stale(s)
    return len(stale), f"{len(stale)} node(s) marked stale, refresh tasks opened"


ROUTINES = {
    # name: (fn, description shown in Mission Control)
    "agent_tasks": (run_agent_tasks,
                    "Process open research questions into draft findings"),
    "freshness_sweep": (run_freshness_sweep,
                        "Degrade expired verified nodes to stale; queue refreshes"),
    # "dre_parser": planned - daily Diario da Republica scan (Day 5)
    # "portal_tracker": planned - daily listing snapshot (Day 7)
}


def execute(s, name: str) -> None:
    fn, _ = ROUTINES[name]
    run = RoutineRun(routine=name, status="ok", started_at=utcnow())
    s.add(run)
    s.flush()
    try:
        items, detail = fn(s)
        run.items_out = items
        run.detail = detail
        if items:
            logging.info("%s: %s", name, detail)
    except Exception as e:  # noqa: BLE001 - log and keep the loop alive
        run.status = "failed"
        run.detail = str(e)[:500]
        logging.exception("%s failed", name)
    finally:
        run.finished_at = utcnow()
        s.commit()


def poll_commands(s) -> None:
    cmds = list(s.scalars(select(RoutineCommand)
                          .where(RoutineCommand.status == "pending")
                          .order_by(RoutineCommand.created_at)))
    for cmd in cmds:
        if cmd.routine in ROUTINES:
            logging.info("run-now: %s (by %s)", cmd.routine, cmd.requested_by)
            execute(s, cmd.routine)
            cmd.status = "done"
        else:
            cmd.status = "failed"
        cmd.executed_at = utcnow()
        s.commit()


if __name__ == "__main__":
    init_db()
    last_sweep = 0.0
    while True:
        with SessionLocal() as s:
            poll_commands(s)
            execute(s, "agent_tasks")
            if time.time() - last_sweep > SWEEP_EVERY:
                execute(s, "freshness_sweep")
                last_sweep = time.time()
        time.sleep(INTERVAL)
