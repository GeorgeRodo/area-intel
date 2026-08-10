"""Sync the llm-wiki vault into Supabase (wiki_articles + wiki_links).

    python -m kb.sync_wiki --dry-run                  # no DB needed, prints the plan
    python -m kb.sync_wiki                            # WIKI_PATH + DATABASE_URL from env
    python -m kb.sync_wiki --wiki-path ../pt-buyers-kb

Idempotent and content-addressed: each file's sha256 (frontmatter included) is
stored, and a row is only rewritten when that hash moves. Re-running changes
nothing, so the GitHub Action can be as trigger-happy as it likes.

Paths not present in the walk are deleted, which is what makes renames and
deletions in the vault propagate instead of leaving ghost articles the
dashboard would still serve. That is also the dangerous half of this script, so
it refuses to run when the walk turns up nothing (see EMPTY_WALK below): the
usual cause is a mistyped --wiki-path, and the usual consequence of trusting it
would be an emptied table.

Writes as the table owner / service role, deliberately: 0007 gives no client
role an insert policy, so this path is the only way content enters.
"""
import argparse
import os
import subprocess
import sys
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from kb.wiki_parse import as_list, extract_links, iter_articles  # noqa: E402

ROUTINE = "wiki_sync"


def normalize_db_url(url: str) -> str:
    """db/session.py speaks SQLAlchemy ('postgresql+psycopg2://...'); psycopg2
    itself does not understand the driver suffix. Accept either form so the
    same DATABASE_URL works for the worker and for this script."""
    return url.replace("postgresql+psycopg2://", "postgresql://", 1)


def _as_date(value) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str) and value.strip():
        try:
            return date.fromisoformat(value.strip()[:10])
        except ValueError:
            return None
    return None


def commit_sha(root: Path) -> str | None:
    """The commit of the *vault* this content came from.

    Asks the vault's own git checkout first and only then falls back to the
    environment. GITHUB_SHA is deliberately not preferred: the Action runs in
    the dashboard repo, so in CI that variable holds the dashboard's commit,
    and recording it here would attribute wiki content to the wrong history.
    WIKI_COMMIT_SHA is the explicit override for callers that know better.
    """
    try:
        out = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "HEAD"],
            capture_output=True, text=True, timeout=10,
        )
        if out.returncode == 0 and out.stdout.strip():
            return out.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        pass
    return os.getenv("WIKI_COMMIT_SHA") or None


def collect(root: Path) -> list[dict]:
    """Vault -> rows ready for wiki_articles, keyed by vault-relative posix path."""
    rows = []
    for a in iter_articles(root):
        meta = a["meta"]
        rows.append({
            "path": a["path"].relative_to(root).as_posix(),
            "title": a["title"],
            "doc_type": str(meta["type"]) if meta.get("type") else None,
            "tags": a["tags"],
            "wiki_status": str(meta["status"]) if meta.get("status") else None,
            "brand": str(meta["brand"]) if meta.get("brand") else None,
            "wiki_verified": a["verified"],
            "wiki_sources": as_list(meta.get("sources")),
            "body": a["body"],
            "content_hash": a["content_hash"],
            "updated_in_wiki": _as_date(meta.get("updated")),
            "links": extract_links(a["body"]),
        })
    return rows


def resolve_links(rows: list[dict]) -> list[tuple[str, str, str | None]]:
    """[[slug]] -> (src_path, slug, dst_path or None).

    Obsidian links target a file *stem*, not a path, so resolution is a stem
    lookup. A stem that two files share is ambiguous in the vault itself; we
    take the first in sorted order and leave it at that rather than inventing a
    disambiguation rule the vault does not have. Unresolved slugs are kept with
    dst_path null - a dangling link is a signal, not an error.
    """
    by_stem: dict[str, str] = {}
    for r in rows:
        by_stem.setdefault(Path(r["path"]).stem, r["path"])
    out = []
    for r in rows:
        for slug in r["links"]:
            out.append((r["path"], slug, by_stem.get(Path(slug).name)))
    return out


def plan(rows: list[dict], existing: dict[str, str]) -> tuple[list[dict], list[str]]:
    """(rows to write, paths to delete). A row is written only when its hash
    differs from what the table already holds."""
    changed = [r for r in rows if existing.get(r["path"]) != r["content_hash"]]
    seen = {r["path"] for r in rows}
    return changed, [p for p in existing if p not in seen]


UPSERT = """
insert into wiki_articles (
  path, title, doc_type, tags, wiki_status, brand, wiki_verified,
  wiki_sources, body, content_hash, updated_in_wiki, commit_sha, synced_at
) values (
  %(path)s, %(title)s, %(doc_type)s, %(tags)s, %(wiki_status)s, %(brand)s,
  %(wiki_verified)s, %(wiki_sources)s, %(body)s, %(content_hash)s,
  %(updated_in_wiki)s, %(commit_sha)s, now()
)
on conflict (path) do update set
  title = excluded.title, doc_type = excluded.doc_type, tags = excluded.tags,
  wiki_status = excluded.wiki_status, brand = excluded.brand,
  wiki_verified = excluded.wiki_verified, wiki_sources = excluded.wiki_sources,
  body = excluded.body, content_hash = excluded.content_hash,
  updated_in_wiki = excluded.updated_in_wiki, commit_sha = excluded.commit_sha,
  synced_at = now()
"""


def sync(conn, rows: list[dict], sha: str | None, log_run: bool = True) -> dict:
    # Naive UTC, matching db.models.utcnow(): routine_runs.started_at is a bare
    # `timestamp` that has always held UTC, and a local-time value here would
    # sort this run wrongly against every row the worker writes.
    started = datetime.now(timezone.utc).replace(tzinfo=None)
    with conn.cursor() as cur:
        cur.execute("select path, content_hash from wiki_articles")
        existing = dict(cur.fetchall())

        changed, gone = plan(rows, existing)

        for r in changed:
            cur.execute(UPSERT, {**{k: v for k, v in r.items() if k != "links"},
                                 "commit_sha": sha})
        if gone:
            cur.execute("delete from wiki_articles where path = any(%s)", (gone,))

        # Links are rebuilt wholesale rather than diffed: at vault scale the
        # write is trivial, and a diff would have to chase links whose *target*
        # appeared or vanished this run, not just links in changed files.
        cur.execute("delete from wiki_links")
        links = resolve_links(rows)
        cur.executemany(
            "insert into wiki_links (src_path, dst_slug, dst_path) "
            "values (%s, %s, %s) on conflict do nothing", links)

        stats = {
            "written": len(changed), "deleted": len(gone),
            "unchanged": len(rows) - len(changed), "links": len(links),
            "dangling": sum(1 for _, _, d in links if d is None),
        }

        # Surfaces the sync in the dashboard's run log next to agent_tasks and
        # freshness_sweep - same table, so no frontend change is needed to see
        # whether the wiki is current.
        if log_run:
            cur.execute(
                "insert into routine_runs (routine, status, detail, items_out, "
                "started_at, finished_at) values (%s, 'ok', %s, %s, %s, now())",
                (ROUTINE,
                 f"{stats['written']} written, {stats['deleted']} deleted, "
                 f"{stats['unchanged']} unchanged, {stats['dangling']} dangling links",
                 stats["written"], started))
    conn.commit()
    return stats


EMPTY_WALK = (
    "found 0 articles - refusing to sync, because this would delete every row "
    "in wiki_articles. Check --wiki-path / WIKI_PATH points at the vault root."
)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--wiki-path", default=os.getenv("WIKI_PATH"))
    ap.add_argument("--database-url", default=os.getenv("DATABASE_URL"))
    ap.add_argument("--dry-run", action="store_true",
                    help="parse and report, touch no database")
    ap.add_argument("--no-log", action="store_true",
                    help="skip the routine_runs row")
    args = ap.parse_args()

    if not args.wiki_path:
        ap.error("no wiki path: pass --wiki-path or set WIKI_PATH")
    root = Path(args.wiki_path).expanduser().resolve()
    if not root.is_dir():
        ap.error(f"not a directory: {root}")

    rows = collect(root)
    print(f"{root}: {len(rows)} article(s)")
    if not rows:
        print(EMPTY_WALK, file=sys.stderr)
        return 1

    if args.dry_run:
        links = resolve_links(rows)
        dangling = sorted({s for _, s, d in links if d is None})
        print(f"  {len(links)} wikilink(s), {len(dangling)} unresolved")
        for r in rows[:5]:
            print(f"  - {r['path']}  [{', '.join(r['tags']) or 'no tags'}]")
        if len(rows) > 5:
            print(f"  ... and {len(rows) - 5} more")
        if dangling:
            print(f"  unresolved: {', '.join(dangling[:12])}"
                  + (" ..." if len(dangling) > 12 else ""))
        print("dry run: nothing written")
        return 0

    if not args.database_url:
        ap.error("no database url: pass --database-url or set DATABASE_URL "
                 "(or use --dry-run)")

    import psycopg2  # imported here so --dry-run works without the driver

    with psycopg2.connect(normalize_db_url(args.database_url)) as conn:
        stats = sync(conn, rows, commit_sha(root), log_run=not args.no_log)
    print("wrote {written}, deleted {deleted}, unchanged {unchanged}, "
          "{links} links ({dangling} dangling)".format(**stats))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
