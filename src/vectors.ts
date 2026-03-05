import { GoogleGenAI } from "@google/genai";
import { DB } from "eigen-db";
import embeddingsUrl from "./data/embeddings.bin?url";
import { getAllWords } from "./dictionary";

let db: Awaited<ReturnType<typeof DB.open>> | null = null;
let aiClient: GoogleGenAI | null = null;

/** Update the Gemini API key used for on-the-fly embedding fallback. */
export function setGeminiApiKey(key: string | undefined): void {
  aiClient = key ? new GoogleGenAI({ apiKey: key }) : null;
}

export async function initVectors(): Promise<void> {
  try {
    db = await DB.open({ dimensions: 768, normalize: true });
    const response = await fetch(embeddingsUrl);
    if (response.body) {
      await db.import(response.body);
    }
    console.log("vectors ready");
  } catch (e) {
    console.warn("Failed to load vector database:", e);
  }
}

/**
 * Fetch a 768-dimension embedding vector from the Gemini API for the given
 * text and cache it in the eigen-db so subsequent lookups are instant.
 * Returns null if no API client is configured or the request fails.
 */
async function fetchAndCacheEmbedding(text: string): Promise<number[] | null> {
  if (!aiClient || !db) return null;
  try {
    const response = await aiClient.models.embedContent({
      model: "gemini-embedding-001",
      contents: [text],
      config: {
        taskType: "SEMANTIC_SIMILARITY",
        outputDimensionality: 768,
      },
    });
    const vector = response.embeddings?.[0]?.values;
    if (!vector || vector.length === 0) return null;
    db.setMany([[text, vector]]);
    return vector;
  } catch (e) {
    console.warn("Failed to fetch embedding for", text, e);
    return null;
  }
}

/** Extra factor to compensate for POS-based duplicates in the raw results. */
const DEDUP_BUFFER_FACTOR = 2;

/** Strip the POS annotation from a DB key, e.g. "nature (noun)" → "nature". */
const removeParentheses = (s: string) => s.replace(/\s*\(.*?\)\s*/g, "").trim();

/**
 * Find words semantically similar to `query`.
 *
 * Lookup strategy (in order):
 * 1. Check the pre-built eigen-db for a vector matching any POS-annotated form
 *    of the query (e.g. "nature (noun)").
 * 2. If not found and a Gemini API key is configured, fetch a 768-dimension
 *    embedding for the bare word on the fly, cache it in eigen-db, and use it
 *    to query. The bare word is used so the cached entry is consistent with the
 *    multi-POS fallback strategy of step 1.
 * 3. Fall back to the first `limit` words from the dictionary.
 *
 * When `pos` is provided the POS-specific key is tried first, improving
 * precision by anchoring the search to the correct word sense.
 *
 * @param query  Free-text semantic query (e.g. "nature", "fast movement").
 * @param limit  Maximum number of results to return.
 * @param pos    Optional part-of-speech hint (e.g. "noun", "verb").
 */
export async function findSimilar(query: string, limit: number, pos?: string): Promise<string[]> {
  const lower = query.toLowerCase().trim();

  // Build candidate keys: prefer POS-specific key when provided.
  const tryKeys: string[] = [];
  if (pos) {
    tryKeys.push(`${lower} (${pos})`);
  }
  tryKeys.push(lower, `${lower} (noun)`, `${lower} (verb)`, `${lower} (adjective)`, `${lower} (adverb)`);

  for (const key of tryKeys) {
    const queryVector = db?.get(key);
    if (queryVector) {
      const results = db!.query(queryVector, { limit: limit * DEDUP_BUFFER_FACTOR, normalize: true });
      const seen = new Set<string>();
      return results.map((r) => removeParentheses(r.key)).filter((text) => !seen.has(text) && seen.add(text));
    }
  }

  // Word not found in the pre-built DB — try fetching its embedding on the fly.
  // Use the bare word so the cached entry is keyed consistently with step 1.
  if (db && aiClient) {
    const fetchedVector = await fetchAndCacheEmbedding(lower);
    if (fetchedVector) {
      const results = db.query(fetchedVector, { limit: limit * DEDUP_BUFFER_FACTOR, normalize: true });
      const seen = new Set<string>();
      return results.map((r) => removeParentheses(r.key)).filter((text) => !seen.has(text) && seen.add(text));
    }
  }

  const words = getAllWords();
  return words.slice(0, limit).map((w) => w.text);
}
