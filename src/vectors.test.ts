import { DB } from "eigen-db";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── External dependency mocks ─────────────────────────────────────────────────

// Vite asset URL import — just needs to be a non-empty string.
vi.mock("./data/embeddings.bin?url", () => ({ default: "mock-embeddings.bin" }));

// Hoist shared mock objects so they are available inside vi.mock() factories,
// which are moved to the top of the file by vitest's transformer.
const { mockDb, mockEmbedContent } = vi.hoisted(() => {
  const mockDb = {
    get: vi.fn<(key: string) => number[] | undefined>(),
    query: vi.fn<(vec: number[], opts: object) => { key: string }[]>(),
    setMany: vi.fn<(entries: [string, number[]][]) => void>(),
    import: vi.fn<() => Promise<void>>(),
  };
  const mockEmbedContent = vi.fn();
  return { mockDb, mockEmbedContent };
});

// eigen-db
vi.mock("eigen-db", () => ({
  DB: { open: vi.fn() },
}));

// @google/genai — use a real class so `new GoogleGenAI(...)` works in all
// Vitest versions (vi.fn() with arrow-function implementations can't be
// called with `new`).
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { embedContent: mockEmbedContent };
  },
}));

// dictionary: small, deterministic word list.
vi.mock("./dictionary", () => ({
  getAllWords: vi.fn(),
}));

// ── Subject under test ────────────────────────────────────────────────────────

import { getAllWords } from "./dictionary";
import { findSimilar, initVectors, setGeminiApiKey } from "./vectors";

// ── Shared fixtures ───────────────────────────────────────────────────────────

const FAKE_VECTOR = Array<number>(768).fill(0.1);
const DICT_WORDS = [{ text: "apple" }, { text: "banana" }, { text: "cherry" }];

// ── Test setup ────────────────────────────────────────────────────────────────

beforeEach(async () => {
  // Reset ALL mocks (calls + implementations) for a clean slate per test.
  // GoogleGenAI is a real class mock and is unaffected by this reset.
  vi.resetAllMocks();

  // Re-establish implementations that every test depends on.
  vi.mocked(DB.open).mockResolvedValue(mockDb as never);
  vi.mocked(getAllWords).mockReturnValue(DICT_WORDS as never);

  mockDb.get.mockReturnValue(undefined);
  mockDb.query.mockReturnValue([]);
  mockDb.import.mockResolvedValue(undefined);

  // Fetch returns a response with no body so db.import is skipped.
  global.fetch = vi.fn().mockResolvedValue({ body: null });

  // Initialise the module-level `db` reference.
  await initVectors();

  // Start each test without a Gemini key.
  setGeminiApiKey(undefined);
});

// ── setGeminiApiKey() ─────────────────────────────────────────────────────────

describe("setGeminiApiKey()", () => {
  it("enables the Gemini fallback when a key is provided", async () => {
    setGeminiApiKey("test-key");
    mockEmbedContent.mockResolvedValue({ embeddings: [{ values: FAKE_VECTOR }] });
    mockDb.query.mockReturnValue([{ key: "river (noun)" }]);

    const result = await findSimilar("unknown-word", 5);
    expect(mockEmbedContent).toHaveBeenCalled();
    expect(result).toContain("river");
  });

  it("disables the Gemini fallback when the key is cleared", async () => {
    setGeminiApiKey("test-key");
    setGeminiApiKey(undefined);
    await findSimilar("unknown-word", 5);
    expect(mockEmbedContent).not.toHaveBeenCalled();
  });
});

// ── findSimilar() — word found in eigen-db ────────────────────────────────────

describe("findSimilar() — word found in eigen-db", () => {
  it("uses the stored vector to query similar words", async () => {
    mockDb.get.mockImplementation((key) => (key === "nature (noun)" ? FAKE_VECTOR : undefined));
    mockDb.query.mockReturnValue([{ key: "river (noun)" }, { key: "forest (noun)" }]);

    const result = await findSimilar("nature", 5, "noun");
    expect(mockDb.query).toHaveBeenCalledWith(FAKE_VECTOR, expect.objectContaining({ normalize: true }));
    expect(result).toEqual(["river", "forest"]);
  });

  it("normalises the query string to lowercase before looking up", async () => {
    mockDb.get.mockImplementation((key) => (key === "nature" ? FAKE_VECTOR : undefined));
    await findSimilar("NATURE", 5);
    expect(mockDb.get).toHaveBeenCalledWith("nature");
  });

  it("tries the POS-specific key before the bare key when pos is provided", async () => {
    const callOrder: string[] = [];
    mockDb.get.mockImplementation((key) => {
      callOrder.push(key);
      return key === "run (verb)" ? FAKE_VECTOR : undefined;
    });

    await findSimilar("run", 5, "verb");
    expect(callOrder[0]).toBe("run (verb)");
  });

  it("falls back to other POS variants when the POS-specific key is absent", async () => {
    mockDb.get.mockImplementation((key) => (key === "run (verb)" ? FAKE_VECTOR : undefined));
    mockDb.query.mockReturnValue([{ key: "sprint (verb)" }]);

    const result = await findSimilar("run", 5, "verb");
    expect(result).toEqual(["sprint"]);
  });

  it("passes normalize: true to db.query", async () => {
    mockDb.get.mockReturnValue(FAKE_VECTOR);
    await findSimilar("word", 5);
    expect(mockDb.query).toHaveBeenCalledWith(FAKE_VECTOR, expect.objectContaining({ normalize: true }));
  });

  it("deduplicates words that appear under multiple POS keys", async () => {
    mockDb.get.mockImplementation((key) => (key === "light (noun)" ? FAKE_VECTOR : undefined));
    mockDb.query.mockReturnValue([{ key: "glow (noun)" }, { key: "glow (verb)" }, { key: "shine (noun)" }]);

    const result = await findSimilar("light", 10, "noun");
    expect(result).toEqual(["glow", "shine"]);
  });

  it("never calls the Gemini API when a vector is found in the DB", async () => {
    setGeminiApiKey("test-key");
    mockDb.get.mockReturnValue(FAKE_VECTOR);
    await findSimilar("nature", 5);
    expect(mockEmbedContent).not.toHaveBeenCalled();
  });
});

// ── findSimilar() — word missing, Gemini API key set ─────────────────────────

describe("findSimilar() — word missing from DB, Gemini API key set", () => {
  beforeEach(() => {
    setGeminiApiKey("test-key");
    mockEmbedContent.mockResolvedValue({ embeddings: [{ values: FAKE_VECTOR }] });
  });

  it("fetches an embedding from the Gemini API", async () => {
    await findSimilar("novelword", 5);
    expect(mockEmbedContent).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gemini-embedding-001", contents: ["novelword"] }),
    );
  });

  it("requests SEMANTIC_SIMILARITY task type with 768 output dimensions", async () => {
    await findSimilar("novelword", 5);
    expect(mockEmbedContent).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ taskType: "SEMANTIC_SIMILARITY", outputDimensionality: 768 }),
      }),
    );
  });

  it("always fetches the bare word (no POS annotation) to keep the cached key consistent", async () => {
    await findSimilar("run", 5, "verb");
    expect(mockEmbedContent).toHaveBeenCalledWith(expect.objectContaining({ contents: ["run"] }));
  });

  it("caches the fetched embedding in eigen-db", async () => {
    await findSimilar("novelword", 5);
    expect(mockDb.setMany).toHaveBeenCalledWith([["novelword", FAKE_VECTOR]]);
  });

  it("uses the fetched vector to query eigen-db with normalize: true", async () => {
    mockDb.query.mockReturnValue([{ key: "related (noun)" }]);
    await findSimilar("novelword", 5);
    expect(mockDb.query).toHaveBeenCalledWith(FAKE_VECTOR, expect.objectContaining({ normalize: true }));
  });

  it("returns deduplicated word texts from the query results", async () => {
    mockDb.query.mockReturnValue([{ key: "related (noun)" }, { key: "related (verb)" }]);
    const result = await findSimilar("novelword", 5);
    expect(result).toEqual(["related"]);
  });

  it("falls back to dictionary when Gemini returns an empty vector", async () => {
    mockEmbedContent.mockResolvedValue({ embeddings: [{ values: [] }] });
    const result = await findSimilar("novelword", 2);
    expect(result).toEqual(["apple", "banana"]);
  });

  it("falls back to dictionary when the Gemini request throws", async () => {
    mockEmbedContent.mockRejectedValue(new Error("network error"));
    const result = await findSimilar("novelword", 2);
    expect(result).toEqual(["apple", "banana"]);
  });
});

// ── findSimilar() — word missing, no Gemini key ───────────────────────────────

describe("findSimilar() — word missing from DB, no Gemini API key", () => {
  it("returns the first N words from the dictionary", async () => {
    const result = await findSimilar("novelword", 2);
    expect(result).toEqual(["apple", "banana"]);
  });

  it("never calls the Gemini API", async () => {
    await findSimilar("novelword", 5);
    expect(mockEmbedContent).not.toHaveBeenCalled();
  });
});
