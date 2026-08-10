"""
Retrieval loader for the external llm-wiki (Obsidian vault, plain markdown +
YAML frontmatter). Read-only: globs articles (kb.wiki_parse does the walking
and frontmatter parsing, shared with kb/sync_wiki.py), scores by keyword
overlap against a research question, returns top-k snippets for the agent's
kb_context.

The team's compiled source of truth for this domain - the agent is instructed to
start research here before reaching for web search. Still not a *verified* source:
any Finding it influences goes through the review gate like everything else, and
tops out at tier C unless the article points at a primary source the agent can
independently ground (tier A/B requires that primary source, never the wiki alone).

Optional: if WIKI_PATH is unset or missing, wiki_snippets() returns [] and
the research loop runs exactly as before.
"""
import os
from pathlib import Path

from kb.wiki_parse import iter_articles, tokenize


def wiki_snippets(question: str, k: int = 5, wiki_path: str | None = None) -> list[dict]:
    """Top-k wiki articles relevant to `question`, ranked by keyword overlap
    (title matches weigh 3x, tags 2x, body 1x). Returns [] if no wiki is
    configured/reachable or nothing scores above zero."""
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
        })
    return out


def wiki_context_block(question: str, k: int = 5, wiki_path: str | None = None) -> str:
    """Formatted block to append to the agent's kb_context. Empty string if
    there's nothing to say (no wiki configured, or no relevant articles)."""
    snippets = wiki_snippets(question, k=k, wiki_path=wiki_path)
    if not snippets:
        return ""
    lines = [
        "Internal wiki notes (the team's compiled source of truth for this domain - "
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
        print(f"{s['score']:3d}  {s['title']}  ({s['path']})")
