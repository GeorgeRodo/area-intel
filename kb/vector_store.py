"""
Qdrant Vector Store interface for area-intel Knowledge Base.

Provides vector embeddings, collection management, point upserting,
and semantic vector search across verified knowledge nodes and wiki articles.
"""
import os
import uuid
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from qdrant_client import QdrantClient, models

# Load environment variables from .env and web/.env.local
load_dotenv()
load_dotenv(Path(__file__).resolve().parent.parent / "web" / ".env.local")

COLLECTION_NAME = os.getenv("QDRANT_COLLECTION", "knowledge_base")
DEFAULT_VECTOR_SIZE = int(os.getenv("QDRANT_VECTOR_SIZE", "1536"))


def get_qdrant_client() -> QdrantClient | None:
    """Instantiate QdrantClient using QDRANT_URL or default localhost."""
    url = os.getenv("QDRANT_URL", "http://localhost:6333")
    api_key = os.getenv("QDRANT_API_KEY")
    try:
        client = QdrantClient(url=url, api_key=api_key or None, timeout=10)
        return client
    except Exception as e:
        print(f"[qdrant] Warning: Could not connect to Qdrant at {url}: {e}")
        return None


def get_embedding_vector_size() -> int:
    if os.getenv("OPENAI_API_KEY"):
        return 1536
    try:
        from fastembed import TextEmbedding  # type: ignore
        return 384
    except ImportError:
        return DEFAULT_VECTOR_SIZE


def generate_embeddings(texts: list[str]) -> list[list[float]]:
    """Generate vector embeddings for a list of text strings.
    Uses OpenAI embeddings if OPENAI_API_KEY is set, or fastembed if installed,
    or falls back to a deterministic normalized vector stub.
    """
    if not texts:
        return []

    # Option 1: OpenAI
    openai_key = os.getenv("OPENAI_API_KEY")
    if openai_key:
        try:
            import urllib.request
            import json

            req = urllib.request.Request(
                "https://api.openai.com/v1/embeddings",
                headers={
                    "Authorization": f"Bearer {openai_key}",
                    "Content-Type": "application/json",
                },
                data=json.dumps({
                    "model": os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small"),
                    "input": texts,
                }).encode("utf-8"),
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return [item["embedding"] for item in data["data"]]
        except Exception as e:
            print(f"[qdrant] Warning: OpenAI embedding failed ({e}), falling back...")

    # Option 2: FastEmbed
    try:
        from fastembed import TextEmbedding  # type: ignore
        embedding_model = TextEmbedding()
        return [list(vec) for vec in embedding_model.embed(texts)]
    except ImportError:
        pass

    # Option 3: Fallback stub generator (384 dimensions)
    dim = DEFAULT_VECTOR_SIZE if openai_key else 384
    out = []
    for t in texts:
        # Create deterministic pseudo-vector from text hash for test/offline resilience
        import hashlib
        h = hashlib.sha256(t.encode("utf-8")).digest()
        raw = [(b / 255.0) - 0.5 for b in h]
        padded = (raw * (dim // len(raw) + 1))[:dim]
        norm = sum(x * x for x in padded) ** 0.5 or 1.0
        out.append([x / norm for x in padded])
    return out


def init_collection(client: QdrantClient | None = None) -> bool:
    """Ensure the knowledge_base collection exists in Qdrant with appropriate payload indexes."""
    client = client or get_qdrant_client()
    if not client:
        return False

    dim = get_embedding_vector_size()

    try:
        collections = [c.name for c in client.get_collections().collections]
        if COLLECTION_NAME not in collections:
            client.create_collection(
                collection_name=COLLECTION_NAME,
                vectors_config=models.VectorParams(
                    size=dim,
                    distance=models.Distance.COSINE,
                ),
            )
            print(f"[qdrant] Created collection '{COLLECTION_NAME}' (dim={dim})")

            # Create payload indexes for efficient RAG filtering
            for field, schema_type in [
                ("source_type", models.PayloadSchemaType.KEYWORD),
                ("municipality_id", models.PayloadSchemaType.INTEGER),
                ("category", models.PayloadSchemaType.KEYWORD),
                ("tier", models.PayloadSchemaType.KEYWORD),
                ("status", models.PayloadSchemaType.KEYWORD),
                ("wiki_path", models.PayloadSchemaType.KEYWORD),
                ("node_id", models.PayloadSchemaType.INTEGER),
            ]:
                try:
                    client.create_payload_index(
                        collection_name=COLLECTION_NAME,
                        field_name=field,
                        field_schema=schema_type,
                    )
                except Exception:
                    pass
        return True
    except Exception as e:
        print(f"[qdrant] Error initializing collection '{COLLECTION_NAME}': {e}")
        return False


def _deterministic_uuid(key: str) -> str:
    """Generate a deterministic UUID string from a unique string key."""
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, f"area-intel:{key}"))


def upsert_knowledge_node(
    node_id: int,
    title: str,
    body: str,
    municipality_id: int,
    category: str,
    tier: str,
    status: str = "VERIFIED",
    as_of: Any = None,
    source_url: str = "",
    client: QdrantClient | None = None,
) -> bool:
    """Upsert a Supabase KnowledgeNode into Qdrant."""
    client = client or get_qdrant_client()
    if not client:
        return False

    text_content = f"{title}\n\n{body}"
    vectors = generate_embeddings([text_content])
    if not vectors:
        return False

    point_id = _deterministic_uuid(f"node:{node_id}")
    payload = {
        "source_type": "node",
        "node_id": node_id,
        "title": title,
        "body": body,
        "text": text_content,
        "municipality_id": municipality_id,
        "category": category,
        "tier": tier,
        "status": status,
        "as_of": str(as_of) if as_of else None,
        "source_url": source_url or "",
    }

    try:
        client.upsert(
            collection_name=COLLECTION_NAME,
            points=[
                models.PointStruct(
                    id=point_id,
                    vector=vectors[0],
                    payload=payload,
                )
            ],
        )
        return True
    except Exception as e:
        print(f"[qdrant] Error upserting node #{node_id}: {e}")
        return False


def upsert_wiki_article(
    path: str,
    title: str,
    body: str,
    tags: list[str] | None = None,
    verified: bool = False,
    doc_type: str | None = None,
    client: QdrantClient | None = None,
) -> bool:
    """Upsert a wiki article into Qdrant."""
    client = client or get_qdrant_client()
    if not client:
        return False

    text_content = f"{title}\n\n{body}"
    vectors = generate_embeddings([text_content])
    if not vectors:
        return False

    point_id = _deterministic_uuid(f"wiki:{path}")
    payload = {
        "source_type": "wiki",
        "wiki_path": path,
        "title": title,
        "body": body,
        "text": text_content,
        "tags": tags or [],
        "verified": bool(verified),
        "doc_type": doc_type or "",
    }

    try:
        client.upsert(
            collection_name=COLLECTION_NAME,
            points=[
                models.PointStruct(
                    id=point_id,
                    vector=vectors[0],
                    payload=payload,
                )
            ],
        )
        return True
    except Exception as e:
        print(f"[qdrant] Error upserting wiki article '{path}': {e}")
        return False


def search_vectors(
    query: str, 
    k: int = 5,
    municipality_id: int | None = None,
    category: str | None = None,
    source_type: str | None = None,
    client: QdrantClient | None = None,
) -> list[dict[str, Any]]:
    """Search Qdrant vector collection for query matches with optional metadata filters."""
    client = client or get_qdrant_client()
    if not client:
        return []

    vectors = generate_embeddings([query])
    if not vectors:
        return []

    filter_conditions = []
    if municipality_id is not None:
        filter_conditions.append(
            models.FieldCondition(
                key="municipality_id",
                match=models.MatchValue(value=municipality_id),
            )
        )
    if category is not None:
        filter_conditions.append(
            models.FieldCondition(
                key="category",
                match=models.MatchValue(value=category),
            )
        )
    if source_type is not None:
        filter_conditions.append(
            models.FieldCondition(
                key="source_type",
                match=models.MatchValue(value=source_type),
            )
        )

    qdrant_filter = (
        models.Filter(must=filter_conditions) if filter_conditions else None
    )

    try:
        search_results = []
        if hasattr(client, "query_points"):
            res = client.query_points(
                collection_name=COLLECTION_NAME,
                query=vectors[0],
                query_filter=qdrant_filter,
                limit=k,
            )
            search_results = getattr(res, "points", [])
        elif hasattr(client, "search"):
            search_results = client.search(
                collection_name=COLLECTION_NAME,
                query_vector=vectors[0],
                query_filter=qdrant_filter,
                limit=k,
            )
        results = []
        for res in search_results:
            payload = getattr(res, "payload", {}) or {}
            score = getattr(res, "score", 0.0)
            results.append({
                "score": float(score),
                "title": payload.get("title", ""),
                "body": payload.get("body", ""),
                "text": payload.get("text", ""),
                "source_type": payload.get("source_type", ""),
                "wiki_path": payload.get("wiki_path"),
                "node_id": payload.get("node_id"),
                "category": payload.get("category"),
                "municipality_id": payload.get("municipality_id"),
                "tier": payload.get("tier"),
                "verified": payload.get("verified", False),
                "payload": payload,
            })
        return results
    except Exception as e:
        print(f"[qdrant] Search error: {e}")
        return []
