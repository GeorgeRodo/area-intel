"""
Research agent. Flow: open ResearchTask -> coverage check -> research ->
Findings (tier proposed, source attached) -> review queue. Never writes
verified nodes directly.

Backends:
- AnthropicResearcher : real research via Claude + web search (needs
  ANTHROPIC_API_KEY). Prompts in Portuguese-first source discipline.
- HeuristicResearcher : offline fallback. Decomposes the question into the
  gap categories it touches and emits structured "needs field verification"
  findings so the loop is exercisable without any API.

Both return list[dict] with keys: category, title, body, proposed_tier,
source_name, source_url.
"""
import json
import os
from sqlalchemy import select
from sqlalchemy.orm import Session

from db.models import ResearchTask, Finding, Category, utcnow
from kb.store import coverage
from agent.kb_context import wiki_context_block, wiki_snippets

SYSTEM_PROMPT = """You are the research agent for a Portugal real-estate intelligence \
knowledge base. Source priority, in order:
1. Internal wiki notes (attached below, if present, as "Internal wiki notes"). This is \
the team's compiled source of truth for this domain right now. Start here: use it to \
ground your answer and adopt its claims as your working basis. Cite the article by title \
when you draw on it.
2. Web search. Use it to verify a wiki claim that looks dated or uncertain, to cover \
anything the wiki doesn't address, and to find the specific primary source (DR, INE, \
camara) a tier A/B promotion needs. Portuguese-language primary sources first (dre.pt, \
ine.pt, bportugal.pt, camara municipal sites), English second, output in English.
3. Your own general knowledge, only as a last resort, and only when the finding body \
explicitly says the claim rests on general knowledge rather than the wiki or a search \
result.
Rules:
- Every finding is one atomic claim: title (one line), body (3-6 sentences), a real \
source name and URL, and a proposed reliability tier:
  A = verified primary (official registry/publication)
  B = verified secondary (reputable report, credentialed expert on record)
  C = professional hearsay (this includes a well-corroborated internal wiki note that \
has no primary citation of its own)
  D = unverified / single source
- Never fabricate sources. If a claim rests only on a wiki note, emit it as tier C with \
source_name set to the wiki article's title. If you cannot ground a claim at all, emit it \
as tier D with source_name "UNGROUNDED" and say what field verification would confirm it. \
Tier A/B always requires a primary source found via web search, never the wiki alone.
- Return STRICT JSON: {"findings": [{"category": ..., "title": ..., "body": ..., \
"proposed_tier": ..., "source_name": ..., "source_url": ...}]}
- category must be one of: market, regulatory, enforcement, physical, financing, \
condo, tax, liquidity, professionals, operational, esg, infrastructure."""

# keyword -> category routing for the offline backend
_ROUTES = [
    (("preço", "price", "m2", "yield", "inventory", "listing"), Category.MARKET),
    (("dl 108", "decreto", "lei", "al ", "alojamento", "licens", "licença", "imt", "regulation"), Category.REGULATORY),
    (("camara", "câmara", "backlog", "enforcement", "legaliz"), Category.ENFORCEMENT),
    (("epc", "condition", "structural", "renovation", "asbestos", "wiring", "moisture"), Category.PHYSICAL),
    (("bank", "mortgage", "ltv", "financing", "spread"), Category.FINANCING),
    (("condo", "condomín", "reserve", "assessment"), Category.CONDO),
    (("tax", "imi", "nhr", "audit", "capital gains"), Category.TAX),
    (("liquidity", "days on market", "exit", "resale"), Category.LIQUIDITY),
    (("lawyer", "agent quality", "surveyor", "notary"), Category.PROFESSIONALS),
    (("management", "maintenance", "contractor", "water", "insurance"), Category.OPERATIONAL),
    (("epbd", "green", "stranded", "esg"), Category.ESG),
    (("airport", "port", "rail", "data center", "infrastructure", "project"), Category.INFRASTRUCTURE),
]


class HeuristicResearcher:
    def run(self, task: ResearchTask, kb_context: str) -> list[dict]:
        q = task.question.lower()
        def hit(k: str) -> bool:
            # short tokens need word boundaries ("al " must not match "special")
            if len(k.strip()) <= 3:
                import re as _re
                return bool(_re.search(rf"\b{_re.escape(k.strip())}\b", q))
            return k in q
        cats = [c for kws, c in _ROUTES if any(hit(k) for k in kws)] or [Category.MARKET]
        muni = task.municipality.name if task.municipality else "target area"

        # kb_context is "<coverage summary>\n\n<wiki block>" (wiki block omitted
        # when no WIKI_PATH is set) - split so a long wiki block never crowds
        # out the coverage line via a blind character truncation.
        coverage_summary = kb_context.split("\n\n", 1)[0]

        snippets = wiki_snippets(task.question, k=3)
        if snippets:
            wiki_lines = "\n".join(
                f"- **{s['title']}** ({s['path']}, {'verified' if s['verified'] else 'unverified'}): "
                f"{s['excerpt'][:220].rstrip()}..."
                for s in snippets
            )
            wiki_block = f"Related wiki notes (source of truth for this stub):\n{wiki_lines}"
            # Best match becomes the finding's actual citation, not just prose -
            # traceable through promote/reject like any other source. Still tier C:
            # a wiki note is not a primary source, so it can't reach A/B on its own.
            top = snippets[0]
            proposed_tier = "C"
            source_name = top["title"]
            source_url = f"wiki:{top['path']}"
        else:
            wiki_block = "No matching wiki notes found."
            proposed_tier = "D"
            source_name = "UNGROUNDED"
            source_url = ""

        out = []
        for cat in dict.fromkeys(cats):  # dedupe, keep order
            out.append({
                "category": cat.value,
                "title": f"[NEEDS VERIFICATION] {task.question.strip()[:180]}",
                "body": (
                    f"Auto-routed to '{cat.value}' for {muni}. No API backend is "
                    f"configured, so this is a structured research stub, not an answer. "
                    f"Field protocol: pull the relevant primary source (INE/DRE/camara), "
                    f"cross-check with one practitioner, then promote with the correct tier.\n\n"
                    f"KB coverage at dispatch: {coverage_summary}\n\n"
                    f"{wiki_block}"
                ),
                "proposed_tier": proposed_tier,
                "source_name": source_name,
                "source_url": source_url,
            })
        return out


class AnthropicResearcher:
    # claude-sonnet-5 rather than claude-sonnet-4-6, which this used to pin.
    # That was not a cost tradeoff in either direction: Sonnet 5 is both newer
    # and cheaper, $2/$10 per MTok against 4-6's $3/$15. The note in TASKS that
    # framed the choice as "stay on 4-6 or roughly double the cost with Opus"
    # had only compared against Opus and missed the option that was down in
    # both columns.
    #
    # Opus 5 ($5/$25) is a real candidate for this workload and should be
    # judged on the findings it proposes, not on the rate card — at pilot
    # volume the whole spread is tens of dollars a month, and web search
    # results dominate the bill regardless of which model reads them.
    def __init__(self, model: str = "claude-sonnet-5"):
        import anthropic  # lazy import
        self.client = anthropic.Anthropic()
        self.model = model

    def run(self, task: ResearchTask, kb_context: str) -> list[dict]:
        muni = task.municipality.name if task.municipality else "Portugal (national)"
        user = (
            f"Municipality: {muni}\n"
            f"Question: {task.question}\n"
            f"Current KB coverage summary (avoid duplicating fresh verified claims):\n"
            f"{kb_context}\n"
            f"Produce 1-5 atomic findings as strict JSON."
        )
        resp = self.client.messages.create(
            model=self.model,
            # Raised from 2000 because adaptive thinking below shares this
            # budget with the visible answer. At 2000 a model that thought
            # hard about a tier judgement could run out mid-JSON, and the
            # only symptom would be a [PARSE FAILURE] finding in the review
            # queue that looks like a bad model rather than a small ceiling.
            max_tokens=16000,
            system=SYSTEM_PROMPT,
            # Adaptive thinking. The judgement this agent makes is exactly the
            # kind that benefits: deciding whether a source is primary enough
            # for tier A/B, or whether a claim only rests on a wiki note and
            # must stay at C. Effort defaults to 'high', which is the right
            # starting point here; drop it to 'medium' via
            # output_config={"effort": ...} if per-question cost matters more
            # than tier accuracy.
            thinking={"type": "adaptive"},
            # web_search_20260209, not the basic web_search_20250305 this used
            # to send. The newer tool does dynamic filtering, which cuts how
            # much of each result reaches the context window — better answers
            # and a smaller bill from the same call, since search results are
            # by far the largest input this agent pays for.
            #
            # Do not also declare code_execution alongside it: dynamic
            # filtering runs code execution internally, and a second declared
            # environment confuses the model about which one it is in.
            tools=[{"type": "web_search_20260209", "name": "web_search"}],
            messages=[{"role": "user", "content": user}],
        )
        text = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")
        text = text.replace("```json", "").replace("```", "").strip()
        try:
            payload = json.loads(text)
            return payload.get("findings", [])
        except json.JSONDecodeError:
            return [{
                "category": "market", "title": "[PARSE FAILURE] agent output not JSON",
                "body": text[:1500], "proposed_tier": "D",
                "source_name": "UNGROUNDED", "source_url": "",
            }]


def get_backend():
    if os.getenv("ANTHROPIC_API_KEY"):
        try:
            return AnthropicResearcher()
        except Exception:
            pass
    return HeuristicResearcher()


def _kb_context(s: Session, muni_id: int | None, question: str = "") -> str:
    if not muni_id:
        base = "no municipality bound"
    else:
        cov = coverage(s, muni_id)
        lines = [f"{k}: {v['verified_fresh']} fresh verified (best tier {v['best_tier']})"
                 for k, v in cov.items() if v["total"]]
        base = "; ".join(lines) or "empty"

    wiki_block = wiki_context_block(question) if question else ""
    return f"{base}\n\n{wiki_block}" if wiki_block else base


def process_open_tasks(s: Session, limit: int = 10) -> int:
    """Main loop entry. Returns number of findings created."""
    backend = get_backend()
    tasks = list(s.scalars(
        select(ResearchTask).where(ResearchTask.status == "open")
        .order_by(ResearchTask.created_at).limit(limit)
    ))
    valid_cats = {c.value for c in Category}
    created = 0
    for task in tasks:
        task.status = "in_progress"
        s.commit()
        try:
            findings = backend.run(task, _kb_context(s, task.municipality_id, task.question))
            for f in findings:
                finding = _to_finding(task.id, f, valid_cats)
                if finding is None:
                    continue
                s.add(finding)
                created += 1
            task.status = "answered"
            task.answered_at = utcnow()
            s.commit()
        except Exception:
            # Put the task back rather than leaving it 'in_progress'. Only
            # 'open' tasks are ever selected, so a task stranded mid-flight is
            # stranded permanently: the question is never answered, nothing
            # appears in the review queue, and the person who asked it is told
            # the worker will pick it up within a minute. A network blip on the
            # Anthropic call was enough to lose a question for good.
            #
            # Rolled back first because the failure may have come from the
            # database, in which case the session cannot be written to until it
            # is — and reopening the task is the one write that must land.
            s.rollback()
            task.status = "open"
            s.commit()
            raise
    return created


def _to_finding(task_id: int, f: dict, valid_cats: set[str]) -> Finding | None:
    """Coerce one backend dict into a Finding, or None if it is unusable.

    The Anthropic backend's findings come from parsed model JSON, so no key is
    guaranteed to be present or to be a string. Indexing f["title"] directly
    raised KeyError on a malformed response, which — before the caller above
    caught it — took down the whole routine and, with it, every other finding
    in the batch. One bad item should cost that item, not the run.
    """
    title = str(f.get("title") or "").strip()
    body = str(f.get("body") or "").strip()
    if not title or not body:
        return None

    category = f.get("category")
    if category not in valid_cats:
        category = "market"

    tier = f.get("proposed_tier")
    # The column is one character with a CHECK behind it, so anything the model
    # invented is dropped to D — unverified, which is the honest default.
    if tier not in {"A", "B", "C", "D"}:
        tier = "D"

    return Finding(
        task_id=task_id,
        category=category,
        title=title[:255],
        body=body,
        proposed_tier=tier,
        source_name=(str(f["source_name"])[:255] if f.get("source_name") else None),
        source_url=(str(f["source_url"]) if f.get("source_url") else None),
    )


if __name__ == "__main__":
    from db.session import SessionLocal, init_db
    init_db()
    with SessionLocal() as s:
        n = process_open_tasks(s)
        print(f"Created {n} findings (backend: {get_backend().__class__.__name__})")
