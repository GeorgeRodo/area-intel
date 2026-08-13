"""
Sync Supabase KnowledgeNodes and llm-wiki articles into Qdrant vector database.

Usage:
    python -m kb.sync_qdrant --dry-run
    python -m kb.sync_qdrant --database-url <URL> --wiki-path <PATH>
"""
import argparse
import os
import sys
from pathlib import Path

from sqlalchemy import select

from db.models import KnowledgeNode, NodeStatus
from db.session import SessionLocal
from kb.vector_store import (
    get_qdrant_client,
    init_collection,
    upsert_knowledge_node,
    upsert_wiki_article,
)
from kb.wiki_parse import iter_articles


def get_db_session(db_url: str | None = None):
    if not db_url:
        return SessionLocal()
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    engine = create_engine(db_url, future=True)
    return sessionmaker(bind=engine, expire_on_commit=False, future=True)()


def sync_nodes(session, client=None, dry_run: bool = False) -> int:
    """Fetch verified & stale knowledge nodes from DB and upsert to Qdrant."""
    nodes = list(
        session.scalars(
            select(KnowledgeNode).where(
                KnowledgeNode.status.in_([NodeStatus.VERIFIED.value, NodeStatus.STALE.value])
            )
        )
    )
    if dry_run:
        print(f"[dry-run] Would index {len(nodes)} knowledge node(s) into Qdrant")
        return len(nodes)

    count = 0
    for n in nodes:
        ok = upsert_knowledge_node(
            node_id=n.id,
            title=n.title,
            body=n.body,
            municipality_id=n.municipality_id,
            category=n.category,
            tier=n.tier,
            status=n.status,
            as_of=n.as_of,
            source_url="",
            client=client,
        )
        if ok:
            count += 1
    print(f"Indexed {count}/{len(nodes)} knowledge node(s) into Qdrant")
    return count


def sync_wiki(wiki_path: Path, client=None, dry_run: bool = False) -> int:
    """Walk wiki articles and upsert to Qdrant."""
    if not wiki_path.is_dir():
        print(f"Wiki directory not found: {wiki_path}")
        return 0

    articles = list(iter_articles(wiki_path))
    if dry_run:
        print(f"[dry-run] Would index {len(articles)} wiki article(s) into Qdrant")
        return len(articles)

    count = 0
    for a in articles:
        rel_path = str(a["path"].relative_to(wiki_path))
        meta = a.get("meta", {})
        ok = upsert_wiki_article(
            path=rel_path,
            title=a["title"],
            body=a["body"],
            tags=a.get("tags", []),
            verified=a.get("verified", False),
            doc_type=str(meta.get("type")) if meta.get("type") else None,
            client=client,
        )
        if ok:
            count += 1
    print(f"Indexed {count}/{len(articles)} wiki article(s) into Qdrant")
    return count


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--wiki-path", default=os.getenv("WIKI_PATH"))
    ap.add_argument("--database-url", default=os.getenv("DATABASE_URL"))
    ap.add_argument("--dry-run", action="store_true", help="Report without writing to Qdrant")
    args = ap.parse_args()

    client = None
    if not args.dry_run:
        client = get_qdrant_client()
        if not client:
            print("Error: Could not connect to Qdrant. Check QDRANT_URL.", file=sys.stderr)
            return 1
        if not init_collection(client):
            print("Error: Could not initialize Qdrant collection.", file=sys.stderr)
            return 1

    indexed_nodes = 0
    db_url = args.database_url or os.getenv("DATABASE_URL")
    if db_url:
        try:
            with get_db_session(db_url) as session:
                indexed_nodes = sync_nodes(session, client=client, dry_run=args.dry_run)
        except Exception as e:
            print(f"Warning: Could not connect to DB ({e}) - skipping knowledge_nodes sync.")
    else:
        print("Note: DATABASE_URL not set - skipping knowledge_nodes sync.")

    indexed_wiki = 0
    wiki_path_str = args.wiki_path or os.getenv("WIKI_PATH")
    if wiki_path_str:
        wiki_root = Path(wiki_path_str).expanduser().resolve()
        indexed_wiki = sync_wiki(wiki_root, client=client, dry_run=args.dry_run)
    else:
        print("Note: WIKI_PATH not set - skipping wiki sync.")

    print(f"Sync complete. Total items indexed: {indexed_nodes + indexed_wiki}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
