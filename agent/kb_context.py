"""
Retrieval loader for the external llm-wiki and Qdrant Knowledge Base.

Queries Qdrant vector database first for semantic vector search across indexed
knowledge_nodes and wiki_articles. Falls back to keyword matching over local
Obsidian vault markdown files if Qdrant is unreachable or unconfigured.
"""
import os
from pathlib import Path

from kb.wiki_parse import iter_articles, tokenize


def wiki_snippets(
    question: str,
    k: int = 5,
    wiki_path: str | None = None,
    municipality_id: int | None = None,
    category: str | None = None,
) -> list[dict]:
    """Top-k relevant knowledge snippets for `question`.
    First attempts Qdrant vector search. If Qdrant returns results, formats and returns them.
    Otherwise, falls back to keyword matching over local markdown articles.
    """
    # 1. Try Qdrant vector search
    try:
        from kb.vector_store import search_vectors
        qdrant_results = search_vectors(
            query=question,
            k=k,
            municipality_id=municipality_id,
            category=category,
        )
        if qdrant_results:
            snippets = []
            for res in qdrant_results:
                body = res.get("body", "").strip()
                excerpt = body
                if len(excerpt) > 500:
                    cut = excerpt.rfind("\n\n", 0, 500)
                    excerpt = excerpt[: cut if cut > 100 else 500].strip() + "..."
                snippets.append({
                    "title": res.get("title", ""),
                    "path": res.get("wiki_path") or f"node#{res.get('node_id')}",
                    "tags": res.get("payload", {}).get("tags", []),
                    "verified": res.get("verified", True if res.get("source_type") == "node" else False),
                    "excerpt": excerpt,
                    "score": int(res.get("score", 0) * 100),
                    "source_type": res.get("source_type", "wiki"),
                })
            return snippets
    except Exception as e:
        # Fallback to local keyword search
        pass

    # 2. Local Keyword Fallback
    root_str = wiki_path or os.getenv("WIKI_PATH")
    if not root_str:
        return []
    root = Path(root_str)
    if not root.is_dir():
        return []

    q_tokens = tokenize(question)
    if not q_tokens:
        return []

    scored = []
    for article in iter_articles(root):
        score = (
            3 * len(q_tokens & tokenize(article["title"]))
            + 2 * len(q_tokens & tokenize(" ".join(article["tags"])))
            + len(q_tokens & tokenize(article["body"]))
        )
        if score > 0:
            scored.append((score, article))
    scored.sort(key=lambda t: t[0], reverse=True)

    out = []
    for score, article in scored[:k]:
        excerpt = article["body"].strip()
        if len(excerpt) > 500:
            cut = excerpt.rfind("\n\n", 0, 500)
            excerpt = excerpt[: cut if cut > 100 else 500].strip() + "..."
        out.append({
            "title": article["title"],
            "path": str(article["path"].relative_to(root)),
            "tags": article["tags"],
            "verified": article["verified"],
            "excerpt": excerpt,
            "score": score,
            "source_type": "wiki",
        })
    return out


def wiki_context_block(
    question: str,
    k: int = 5,
    wiki_path: str | None = None,
    municipality_id: int | None = None,
) -> str:
    """Formatted block to append to the agent's kb_context. Empty string if
    there's nothing to say (no wiki/Qdrant configured, or no relevant articles)."""
    snippets = wiki_snippets(question, k=k, wiki_path=wiki_path, municipality_id=municipality_id)
    if not snippets:
        return ""
    lines = [
        "Internal knowledge base notes (compiled source of truth for this domain - "
        "start here and use these as your working basis; still ground any claim in a "
        "primary source, found via web search, before proposing tier A/B):"
    ]
    for s in snippets:
        flag = "verified" if s["verified"] else "unverified"
        lines.append(f"- [{s['title']}] ({flag}, {s['path']}): {s['excerpt']}")
    return "\n".join(lines)


if __name__ == "__main__":
    import sys
    q = " ".join(sys.argv[1:]) or "AL alojamento local status Melides"
    for s in wiki_snippets(q):
        print(f"{s['score']:3d}  {s['title']}  ({s['path']}) [{s['source_type']}]")
