import { QdrantClient } from "@qdrant/js-client-rest";

const url = process.env.QDRANT_URL || "http://localhost:6333";
const apiKey = process.env.QDRANT_API_KEY;

export const qdrantClient =
  url ? new QdrantClient({ url, apiKey: apiKey || undefined }) : null;

export const COLLECTION_NAME = process.env.QDRANT_COLLECTION || "knowledge_base";

/**
 * Perform vector search on Qdrant knowledge base from Next.js server components or API routes.
 * @param {number[]} vector - Embedding vector for query
 * @param {object} options - Search options (limit, filter, etc.)
 */
export async function searchKnowledgeBase(vector, { limit = 5, filter } = {}) {
  if (!qdrantClient) return [];
  try {
    const results = await qdrantClient.search(COLLECTION_NAME, {
      vector,
      limit,
      filter,
    });
    return results;
  } catch (error) {
    console.error("[qdrant-js] Search error:", error);
    return [];
  }
}
