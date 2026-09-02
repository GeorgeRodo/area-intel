"""Apply one Supabase migration and verify it, in a single transaction.

    python supabase/apply_migration.py --dry-run    # apply, verify, always roll back
    python supabase/apply_migration.py              # apply 0016, keep it only if checks pass
    python supabase/apply_migration.py supabase/migrations/0014_revoke_sessions.sql

There is no psql, Docker or Supabase CLI on the dev machine, which is why
0006, 0007 and 0014 all sat "written but not run" for so long (TASKS.md §0).
psycopg2 is installed with a bundled libpq, so a migration can be applied from
Python with nothing else present. Use the **session pooler** connection string
from Supabase → Settings → Database: `db.<ref>.supabase.co` no longer resolves
over IPv4.

THE SAFETY PROPERTY

Every statement 0016 uses is transactional in PostgreSQL — `create extension`,
`create or replace function`, `alter table ... drop/add column`, a
non-concurrent `create index`, and `grant`. So the migration *and its
verification* run inside one transaction, and it commits only if every check
passes. A failed check rolls the whole thing back and leaves the database
exactly as it was found.

That matters more than usual for 0016, which drops and rebuilds
`wiki_articles.fts`. A generated column that came back empty would break every
search rather than only the accented half the migration was written to fix, and
it would do so silently — the page would just say the team has not written that
up yet. Better to find out before committing.

`--dry-run` uses the same path and always rolls back, so it is a real rehearsal
against the real database rather than a parse check.
"""
import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# The Windows console this repo is developed on defaults to cp1252, which
# cannot encode the arrows in this docstring or the Portuguese spellings the
# checks print back. Left alone, the failure is a UnicodeEncodeError raised
# while *reporting* — after the migration has been applied and before the
# commit decision — which is the worst possible moment for an unrelated crash.
# Degrade unencodable characters instead of dying on them.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

DEFAULT_MIGRATION = "supabase/migrations/0016_unaccent_wiki_search.sql"

# (unaccented, accented) pairs that must return identical, non-zero result sets
# once 0016 is in. Measured before it: the left column returned 0 every time.
ACCENT_PAIRS = [("licenca", "licença"), ("camara", "câmara"),
                ("construcao", "construção")]


def mask(dsn: str) -> str:
    """postgresql://user:secret@host/db -> postgresql://user:***@host/db"""
    if "://" not in dsn or "@" not in dsn:
        return dsn
    scheme, rest = dsn.split("://", 1)
    creds, host = rest.rsplit("@", 1)
    user = creds.split(":", 1)[0]
    return f"{scheme}://{user}:***@{host}"


def preflight(cur):
    """Report who we are connected as, and catch the one failure mode that
    would make every check below fail for an unrelated reason.

    wiki_search() is `security invoker` and 0007's read policy is
    `auth.uid() is not null`, which is never true on a direct Postgres
    connection. The table owner bypasses RLS, so as the owner this is fine —
    but connect as some other unprivileged role and every search returns zero
    rows whether or not the migration worked. Say so up front instead of
    reporting six confusing failures."""
    cur.execute("select current_user, current_setting('server_version')")
    who, version = cur.fetchone()
    print(f"  connected as   : {who}")
    print(f"  server version : {version}")

    cur.execute("select to_regclass('public.wiki_articles') is not null")
    if not cur.fetchone()[0]:
        print("  wiki_articles  : MISSING — 0007 is not applied to this database.")
        return None

    cur.execute("select count(*) from wiki_articles")
    n = cur.fetchone()[0]
    print(f"  wiki_articles  : {n} rows visible")
    if n == 0:
        print("  ! zero rows visible. Either the corpus is empty or this role is")
        print("    subject to RLS. Check the connection string names the owner.")
    return n


def before_snapshot(cur):
    """What the accent queries do *now*, so the run prints a real before/after
    rather than asserting an improvement nobody watched happen."""
    out = {}
    for plain, accented in ACCENT_PAIRS:
        for term in (plain, accented):
            try:
                cur.execute("select count(*) from wiki_search(%s, 100)", (term,))
                out[term] = cur.fetchone()[0]
            except Exception:
                # wiki_search may not exist yet, or may be mid-change; the
                # before picture is informational, never a gate.
                out[term] = None
    return out


def verify(cur, articles_before):
    """Returns [(ok, label, detail)]. Every one of these must pass to commit."""
    checks = []

    def add(ok, label, detail=""):
        checks.append((bool(ok), label, detail))

    cur.execute("select public.wiki_unaccent(%s)", ("licença",))
    got = cur.fetchone()[0]
    add(got == "licenca", "wiki_unaccent() folds diacritics", f"licença -> {got!r}")

    # The check this script exists for.
    cur.execute("select count(*) from wiki_articles "
                "where fts is null or fts = ''::tsvector")
    empty = cur.fetchone()[0]
    add(empty == 0, "every article has a non-empty fts",
        f"{empty} empty of {articles_before}")

    cur.execute("select 1 from pg_indexes where schemaname = 'public' "
                "and indexname = 'idx_wiki_fts'")
    add(cur.fetchone() is not None, "idx_wiki_fts was recreated",
        "dropping the column drops the index with it")

    cur.execute("select count(*) from wiki_articles")
    now = cur.fetchone()[0]
    add(now == articles_before, "no articles lost",
        f"{articles_before} -> {now}")

    for plain, accented in ACCENT_PAIRS:
        cur.execute("select count(*) from wiki_search(%s, 100)", (plain,))
        a = cur.fetchone()[0]
        cur.execute("select count(*) from wiki_search(%s, 100)", (accented,))
        b = cur.fetchone()[0]
        add(a == b and a > 0, f"{plain!r} matches {accented!r}",
            f"{a} vs {b} hits")

    # 0016 rewrites wiki_search and re-grants it. Confirm the posture 0007 and
    # 0013 set is still the posture, rather than trusting that a replace
    # preserved it.
    cur.execute("select has_function_privilege('authenticated', "
                "'public.wiki_search(text,integer)', 'execute')")
    add(cur.fetchone()[0], "authenticated can execute wiki_search")

    cur.execute("select has_table_privilege('authenticated', "
                "'public.wiki_articles', 'select')")
    add(cur.fetchone()[0], "authenticated can still read wiki_articles")

    cur.execute("select has_table_privilege('anon', "
                "'public.wiki_articles', 'select')")
    leaked = cur.fetchone()[0]
    add(not leaked, "anon still holds nothing on wiki_articles",
        "0013's posture" + (" — LEAKED" if leaked else ""))

    return checks


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("migration", nargs="?", default=DEFAULT_MIGRATION,
                    help=f"path to the .sql file (default: {DEFAULT_MIGRATION})")
    ap.add_argument("--database-url", default=os.getenv("DATABASE_URL"),
                    help="session pooler connection string, or set DATABASE_URL")
    ap.add_argument("--dry-run", action="store_true",
                    help="apply and verify against the real database, then always "
                         "roll back")
    args = ap.parse_args()

    if not args.database_url:
        ap.error("no database url: pass --database-url or set DATABASE_URL. "
                 "Supabase -> Settings -> Database -> Session pooler.")

    path = Path(args.migration)
    if not path.is_file():
        ap.error(f"no such migration: {path}")
    sql = path.read_text(encoding="utf-8")

    import psycopg2  # deferred, matching kb/sync_wiki.py
    from kb.sync_wiki import normalize_db_url

    dsn = normalize_db_url(args.database_url)
    print(f"migration : {path.name}  ({len(sql)} bytes)")
    print(f"target    : {mask(dsn)}")
    print(f"mode      : {'DRY RUN (always rolls back)' if args.dry_run else 'apply'}")
    print()

    try:
        conn = psycopg2.connect(dsn, connect_timeout=15)
    except psycopg2.Error as exc:
        # Almost always one of three things, so name them rather than making
        # the reader decode libpq's wording.
        print(f"could not connect: {str(exc).strip()}")
        print("\n  - 'could not translate host name': the direct host is gone; use the")
        print("    Session pooler string (Supabase -> Settings -> Database).")
        print("  - 'password authentication failed': reset the database password there.")
        print("  - 'Tenant or user not found': the pooler wants the full user,")
        print("    postgres.<project-ref>, not bare 'postgres'.")
        return 2

    conn.autocommit = False           # one transaction for everything below
    try:
        with conn.cursor() as cur:
            print("preflight")
            articles = preflight(cur)
            if articles is None:
                conn.rollback()
                return 2

            before = before_snapshot(cur)
            print("\nbefore")
            for plain, accented in ACCENT_PAIRS:
                print(f"  {plain:12} {str(before.get(plain)):>5} hits"
                      f"   |  {accented:14} {str(before.get(accented)):>5} hits")

            print("\napplying...")
            cur.execute(sql)
            print("  statements executed, not yet committed")

            print("\nverify")
            checks = verify(cur, articles)
            for ok, label, detail in checks:
                print(f"  [{'PASS' if ok else 'FAIL'}] {label:42} {detail}")

            failed = [c for c in checks if not c[0]]
            if failed or args.dry_run:
                conn.rollback()
                if failed:
                    print(f"\n{len(failed)} check(s) failed — ROLLED BACK, "
                          "database unchanged.")
                    return 1
                print("\nAll checks passed. DRY RUN, so rolled back anyway.")
                print("Re-run without --dry-run to keep it.")
                return 0

            conn.commit()
            print("\nAll checks passed. COMMITTED.")
            print("Next: re-run the wiki sync (python -m kb.sync_wiki) — the "
                  "corpus is still\nthe pre-681e72a snapshot, so 108 should "
                  "fall to about 102 as the vault\nmachinery files are pruned.")
            return 0
    except Exception as exc:
        conn.rollback()
        print(f"\nERROR: {type(exc).__name__}: {exc}")
        print("Rolled back — database unchanged.")
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
