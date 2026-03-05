import { describe, expect, it } from "vitest";
import { countCandidates, filterByPos, filterByRhymeRelaxed, filterByStress } from "./sampler";
import type { Word } from "./types";

function makeWord(overrides: Partial<Word>): Word {
  return {
    text: "test",
    pos: "noun",
    definition: "",
    stress: "1",
    syllables: 1,
    rhyme: "EH S T",
    ...overrides,
  };
}

describe("filterByStress()", () => {
  it("returns words matching exact stress pattern", () => {
    const words = [
      makeWord({ text: "hello", stress: "10", syllables: 2 }),
      makeWord({ text: "world", stress: "1", syllables: 1 }),
      makeWord({ text: "goodbye", stress: "01", syllables: 2 }),
    ];
    const result = filterByStress(words, "10");
    expect(result.map((w) => w.text)).toContain("hello");
    expect(result.map((w) => w.text)).not.toContain("world");
    expect(result.map((w) => w.text)).not.toContain("goodbye");
  });

  it("falls back to all candidates when no exact match", () => {
    const words = [makeWord({ text: "cat", stress: "1" }), makeWord({ text: "dog", stress: "1" })];
    const result = filterByStress(words, "010");
    // No match → return original candidates
    expect(result).toEqual(words);
  });

  it("supports wildcard '*' matching any number of syllables", () => {
    const words = [
      makeWord({ text: "a", stress: "0" }), // 1 syllable, unstressed
      makeWord({ text: "cat", stress: "1" }), // 1 syllable, stressed → ends in "1" ✓
      makeWord({ text: "hello", stress: "01" }), // 2 syllables, ends in "1" ✓
      makeWord({ text: "second", stress: "10" }), // 2 syllables, ends in "0" ✗
    ];
    // "*1" → /^[012]*1$/ matches any stress pattern ending in "1"
    const result = filterByStress(words, "*1");
    const stresses = result.map((w) => w.stress);
    expect(stresses.every((s) => s.endsWith("1"))).toBe(true);
    expect(result.map((w) => w.text)).toContain("cat");
    expect(result.map((w) => w.text)).toContain("hello");
    expect(result.map((w) => w.text)).not.toContain("a");
    expect(result.map((w) => w.text)).not.toContain("second");
  });

  it("ignores invalid wildcard patterns containing invalid chars", () => {
    const words = [makeWord({ text: "cat", stress: "1" })];
    // Contains invalid character 'x' — should return original candidates
    const result = filterByStress(words, "x*1");
    expect(result).toEqual(words);
  });
});

describe("filterByRhymeRelaxed()", () => {
  it("returns exact rhyme matches on first try", () => {
    const words = [
      makeWord({ text: "cat", rhyme: "AE T" }),
      makeWord({ text: "bat", rhyme: "AE T" }),
      makeWord({ text: "day", rhyme: "EY" }),
    ];
    const result = filterByRhymeRelaxed(words, "AE T");
    expect(result.map((w) => w.text)).toEqual(["cat", "bat"]);
  });

  it("relaxes by dropping leading phonemes (suffix match)", () => {
    const words = [
      makeWord({ text: "cat", rhyme: "AE T" }),
      makeWord({ text: "boat", rhyme: "OW T" }),
      makeWord({ text: "hot", rhyme: "AA T" }),
    ];
    // Looking for "AO L M OW S T" — no exact match exists,
    // relax to suffix "T" which matches all three
    const result = filterByRhymeRelaxed(words, "AO L M OW S T");
    expect(result.map((w) => w.text)).toEqual(["cat", "boat", "hot"]);
  });

  it("picks the tightest suffix that satisfies minCount", () => {
    const words = [
      makeWord({ text: "most", rhyme: "OW S T" }),
      makeWord({ text: "toast", rhyme: "OW S T" }),
      makeWord({ text: "cat", rhyme: "AE T" }),
    ];
    // Full key "OW S T" has 2 matches — enough for minCount=2
    const result = filterByRhymeRelaxed(words, "OW S T", 2);
    expect(result.map((w) => w.text)).toEqual(["most", "toast"]);
  });

  it("relaxes further when tightest match is below minCount", () => {
    const words = [
      makeWord({ text: "most", rhyme: "OW S T" }),
      makeWord({ text: "cat", rhyme: "AE T" }),
      makeWord({ text: "hot", rhyme: "AA T" }),
    ];
    // Full key "OW S T" matches only 1 — not enough for minCount=3
    // Relax to "S T" (1 match: most), then "T" (3 matches: most, cat, hot)
    const result = filterByRhymeRelaxed(words, "OW S T", 3);
    expect(result.map((w) => w.text)).toEqual(["most", "cat", "hot"]);
  });

  it("returns empty array when no relaxation yields a match", () => {
    const words = [makeWord({ text: "zoo", rhyme: "UW" })];
    const result = filterByRhymeRelaxed(words, "AE T");
    expect(result).toHaveLength(0);
  });
});

describe("filterByPos()", () => {
  it("returns only words matching the given part of speech", () => {
    const words = [
      makeWord({ text: "cat", pos: "noun" }),
      makeWord({ text: "run", pos: "verb" }),
      makeWord({ text: "big", pos: "adjective" }),
    ];
    const result = filterByPos(words, "noun");
    expect(result.map((w) => w.text)).toEqual(["cat"]);
  });

  it("normalizes pos for comparison", () => {
    const words = [makeWord({ text: "cat", pos: "n" }), makeWord({ text: "run", pos: "verb" })];
    const result = filterByPos(words, "noun");
    expect(result.map((w) => w.text)).toEqual(["cat"]);
  });

  it("returns empty array when no words match", () => {
    const words = [makeWord({ text: "cat", pos: "noun" })];
    const result = filterByPos(words, "verb");
    expect(result).toHaveLength(0);
  });
});

describe("countCandidates()", () => {
  it("returns total dictionary size when pool is empty and no constraints", () => {
    const rw = { index: 0, pool: [] as string[], count: 0, blank: false };
    const count = countCandidates(rw);
    // Should return all words in the dictionary, which is > 0
    expect(count).toBeGreaterThan(0);
  });

  it("returns pool-filtered count when pool is non-empty", () => {
    const rw = { index: 0, pool: ["river", "forest", "mountain"], count: 0, blank: false };
    const count = countCandidates(rw);
    // Should return at most the pool size (may be less if some aren't in dict)
    expect(count).toBeLessThanOrEqual(3);
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it("returns zero when pool words do not exist in dictionary (strict, no fallback)", () => {
    const rw = { index: 0, pool: ["xyznonexistent", "abcfake"], count: 0, blank: false };
    const count = countCandidates(rw);
    expect(count).toBe(0);
  });

  it("reduces count when syllable stress constraint is applied", () => {
    const noConstraint = countCandidates({ index: 0, pool: [], count: 0, blank: false });
    const withStress = countCandidates({ index: 0, pool: [], count: 0, blank: false, syllables: "10" });
    expect(withStress).toBeLessThan(noConstraint);
    expect(withStress).toBeGreaterThan(0);
  });

  it("reduces count when POS constraint is applied", () => {
    const noConstraint = countCandidates({ index: 0, pool: [], count: 0, blank: false });
    const withPos = countCandidates({ index: 0, pool: [], count: 0, blank: false, pos: "noun" });
    expect(withPos).toBeLessThan(noConstraint);
    expect(withPos).toBeGreaterThan(0);
  });

  it("is not affected by count value", () => {
    const count0 = countCandidates({ index: 0, pool: [], count: 0, blank: false, syllables: "1" });
    const count8 = countCandidates({ index: 0, pool: [], count: 8, blank: false, syllables: "1" });
    expect(count0).toBe(count8);
  });

  it("combines pool and stress constraints", () => {
    const poolOnly = countCandidates({ index: 0, pool: ["river", "forest", "mountain"], count: 0, blank: false });
    const poolAndStress = countCandidates({
      index: 0,
      pool: ["river", "forest", "mountain"],
      count: 0,
      blank: false,
      syllables: "10",
    });
    expect(poolAndStress).toBeLessThanOrEqual(poolOnly);
  });

  it("returns zero when stress pattern matches nothing (strict, no fallback)", () => {
    const count = countCandidates({ index: 0, pool: [], count: 0, blank: false, syllables: "99999" });
    expect(count).toBe(0);
  });

  it("returns zero when POS matches nothing (strict, no fallback)", () => {
    const count = countCandidates({ index: 0, pool: [], count: 0, blank: false, pos: "nonexistent-pos" });
    expect(count).toBe(0);
  });

  it("reduces count when POS and stress are combined", () => {
    const posOnly = countCandidates({ index: 0, pool: [], count: 0, blank: false, pos: "noun" });
    const posAndStress = countCandidates({ index: 0, pool: [], count: 0, blank: false, pos: "noun", syllables: "10" });
    expect(posAndStress).toBeLessThan(posOnly);
    expect(posAndStress).toBeGreaterThan(0);
  });
});
