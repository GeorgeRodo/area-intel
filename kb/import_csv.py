"""
Import knowledge data from ANY arbitrary CSV file (e.g. ADENE certificates, INE data, market dumps)
into Supabase Postgres database and Qdrant vector store.

Usage:
    python -m kb.import_csv --file path/to/any_file.csv
    python -m kb.import_csv --file path/to/any_file.csv --dry-run
"""
import argparse
import csv
from datetime import date
import re
import sys
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from .env and web/.env.local
load_dotenv()
load_dotenv(Path(__file__).resolve().parent.parent / "web" / ".env.local")

from sqlalchemy import select

from db.models import Municipality, KnowledgeNode, Category, utcnow
from db.session import SessionLocal, init_db
from kb.vector_store import (
    get_qdrant_client,
    init_collection,
    upsert_knowledge_node,
    upsert_knowledge_nodes_batch,
)

# Common Portuguese Mojibake replacement map for Excel/CSV exports
MOJIBAKE_MAP = {
    "Ã¡": "á", "Ã ':": "á", "Ã ": "à", "Ã¢": "â", "Ã£": "ã", "Ã¤": "ä",
    "Ã©": "é", "Ã¨": "è", "Ãª": "ê", "Ã«": "ë",
    "Ã­": "í", "Ã¬": "ì", "Ã®": "î", "Ã¯": "ï",
    "Ã³": "ó", "Ã²": "ò", "Ã´": "ô", "Ãµ": "õ", "Ã¶": "ö",
    "Ãº": "ú", "Ã¹": "ù", "Ã»": "û", "Ã¼": "ü",
    "Ã§": "ç", "Ã±": "ñ",
    "Ã ": "Á", "Ã€": "À", "Ã‚": "Â", "Ãƒ": "Ã", "Ã„": "Ä",
    "Ã‰": "É", "Ãˆ": "È", "ÃŠ": "Ê", "Ã‹": "Ë",
    "Ã ": "Í", "ÃŒ": "Ì", "ÃŽ": "Î", "Ã ": "Ï",
    "Ã“": "Ó", "Ã’": "Ò", "Ã”": "Ô", "Ã•": "Õ", "Ã–": "Ö",
    "Ãš": "Ú", "Ã™": "Ù", "Ã›": "Û", "Ãœ": "Ü",
    "Ã‡": "Ç", "Ã‘": "Ñ", "Ã-": "í", "Ã£Â§": "ç", "Ã§Ã£": "ção",
}

# Candidate header names (English, French, Portuguese) for smart column matching
TITLE_CANDIDATES = [
    "det_id_certificado", "id_certificado", "id", "title", "titre", "name",
    "nom", "subject", "intitule", "headline", "article", "label", "property", "referencia"
]
BODY_CANDIDATES = [
    "body", "text", "texte", "description", "content", "contenu", "summary",
    "resume", "notes", "details", "data", "observacoes"
]
MUNI_CANDIDATES = [
    "concelho", "municipality_name", "municipality", "muni", "city", "ville",
    "region", "location", "district", "distrito", "freguesia", "zone"
]
CAT_CANDIDATES = ["category", "categorie", "cat", "type", "tipo", "kind", "genre", "domain"]
TIER_CANDIDATES = ["tier", "level", "niveau", "quality", "confidence", "score"]
URL_CANDIDATES = ["source_url", "url", "link", "lien", "source", "website"]


def fix_encoding_text(text: str) -> str:
    """Fix Portuguese Mojibake encoding artifacts in CSV exports."""
    if not isinstance(text, str) or not text:
        return ""
    
    out = text
    # 1. Apply Mojibake mapping
    for bad, good in MOJIBAKE_MAP.items():
        if bad in out:
            out = out.replace(bad, good)
            
    # 2. Try raw_unicode_escape re-encoding if mojibake sequence remains
    if "Ã" in out or "Â" in out:
        try:
            fixed = out.encode("raw_unicode_escape").decode("utf-8")
            if fixed != out and len(fixed) > 0 and "Ã" not in fixed:
                out = fixed
        except Exception:
            pass
    return out


def _clean_key(k: str) -> str:
    """Normalize dictionary keys for fuzzy matching."""
    cleaned = fix_encoding_text(k)
    return re.sub(r"[_\s\-]+", "", cleaned.strip().lower())


def get_field_val(row: dict, candidates: list[str]) -> str | None:
    """Find value in row matching any candidate key."""
    norm_row = {_clean_key(k): fix_encoding_text(v) for k, v in row.items() if k}
    for cand in candidates:
        norm_cand = _clean_key(cand)
        if norm_cand in norm_row and norm_row[norm_cand]:
            return norm_row[norm_cand].strip()
    return None


def auto_detect_category(headers: list[str], filename: str) -> str:
    """Auto-detect category based on CSV column names or filename keywords."""
    combined = " ".join(headers).lower() + " " + filename.lower()
    if any(k in combined for k in ["certificado", "construcao", "edificio", "pisos", "epc", "energetico", "ruina"]):
        return Category.PHYSICAL.value
    if any(k in combined for k in ["preco", "valor", "venda", "renda", "listing", "asking", "m2", "eur"]):
        return Category.MARKET.value
    if any(k in combined for k in ["dl", "decreto", "lei", "regulamento", "licenca", "alojamento"]):
        return Category.REGULATORY.value
    if any(k in combined for k in ["camara", "fiscalizacao", "posture", "backlog"]):
        return Category.ENFORCEMENT.value
    if any(k in combined for k in ["sines", "port", "comboio", "estrada", "infrastructure"]):
        return Category.INFRASTRUCTURE.value
    return Category.MARKET.value


def parse_csv(csv_path: Path) -> tuple[list[dict], str]:
    """Read CSV file with automatic encoding and delimiter detection."""
    if not csv_path.exists():
        raise FileNotFoundError(f"File not found: {csv_path}")

    for enc in ["utf-8-sig", "latin-1", "cp1252", "utf-8"]:
        try:
            rows = []
            with open(csv_path, mode="r", encoding=enc) as f:
                sample = f.read(4096)
                f.seek(0)
                delimiter = ";" if sample.count(";") > sample.count(",") else ","
                reader = csv.DictReader(f, delimiter=delimiter)
                for r in reader:
                    cleaned_r = {
                        fix_encoding_text(k.strip()) if k else f"col_{idx}": fix_encoding_text(v.strip()) if v else ""
                        for idx, (k, v) in enumerate(r.items())
                    }
                    rows.append(cleaned_r)
            if rows and len(rows[0]) > 1:
                print(f"Loaded {len(rows)} row(s) from '{csv_path.name}' (encoding='{enc}', delimiter='{delimiter}')")
                return rows, enc
        except Exception:
            continue

    raise ValueError(f"Could not parse CSV file {csv_path} with supported encodings.")


def extract_node_data(row: dict, row_idx: int, default_category: str) -> dict:
    """Smart extraction of KnowledgeNode fields from ANY arbitrary CSV row."""
    id_val = get_field_val(row, TITLE_CANDIDATES)
    muni_name = get_field_val(row, MUNI_CANDIDATES) or "Grandola"
    category = (get_field_val(row, CAT_CANDIDATES) or default_category).lower()
    tier = (get_field_val(row, TIER_CANDIDATES) or "C").upper()
    source_url = get_field_val(row, URL_CANDIDATES) or ""

    valid_cats = {c.value for c in Category}
    if category not in valid_cats:
        category = default_category

    if tier not in {"A", "B", "C", "D"}:
        tier = "C"

    # Build descriptive title
    if id_val:
        title = f"Record #{id_val} - {muni_name}"
    else:
        first_val = next((v for v in row.values() if v), f"Row #{row_idx}")
        title = f"Data Point #{row_idx}: {first_val[:50]} ({muni_name})"

    # Build comprehensive text body from ALL row fields
    explicit_body = get_field_val(row, BODY_CANDIDATES)
    if explicit_body and len(explicit_body) > 30:
        body = explicit_body
    else:
        lines = []
        for k, v in row.items():
            if k and v:
                lines.append(f"{k}: {v}")
        body = "\n".join(lines)

    return {
        "title": title,
        "body": body,
        "municipality_name": muni_name,
        "category": category,
        "tier": tier,
        "source_url": source_url,
        "status": "verified",
    }


def import_data(rows: list[dict], filename: str, dry_run: bool = False, skip_qdrant: bool = False):
    """Import parsed rows into Supabase and Qdrant."""
    if not rows:
        print("No rows to import.")
        return

    headers = list(rows[0].keys())
    default_cat = auto_detect_category(headers, filename)
    print(f"Auto-detected dataset category: '{default_cat}' from {len(headers)} column(s).")

    parsed_nodes = [extract_node_data(r, idx, default_cat) for idx, r in enumerate(rows, start=1)]

    if dry_run:
        print(f"\n[dry-run] Extracted {len(parsed_nodes)} knowledge node(s):")
        for idx, n in enumerate(parsed_nodes[:3], start=1):
            print(f"\n  --- Sample Row #{idx} ---")
            print(f"  Title: '{n['title']}'")
            print(f"  Category: {n['category']} | Tier: {n['tier']} | Muni: {n['municipality_name']}")
            print(f"  Structured Body for Search/Vector Vector:\n{n['body']}")
        if len(parsed_nodes) > 3:
            print(f"\n  ... and {len(parsed_nodes) - 3} more row(s).")
        return

    # 1. Initialize Supabase DB tables if needed
    init_db()

    # 2. Connect to Qdrant if not skipped
    qdrant_client = None
    if not skip_qdrant:
        qdrant_client = get_qdrant_client()
        if qdrant_client:
            init_collection(qdrant_client)
        else:
            print("[warning] Qdrant connection unavailable. Ingesting to Supabase DB only.")

    inserted_nodes = 0
    qdrant_indexed = 0
    batch_size = 100
    total_count = len(parsed_nodes)

    with SessionLocal() as session:
        muni_cache: dict[str, int] = {}

        # Helper to retrieve or create Municipality ID with in-memory cache
        def get_municipality_id(name: str) -> int:
            if name in muni_cache:
                return muni_cache[name]
            muni = session.scalar(select(Municipality).where(Municipality.name == name))
            if not muni:
                muni = Municipality(name=name, district="Portugal", region="Portugal")
                session.add(muni)
                session.flush()
            muni_cache[name] = muni.id
            return muni.id

        # Process in chunks of batch_size for maximum database and Qdrant performance
        for i in range(0, total_count, batch_size):
            chunk = parsed_nodes[i : i + batch_size]
            db_nodes = []
            chunk_metadata = []

            for item in chunk:
                muni_id = get_municipality_id(item["municipality_name"])
                node = KnowledgeNode(
                    municipality_id=muni_id,
                    category=item["category"],
                    tier=item["tier"],
                    title=item["title"],
                    body=item["body"],
                    status=item["status"],
                    as_of=date.today(),
                    created_by="csv_import",
                    verified_by="csv_import",
                    verified_at=utcnow(),
                )
                session.add(node)
                db_nodes.append(node)
                chunk_metadata.append(item)

            # Flush to assign node IDs in PostgreSQL
            session.flush()
            inserted_nodes += len(db_nodes)

            # Prepare batch payload for Qdrant
            if qdrant_client:
                qdrant_nodes = [
                    {
                        "id": node.id,
                        "title": node.title,
                        "body": node.body,
                        "municipality_id": node.municipality_id,
                        "category": node.category,
                        "tier": node.tier,
                        "status": node.status,
                        "as_of": node.as_of,
                        "source_url": meta["source_url"],
                    }
                    for node, meta in zip(db_nodes, chunk_metadata)
                ]
                indexed_count = upsert_knowledge_nodes_batch(qdrant_nodes, client=qdrant_client)
                qdrant_indexed += indexed_count

            # Commit batch to Supabase PostgreSQL so progress is saved periodically
            session.commit()
            print(f" [Import Progress] {inserted_nodes}/{total_count} nodes saved to Supabase (Qdrant: {qdrant_indexed} vectors)")

    print(f"\nImport finished successfully:")
    print(f" - Supabase DB inserted: {inserted_nodes} node(s)")
    print(f" - Qdrant vectors indexed: {qdrant_indexed} vector(s)")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", "-f", required=True, help="Path to the CSV file to import")
    parser.add_argument("--dry-run", action="store_true", help="Validate CSV without saving to DB or Qdrant")
    parser.add_argument("--skip-qdrant", action="store_true", help="Skip Qdrant vector indexing")
    args = parser.parse_args()

    csv_path = Path(args.file).resolve()
    try:
        rows, _ = parse_csv(csv_path)
        import_data(rows, csv_path.name, dry_run=args.dry_run, skip_qdrant=args.skip_qdrant)
    except Exception as e:
        print(f"Error during import: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
