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

from db.session import SessionLocal, engine, init_db
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


def execute(s, name: str) -> str:
    """Run one routine and log the attempt. Returns 'ok' or 'failed'.

    The routine's own work is committed (or rolled back) before the run row is
    written, and the two are separate transactions on purpose. The previous
    shape — add the row, run the routine, commit in a `finally` — had the
    failure path back to front in two ways:

      * a routine that raised halfway through left its partial writes in the
        session, and the commit in `finally` then committed them alongside the
        row saying it had failed;
      * after a database error the session is in a rolled-back state, so that
        commit raised PendingRollbackError. Being in `finally` rather than
        inside the `except`, it propagated straight past the handler and out of
        `execute` — killing the process the docstring says it keeps alive. One
        transient database blip and the worker stops, silently, until someone
        notices nothing has run.

    Rolling back first also means the failure record is written on a clean
    session, so the log entry survives the error it is describing.
    """
    fn, _ = ROUTINES[name]
    started = utcnow()
    try:
        items, detail = fn(s)
        s.commit()
        status = "ok"
        if items:
            logging.info("%s: %s", name, detail)
    except Exception as e:  # noqa: BLE001 - log and keep the loop alive
        s.rollback()
        status, items, detail = "failed", 0, str(e)[:500]
        logging.exception("%s failed", name)

    try:
        s.add(RoutineRun(routine=name, status=status, detail=detail,
                         items_out=items, started_at=started, finished_at=utcnow()))
        s.commit()
    except Exception:  # noqa: BLE001 - losing the log must not lose the loop
        s.rollback()
        logging.exception("could not record the %s run", name)

    return status


def poll_commands(s) -> None:
    cmds = list(s.scalars(select(RoutineCommand)
                          .where(RoutineCommand.status == "pending")
                          .order_by(RoutineCommand.created_at)))
    for cmd in cmds:
        if cmd.routine in ROUTINES:
            logging.info("run-now: %s (by %s)", cmd.routine, cmd.requested_by)
            # Mirror the outcome instead of always claiming 'done': a run-now
            # that failed showed as done here while routine_runs recorded the
            # failure, so the two logs disagreed about the same execution.
            cmd.status = "done" if execute(s, cmd.routine) == "ok" else "failed"
        else:
            cmd.status = "failed"
        cmd.executed_at = utcnow()
        s.commit()


if __name__ == "__main__":
    # init_db() is Base.metadata.create_all(): it builds tables from the
    # SQLAlchemy models in db/models.py. That is exactly right on the local
    # SQLite path, where nothing else ever creates them, and wrong against
    # Supabase, where supabase/migrations/ owns the schema.
    #
    # The two are independent definitions of the same nine tables, and
    # create_all knows nothing about the half that matters there: RLS
    # policies, grants, the security-definer promote_finding() gate. It will
    # not ALTER a table that already exists, so on a healthy database it is a
    # no-op — but if the models and the migrations ever drift, it silently
    # creates the model's version of a missing table with none of the
    # protection the migration would have given it. On the database this
    # product's whole claim rests on, that is not a risk worth a convenience.
    #
    # So: create on SQLite, never on Postgres. Migrations are applied with
    # supabase/apply_migration.py.
    if engine.url.get_backend_name() == "sqlite":
        init_db()
    else:
        logging.info("%s: schema owned by supabase/migrations, skipping init_db()",
                     engine.url.get_backend_name())

    last_sweep = 0.0
    while True:
        # execute() handles its own failures, but everything outside it —
        # opening the session, poll_commands' own commits — can still raise if
        # the database goes away. This loop is the last thing between a
        # transient outage and a worker that is simply gone, so it catches
        # rather than exits, and sleeps before trying again instead of
        # spinning against a database that is still down.
        try:
            with SessionLocal() as s:
                poll_commands(s)
                execute(s, "agent_tasks")
                if time.time() - last_sweep > SWEEP_EVERY:
                    execute(s, "freshness_sweep")
                    last_sweep = time.time()
        except Exception:  # noqa: BLE001
            logging.exception("worker cycle failed; retrying in %ss", INTERVAL)
        time.sleep(INTERVAL)
