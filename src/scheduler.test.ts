import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Scheduler } from "./scheduler";
import type { ResolvedGrid } from "./types";

function makeGrid(pools: string[][]): ResolvedGrid {
  return {
    words: pools.map((pool, i) => ({
      index: i,
      blank: false,
      pool,
      count: 0,
    })),
    candidates: pools,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Scheduler", () => {
  it("calls onWord for each slot when ticking through the grid", () => {
    const seen: string[] = [];
    const scheduler = new Scheduler({ onWord: (w) => seen.push(w) });
    const grid = makeGrid([["hello"], ["world"]]);
    scheduler.setGrid(grid);
    scheduler.start();

    vi.advanceTimersByTime(1300); // 2 ticks at 600 ms
    scheduler.stop();

    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe("hello");
    expect(seen[1]).toBe("world");
  });

  it("loops back to the first slot after the last slot", () => {
    const seen: string[] = [];
    const scheduler = new Scheduler({ onWord: (w) => seen.push(w) });
    const grid = makeGrid([["hello"], ["world"]]);
    scheduler.setGrid(grid);
    scheduler.start();

    vi.advanceTimersByTime(2500); // 4 ticks → hello, world, hello, world
    scheduler.stop();

    expect(seen).toHaveLength(4);
    expect(seen).toEqual(["hello", "world", "hello", "world"]);
  });

  it("does not fire after stop()", () => {
    const seen: string[] = [];
    const scheduler = new Scheduler({ onWord: (w) => seen.push(w) });
    const grid = makeGrid([["hello"]]);
    scheduler.setGrid(grid);
    scheduler.start();

    vi.advanceTimersByTime(600); // 1 tick
    scheduler.stop();
    vi.advanceTimersByTime(3000); // no more ticks expected

    expect(seen).toHaveLength(1);
  });

  it("keeps ticking when grid is empty (no words emitted)", () => {
    const seen: string[] = [];
    const scheduler = new Scheduler({ onWord: (w) => seen.push(w) });
    scheduler.setGrid({ words: [], candidates: [] });
    scheduler.start();
    vi.advanceTimersByTime(3000);
    // Still running — no words emitted but loop didn't die
    expect(seen).toHaveLength(0);

    // Providing a grid mid-run now produces words
    scheduler.setGrid(makeGrid([["hello"]]));
    vi.advanceTimersByTime(600);
    scheduler.stop();
    expect(seen).toEqual(["hello"]);
  });

  it("applies a new grid immediately during playback", () => {
    const seen: string[] = [];
    const scheduler = new Scheduler({ onWord: (w) => seen.push(w) });
    const grid1 = makeGrid([["first"], ["second"]]);
    scheduler.setGrid(grid1);
    scheduler.start();

    vi.advanceTimersByTime(600); // plays "first" (cursor → 1)

    // Swap in a new grid while running — applied immediately
    const grid2 = makeGrid([["alpha"], ["beta"]]);
    scheduler.setGrid(grid2);

    // Cursor was at 1, so next tick plays slot 1 of the new grid ("beta")
    vi.advanceTimersByTime(600);
    scheduler.stop();

    expect(seen[0]).toBe("first");
    expect(seen[1]).toBe("beta");
  });

  it("start() is idempotent — calling twice does not double-fire", () => {
    const seen: string[] = [];
    const scheduler = new Scheduler({ onWord: (w) => seen.push(w) });
    scheduler.setGrid(makeGrid([["x"]]));
    scheduler.start();
    scheduler.start(); // second call should be no-op

    vi.advanceTimersByTime(600);
    scheduler.stop();

    expect(seen).toHaveLength(1);
  });

  it("provides word index to the callback", () => {
    const indices: number[] = [];
    const scheduler = new Scheduler({ onWord: (_w, idx) => indices.push(idx) });
    scheduler.setGrid(makeGrid([["a"], ["b"], ["c"]]));
    scheduler.start();

    vi.advanceTimersByTime(1900); // 3 ticks
    scheduler.stop();

    expect(indices).toEqual([0, 1, 2]);
  });

  it("uses same delay for blank words as regular words", () => {
    const seen: Array<{ word: string; time: number }> = [];
    let elapsed = 0;
    const scheduler = new Scheduler({
      onWord: (w) => seen.push({ word: w, time: elapsed }),
    });

    // Create a grid with a blank row in the middle
    const grid: ResolvedGrid = {
      words: [
        { index: 0, blank: false, pool: ["hello"], count: 1 },
        { index: 1, blank: true, pool: [], count: 0 },
        { index: 2, blank: false, pool: ["world"], count: 1 },
      ],
      candidates: [["hello"], [], ["world"]],
    };
    scheduler.setGrid(grid);
    scheduler.start();

    // First tick at 600ms: "hello"
    vi.advanceTimersByTime(600);
    elapsed = 600;

    // Blank tick at 600 + 600 (same WPM-based timing)
    vi.advanceTimersByTime(600);
    elapsed += 600;

    // Third tick at 600 + 600 + 600: "world"
    vi.advanceTimersByTime(600);
    elapsed += 600;

    scheduler.stop();

    expect(seen).toHaveLength(3);
    expect(seen[0].word).toBe("hello");
    expect(seen[1].word).toBe(""); // blank
    expect(seen[2].word).toBe("world");
  });

  it("combines consecutive blanks into a single tick (onBlankGroup)", () => {
    const words: string[] = [];
    const blankGroups: number[][] = [];
    const scheduler = new Scheduler({
      onWord: (w) => words.push(w),
      onBlankGroup: (indices) => blankGroups.push(indices),
    });

    const grid: ResolvedGrid = {
      words: [
        { index: 0, blank: false, pool: ["hello"], count: 1 },
        { index: 1, blank: true, pool: [], count: 0 },
        { index: 2, blank: true, pool: [], count: 0 },
        { index: 3, blank: true, pool: [], count: 0 },
        { index: 4, blank: false, pool: ["world"], count: 1 },
      ],
      candidates: [["hello"], [], [], [], ["world"]],
    };
    scheduler.setGrid(grid);
    scheduler.start();

    // Tick 1 (600ms): "hello"
    vi.advanceTimersByTime(600);
    // Tick 2 (1200ms): blank group [1,2,3] — all 3 consumed in one beat
    vi.advanceTimersByTime(600);
    // Tick 3 (1800ms): "world"
    vi.advanceTimersByTime(600);

    scheduler.stop();

    expect(words).toEqual(["hello", "world"]);
    expect(blankGroups).toHaveLength(1);
    expect(blankGroups[0]).toEqual([1, 2, 3]);
  });

  it("groups consecutive blanks without onBlankGroup — falls back to onWord", () => {
    const seen: string[] = [];
    const scheduler = new Scheduler({
      onWord: (w) => seen.push(w),
    });

    const grid: ResolvedGrid = {
      words: [
        { index: 0, blank: false, pool: ["hello"], count: 1 },
        { index: 1, blank: true, pool: [], count: 0 },
        { index: 2, blank: true, pool: [], count: 0 },
        { index: 3, blank: false, pool: ["world"], count: 1 },
      ],
      candidates: [["hello"], [], [], ["world"]],
    };
    scheduler.setGrid(grid);
    scheduler.start();

    // Tick 1: "hello", Tick 2: blanks (both consumed in one tick), Tick 3: "world"
    vi.advanceTimersByTime(1800);
    scheduler.stop();

    expect(seen).toEqual(["hello", "", "", "world"]);
  });

  it("single blank still works with onBlankGroup", () => {
    const blankGroups: number[][] = [];
    const scheduler = new Scheduler({
      onWord: vi.fn(),
      onBlankGroup: (indices) => blankGroups.push(indices),
    });

    const grid: ResolvedGrid = {
      words: [
        { index: 0, blank: false, pool: ["a"], count: 1 },
        { index: 1, blank: true, pool: [], count: 0 },
        { index: 2, blank: false, pool: ["b"], count: 1 },
      ],
      candidates: [["a"], [], ["b"]],
    };
    scheduler.setGrid(grid);
    scheduler.start();

    vi.advanceTimersByTime(1800); // 3 ticks
    scheduler.stop();

    expect(blankGroups).toHaveLength(1);
    expect(blankGroups[0]).toEqual([1]);
  });

  it("consecutive blanks at the end are grouped before loop-end", () => {
    const words: string[] = [];
    const blankGroups: number[][] = [];
    let loopEnds = 0;
    const scheduler = new Scheduler({
      onWord: (w) => words.push(w),
      onBlankGroup: (indices) => blankGroups.push(indices),
      onLoopEnd: () => loopEnds++,
    });

    const grid: ResolvedGrid = {
      words: [
        { index: 0, blank: false, pool: ["hello"], count: 1 },
        { index: 1, blank: true, pool: [], count: 0 },
        { index: 2, blank: true, pool: [], count: 0 },
      ],
      candidates: [["hello"], [], []],
    };
    scheduler.setGrid(grid);
    scheduler.start();

    // Tick 1: "hello", Tick 2: blanks [1,2] grouped, Tick 3: loop-end + "hello"
    vi.advanceTimersByTime(1800);
    scheduler.stop();

    expect(words).toEqual(["hello", "hello"]);
    expect(blankGroups).toEqual([[1, 2]]);
    expect(loopEnds).toBe(1);
  });

  describe("peekNext()", () => {
    it("returns the next word and index", () => {
      const scheduler = new Scheduler({ onWord: vi.fn() });
      scheduler.setGrid(makeGrid([["hello"], ["world"]]));

      const peek = scheduler.peekNext();
      expect(peek).toEqual({ word: "hello", index: 0 });
    });

    it("returns null for empty grid", () => {
      const scheduler = new Scheduler({ onWord: vi.fn() });
      scheduler.setGrid({ words: [], candidates: [] });

      expect(scheduler.peekNext()).toBeNull();
    });

    it("returns null for blank rows", () => {
      const scheduler = new Scheduler({ onWord: vi.fn() });
      const grid: ResolvedGrid = {
        words: [{ index: 0, blank: true, pool: [], count: 0 }],
        candidates: [[]],
      };
      scheduler.setGrid(grid);

      expect(scheduler.peekNext()).toBeNull();
    });

    it("advances with playback", () => {
      const scheduler = new Scheduler({ onWord: vi.fn() });
      scheduler.setGrid(makeGrid([["hello"], ["world"]]));
      scheduler.start();

      // Before first tick: peek should return "hello"
      expect(scheduler.peekNext()?.word).toBe("hello");

      vi.advanceTimersByTime(600); // first tick plays "hello"
      // After first tick: peek should return "world"
      expect(scheduler.peekNext()?.word).toBe("world");

      scheduler.stop();
    });
  });
});
