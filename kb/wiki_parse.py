"""Parser for the external llm-wiki (Obsidian vault: markdown + YAML frontmatter).

Lifted out of agent/kb_context.py so the two consumers of the vault - the
agent's retrieval loader and kb/sync_wiki.py - walk it with one definition of
what counts as an article. When they disagreed, an article could ground a
research answer while being absent from the dashboard, or the reverse.

Pure filesystem + text. No database, no network, no agent imports.
"""
import hashlib
import re
from pathlib import Path

import yaml

WORD_RE = re.compile(r"[a-zà-ú0-9]+", re.IGNORECASE)

# [[slug]] and [[slug|alias]] - Obsidian wikilinks. The alias is display text;
# only the slug identifies the target.
LINK_RE = re.compile(r"\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]")

# .git/.obsidian/.claude are vault plumbing; raw/ is unprocessed source dumps,
# not compiled articles - skip all four. This set is the definition of "the
# wiki": change it here and both consumers move together.
SKIP_DIRS = {".git", ".obsidian", ".claude", "raw"}


def tokenize(text: str) -> set[str]:
    return set(WORD_RE.findall(text.lower()))


def as_list(value) -> list[str]:
    """Frontmatter lists that are sometimes written as a bare scalar.

    `tags: inspection` and `tags: [inspection]` both occur in hand-edited
    vaults. Postgres text[] needs the list form either way, and the old
    keyword scorer silently treated the scalar as its characters.
    """
    if value is None:
        return []
    if isinstance(value, str):
        return [value.strip()] if value.strip() else []
    if isinstance(value, (list, tuple)):
        return [str(v).strip() for v in value if str(v).strip()]
    return [str(value)]


def extract_links(body: str) -> list[str]:
    """Wikilink target slugs in `body`, de-duplicated, order preserved."""
    seen, out = set(), []
    for m in LINK_RE.finditer(body):
        slug = m.group(1).strip()
        if slug and slug not in seen:
            seen.add(slug)
            out.append(slug)
    return out


def parse_article(path: Path) -> dict | None:
    """One vault file -> article dict, or None if it has no body.

    `meta` carries the whole frontmatter so callers can read fields this
    function does not promote; `raw` is the untouched file text, which is what
    content_hash is taken over (so a frontmatter-only edit still counts as a
    change).
    """
    raw = path.read_text(encoding="utf-8", errors="ignore")
    meta: dict = {}
    body = raw
    if raw.startswith("---"):
        end = raw.find("\n---", 3)
        if end != -1:
            try:
                loaded = yaml.safe_load(raw[3:end])
                meta = loaded if isinstance(loaded, dict) else {}
            except yaml.YAMLError:
                meta = {}
            body = raw[end + 4:].lstrip("\n")
    if not body.strip():
        return None
    return {
        "path": path,
        "title": str(meta.get("title") or path.stem),
        "tags": as_list(meta.get("tags")),
        "verified": bool(meta.get("verified", False)),
        "body": body,
        "raw": raw,
        "meta": meta,
        "content_hash": hashlib.sha256(raw.encode("utf-8")).hexdigest(),
    }


def iter_articles(root: Path):
    """Every compiled article under `root`, skipping SKIP_DIRS."""
    for md in sorted(root.rglob("*.md")):
        if any(part in SKIP_DIRS for part in md.relative_to(root).parts):
            continue
        article = parse_article(md)
        if article:
            yield article
