import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock vectors module so tests never hit eigen-db or the binary file.
vi.mock("./vectors", () => ({
  initVectors: vi.fn().mockResolvedValue(undefined),
  setGeminiApiKey: vi.fn(),
  findSimilar: vi.fn().mockResolvedValue([]),
}));

import { resolve } from "./resolver";
import type { GridWord } from "./types";
import { findSimilar } from "./vectors";

function makeWord(overrides: Partial<GridWord> = {}): GridWord {
  return { index: 0, blank: false, ...overrides };
}

beforeEach(() => {
  vi.mocked(findSimilar).mockClear();
  vi.mocked(findSimilar).mockResolvedValue([]);
});

describe("resolve()", () => {
  it("returns empty words for an empty grid", async () => {
    const result = await resolve([]);
    expect(result.words).toHaveLength(0);
  });

  it("includes blank rows as blank entries", async () => {
    const grid: GridWord[] = [makeWord({ index: 0, blank: true }), makeWord({ index: 1, blank: false })];
    const result = await resolve(grid);
    expect(result.words).toHaveLength(2);
    expect(result.words[0].blank).toBe(true);
    expect(result.words[0].index).toBe(0);
    expect(result.words[1].blank).toBe(false);
    expect(result.words[1].index).toBe(1);
  });

  it("preserves index from GridWord", async () => {
    const grid: GridWord[] = [makeWord({ index: 3 }), makeWord({ index: 7 })];
    const result = await resolve(grid);
    expect(result.words[0].index).toBe(3);
    expect(result.words[1].index).toBe(7);
  });

  it("preserves rhymeGroup", async () => {
    const grid: GridWord[] = [makeWord({ rhymeGroup: "A" })];
    const result = await resolve(grid);
    expect(result.words[0].rhymeGroup).toBe("A");
  });

  it("preserves pos", async () => {
    const grid: GridWord[] = [makeWord({ pos: "noun" })];
    const result = await resolve(grid);
    expect(result.words[0].pos).toBe("noun");
  });

  it("leaves pos undefined when not set", async () => {
    const grid: GridWord[] = [makeWord({ pos: undefined })];
    const result = await resolve(grid);
    expect(result.words[0].pos).toBeUndefined();
  });

  it("maps '.' to '*' in syllables pattern", async () => {
    const grid: GridWord[] = [makeWord({ syllables: "01." })];
    const result = await resolve(grid);
    expect(result.words[0].syllables).toBe("01*");
  });

  it("leaves syllables undefined when not set", async () => {
    const grid: GridWord[] = [makeWord({ syllables: undefined })];
    const result = await resolve(grid);
    expect(result.words[0].syllables).toBeUndefined();
  });

  it("calls findSimilar when text is provided", async () => {
    vi.mocked(findSimilar).mockResolvedValue(["river", "forest"]);
    const grid: GridWord[] = [makeWord({ text: "nature" })];
    const result = await resolve(grid);
    expect(findSimilar).toHaveBeenCalledWith("nature", expect.any(Number), undefined);
    expect(result.words[0].pool).toEqual(["river", "forest"]);
  });

  it("uses a searchK much larger than count to ensure enough candidates", async () => {
    const grid: GridWord[] = [makeWord({ text: "nature", count: 4 })];
    await resolve(grid);
    // Called searchK should be at least count * 20
    const [, calledK] = vi.mocked(findSimilar).mock.calls[0];
    expect(calledK).toBeGreaterThanOrEqual(4 * 20);
  });

  it("does not call findSimilar when text is absent", async () => {
    const grid: GridWord[] = [makeWord({ text: undefined })];
    await resolve(grid);
    expect(findSimilar).not.toHaveBeenCalled();
  });

  it("stores empty pool when text is absent", async () => {
    const grid: GridWord[] = [makeWord({ text: undefined })];
    const result = await resolve(grid);
    expect(result.words[0].pool).toEqual([]);
  });

  it("preserves count", async () => {
    const grid: GridWord[] = [makeWord({ count: 8 })];
    const result = await resolve(grid);
    expect(result.words[0].count).toBe(8);
  });

  it("defaults count to 1 when not set", async () => {
    const grid: GridWord[] = [makeWord({ count: undefined })];
    const result = await resolve(grid);
    expect(result.words[0].count).toBe(1);
  });

  it("passes POS to findSimilar when pos is set", async () => {
    vi.mocked(findSimilar).mockResolvedValue(["tree", "river"]);
    const grid: GridWord[] = [makeWord({ text: "nature", pos: "noun" })];
    await resolve(grid);
    expect(findSimilar).toHaveBeenCalledWith("nature", expect.any(Number), "noun");
  });
});
