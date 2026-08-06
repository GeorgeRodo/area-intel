"""
Retrieval loader for the external llm-wiki (Obsidian vault, plain markdown +
YAML frontmatter). Read-only: globs articles, scores by keyword overlap
against a research question, returns top-k snippets for the agent's
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
import re
from pathlib import Path

import yaml

_WORD_RE = re.compile(r"[a-zà-ú0-9]+", re.IGNORECASE)
# .git/.obsidian/.claude are vault plumbing; raw/ is unprocessed source dumps,
# not compiled articles - skip all four.
_SKIP_DIRS = {".git", ".obsidian", ".claude", "raw"}


def _tokenize(text: str) -> set[str]:
    return set(_WORD_RE.findall(text.lower()))


def _parse_article(path: Path) -> dict | None:
    text = path.read_text(encoding="utf-8", errors="ignore")
    meta: dict = {}
    body = text
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            try:
                meta = yaml.safe_load(text[3:end]) or {}
            except yaml.YAMLError:
                meta = {}
            body = text[end + 4:].lstrip("\n")
    if not body.strip():
        return None
    return {
        "path": path,
        "title": meta.get("title") or path.stem,
        "tags": meta.get("tags") or [],
        "verified": bool(meta.get("verified", False)),
        "body": body,
    }


def _iter_articles(root: Path):
    for md in root.rglob("*.md"):
        if any(part in _SKIP_DIRS for part in md.relative_to(root).parts):
            continue
        article = _parse_article(md)
        if article:
            yield article


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

    q_tokens = _tokenize(question)
    if not q_tokens:
        return []

    scored = []
    for article in _iter_articles(root):
        score = (
            3 * len(q_tokens & _tokenize(article["title"]))
            + 2 * len(q_tokens & _tokenize(" ".join(article["tags"])))
            + len(q_tokens & _tokenize(article["body"]))
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
