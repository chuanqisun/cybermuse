import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock vectors module so tests never hit eigen-db or the binary file.
vi.mock("./vectors", () => ({
  initVectors: vi.fn().mockResolvedValue(undefined),
  setGeminiApiKey: vi.fn(),
  findSimilar: vi.fn().mockResolvedValue([]),
}));

import * as dict from "./dictionary";
import { solveConstraints } from "./solver";
import type { ResolvedWord } from "./types";
import { findSimilar } from "./vectors";

function makeSlot(overrides: Partial<ResolvedWord> = {}): ResolvedWord {
  return { index: 0, blank: false, pool: [], count: 0, ...overrides };
}

beforeEach(() => {
  vi.mocked(findSimilar).mockClear();
  vi.mocked(findSimilar).mockResolvedValue([]);
});

describe("solveConstraints()", () => {
  it("returns empty array for blank slots", async () => {
    const result = await solveConstraints([makeSlot({ blank: true })]);
    expect(result).toEqual([[]]);
  });

  it("returns verbatim text when count ≤ 1", async () => {
    const result = await solveConstraints([makeSlot({ text: "nature", count: 1 })]);
    expect(result).toEqual([["nature"]]);
  });

  it("returns verbatim text when count is 0 and text is set", async () => {
    const result = await solveConstraints([makeSlot({ text: "hello", count: 0 })]);
    // count=0 treated as "unconstrained" but text+count≤1 → verbatim
    expect(result[0]).toEqual(["hello"]);
  });

  it("returns exactly count candidates when count > 1", async () => {
    // Use words from the real dictionary
    const allWords = dict.getAllWords();
    const pool = allWords.slice(0, 50).map((w) => w.text);
    const slot = makeSlot({ text: "test", pool, count: 3 });
    const result = await solveConstraints([slot]);
    expect(result[0]).toHaveLength(3);
  });

  it("establishes rhyme from the first slot's text (anchor)", async () => {
    const anchor = dict.findWord("nature");
    if (!anchor) return; // skip if not in dictionary

    // Both slots share rhyme group "A"
    const allWords = dict.getAllWords();
    const pool1 = allWords.slice(0, 100).map((w) => w.text);
    const pool2 = allWords.slice(0, 100).map((w) => w.text);

    const slots: ResolvedWord[] = [
      makeSlot({ index: 0, text: "nature", pool: pool1, count: 2, rhymeGroup: "A" }),
      makeSlot({ index: 1, text: "machine", pool: pool2, count: 2, rhymeGroup: "A", pos: "noun" }),
    ];

    const result = await solveConstraints(slots);

    // Both slots should have exactly 2 candidates
    expect(result[0]).toHaveLength(2);
    expect(result[1]).toHaveLength(2);

    // All candidates in group A should share a rhyme ending
    const rhymeKey = anchor.rhyme;
    for (const list of result) {
      for (const word of list) {
        const w = dict.findWord(word);
        if (w) {
          // At minimum, the last phoneme should match (relaxed rhyme)
          const keyPhonemes = rhymeKey.split(" ");
          const wordPhonemes = w.rhyme.split(" ");
          expect(wordPhonemes[wordPhonemes.length - 1]).toBe(keyPhonemes[keyPhonemes.length - 1]);
        }
      }
    }
  });

  it("expands pool when initial pool is too small to satisfy count", async () => {
    // Set up: initial pool has only 1 matching word, but count=2
    const allWords = dict.getAllWords();
    const tinyPool = allWords.slice(0, 1).map((w) => w.text);

    // Mock findSimilar to return a larger pool on expansion
    const largerPool = allWords.slice(0, 200).map((w) => w.text);
    vi.mocked(findSimilar).mockResolvedValue(largerPool);

    const slot = makeSlot({ text: "test", pool: tinyPool, count: 2 });
    const result = await solveConstraints([slot]);
    expect(result[0]).toHaveLength(2);
    // findSimilar should have been called for pool expansion
    expect(findSimilar).toHaveBeenCalled();
  });

  it("falls back to full dictionary when pool expansion is insufficient", async () => {
    // Mock findSimilar to always return empty (no expansion helps)
    vi.mocked(findSimilar).mockResolvedValue([]);

    const slot = makeSlot({ text: "test", pool: [], count: 3 });
    const result = await solveConstraints([slot]);
    // Should still get exactly 3 candidates from dictionary fallback
    expect(result[0]).toHaveLength(3);
  });

  it("returns deterministic results across multiple calls", async () => {
    const allWords = dict.getAllWords();
    const pool = allWords.slice(0, 50).map((w) => w.text);
    const slot = makeSlot({ text: "test", pool, count: 3 });

    const result1 = await solveConstraints([slot]);
    const result2 = await solveConstraints([slot]);
    expect(result1).toEqual(result2);
  });

  it("handles multiple rhyme groups independently", async () => {
    const allWords = dict.getAllWords();
    const pool = allWords.slice(0, 200).map((w) => w.text);

    const slots: ResolvedWord[] = [
      makeSlot({ index: 0, text: "cat", pool, count: 2, rhymeGroup: "A" }),
      makeSlot({ index: 1, text: "day", pool, count: 2, rhymeGroup: "B" }),
    ];

    const result = await solveConstraints(slots);
    expect(result[0]).toHaveLength(2);
    expect(result[1]).toHaveLength(2);
  });

  it("handles slots without rhyme groups", async () => {
    const allWords = dict.getAllWords();
    const pool = allWords.slice(0, 50).map((w) => w.text);

    const slot = makeSlot({ text: "test", pool, count: 2 });
    const result = await solveConstraints([slot]);
    expect(result[0]).toHaveLength(2);
  });

  it("passes POS to findSimilar during pool expansion", async () => {
    const allWords = dict.getAllWords();
    const tinyPool = allWords.slice(0, 1).map((w) => w.text);
    const largerPool = allWords
      .filter((w) => w.pos === "noun")
      .slice(0, 200)
      .map((w) => w.text);
    vi.mocked(findSimilar).mockResolvedValue(largerPool);

    const slot = makeSlot({ text: "test", pool: tinyPool, count: 2, pos: "noun" });
    const result = await solveConstraints([slot]);
    expect(result[0]).toHaveLength(2);
    // findSimilar should receive the POS hint
    expect(findSimilar).toHaveBeenCalledWith("test", expect.any(Number), "noun");
  });

  it("passes undefined POS to findSimilar when slot has no pos", async () => {
    const allWords = dict.getAllWords();
    const tinyPool = allWords.slice(0, 1).map((w) => w.text);
    vi.mocked(findSimilar).mockResolvedValue(allWords.slice(0, 200).map((w) => w.text));

    const slot = makeSlot({ text: "test", pool: tinyPool, count: 2 });
    await solveConstraints([slot]);
    expect(findSimilar).toHaveBeenCalledWith("test", expect.any(Number), undefined);
  });
});
