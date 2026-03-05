import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentConfig, GenerateEdits, GenerationFeedback } from "./agent";
import { Agent, GenerationError, decomposeEdit, gridWordsToLineViews, projectEdits } from "./agent";
import type { GridEdit, GridWord } from "./types";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function makeWord(overrides: Partial<GridWord> = {}): GridWord {
  return { index: 0, blank: false, ...overrides };
}

/** Create a mock generate function that resolves with fixed edits. */
function mockGenerate(edits: GridEdit[]): GenerateEdits {
  return vi.fn<GenerateEdits>().mockResolvedValue(edits);
}

/**
 * Build a minimal AgentConfig with overrides.
 * Field delays default to 0 for deterministic tests.
 */
function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    generate: mockGenerate([{ action: "patch", line: 0, text: "hello" }]),
    getGridWords: () => [],
    getTranscript: () => "",
    onEdit: vi.fn(),
    fieldDelayMinMs: 0,
    fieldDelayMaxMs: 0,
    ...overrides,
  };
}

/**
 * With fieldDelay=0, advancing by 500ms (POLL_INTERVAL) triggers the
 * consumer to decompose one queue item and emit all of its field edits
 * (subsequent field edits fire at 0ms delay within the same tick).
 */
const POLL = 200;

/* ------------------------------------------------------------------ */
/*  gridWordsToLineViews                                              */
/* ------------------------------------------------------------------ */

describe("gridWordsToLineViews()", () => {
  it("includes blank words as pauses", () => {
    const words: GridWord[] = [
      makeWord({ index: 0, blank: false, text: "sun" }),
      makeWord({ index: 1, blank: true }),
      makeWord({ index: 2, blank: false, text: "moon" }),
    ];
    const views = gridWordsToLineViews(words);
    expect(views).toHaveLength(3);
    expect(views[0].line).toBe(0);
    expect(views[0].pause).toBe(false);
    expect(views[1].line).toBe(1);
    expect(views[1].pause).toBe(true);
    expect(views[2].line).toBe(2);
    expect(views[2].pause).toBe(false);
  });

  it("maps GridWord fields to line view", () => {
    const words: GridWord[] = [
      makeWord({ index: 3, syllables: "01", rhymeGroup: "A", text: "night", pos: "noun", count: 4 }),
    ];
    const [view] = gridWordsToLineViews(words);
    expect(view).toEqual({
      line: 3,
      pause: false,
      syllables: "01",
      rhymeGroup: "A",
      text: "night",
      pos: "noun",
      count: 4,
    });
  });

  it("defaults missing fields to empty string / 0", () => {
    const [view] = gridWordsToLineViews([makeWord({ index: 0 })]);
    expect(view.pause).toBe(false);
    expect(view.syllables).toBe("");
    expect(view.rhymeGroup).toBe("");
    expect(view.text).toBe("");
    expect(view.pos).toBe("");
    expect(view.count).toBe(0);
  });

  it("returns empty array for empty input", () => {
    expect(gridWordsToLineViews([])).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/*  projectEdits                                                      */
/* ------------------------------------------------------------------ */

function makeLine(overrides: Partial<GridLineView> = {}): GridLineView {
  return { line: 0, pause: false, syllables: "", rhymeGroup: "", text: "", pos: "", count: 0, ...overrides };
}

import type { GridLineView } from "./agent";

describe("projectEdits()", () => {
  it("returns a copy when no edits are given", () => {
    const views = [makeLine({ line: 0, text: "sun" })];
    const result = projectEdits(views, []);
    expect(result).toEqual(views);
    expect(result).not.toBe(views); // must be a new array
  });

  it("applies patch edits", () => {
    const views = [makeLine({ line: 0, text: "sun" }), makeLine({ line: 1, text: "moon" })];
    const result = projectEdits(views, [{ action: "patch", line: 1, text: "star" }]);
    expect(result[1].text).toBe("star");
    expect(result[0].text).toBe("sun"); // untouched
  });

  it("applies clear edits", () => {
    const views = [makeLine({ line: 0, text: "sun" }), makeLine({ line: 1, text: "moon" })];
    const result = projectEdits(views, [{ action: "clear", line: 0 }]);
    expect(result[0].pause).toBe(true);
    expect(result[0].text).toBe("");
  });

  it("applies prepend edits with line renumbering", () => {
    const views = [makeLine({ line: 0, text: "sun" }), makeLine({ line: 1, text: "moon" })];
    const result = projectEdits(views, [{ action: "prepend", beforeLine: 0, text: "dawn" }]);
    expect(result).toHaveLength(3);
    expect(result[0].line).toBe(0);
    expect(result[0].text).toBe("dawn");
    expect(result[1].line).toBe(1);
    expect(result[1].text).toBe("sun");
    expect(result[2].line).toBe(2);
    expect(result[2].text).toBe("moon");
  });

  it("applies append edits with line renumbering", () => {
    const views = [makeLine({ line: 0, text: "sun" }), makeLine({ line: 1, text: "moon" })];
    const result = projectEdits(views, [{ action: "append", afterLine: 0, text: "star" }]);
    expect(result).toHaveLength(3);
    expect(result[0].line).toBe(0);
    expect(result[0].text).toBe("sun");
    expect(result[1].line).toBe(1);
    expect(result[1].text).toBe("star");
    expect(result[2].line).toBe(2);
    expect(result[2].text).toBe("moon");
  });

  it("applies pause edits (blank row after)", () => {
    const views = [makeLine({ line: 0, text: "sun" }), makeLine({ line: 1, text: "moon" })];
    const result = projectEdits(views, [{ action: "pause", afterLine: 0 }]);
    expect(result).toHaveLength(3);
    expect(result[1].pause).toBe(true);
    expect(result[1].text).toBe("");
    expect(result[2].line).toBe(2);
  });

  it("applies multiple sequential edits correctly", () => {
    const views = [makeLine({ line: 0, text: "sun" }), makeLine({ line: 1, text: "moon" })];
    const edits: GridEdit[] = [
      { action: "append", afterLine: 1, text: "star" }, // inserts line 2
      { action: "patch", line: 2, rhymeGroup: "A" }, // patches the new line
    ];
    const result = projectEdits(views, edits);
    expect(result).toHaveLength(3);
    expect(result[2].text).toBe("star");
    expect(result[2].rhymeGroup).toBe("A");
  });

  it("does not mutate the input array", () => {
    const views = [makeLine({ line: 0, text: "sun" })];
    const copy = JSON.parse(JSON.stringify(views));
    projectEdits(views, [{ action: "patch", line: 0, text: "moon" }]);
    expect(views).toEqual(copy);
  });
});

/* ------------------------------------------------------------------ */
/*  decomposeEdit                                                     */
/* ------------------------------------------------------------------ */

describe("decomposeEdit()", () => {
  it("returns clear as-is", () => {
    const edit: GridEdit = { action: "clear", line: 2 };
    expect(decomposeEdit(edit)).toEqual([edit]);
  });

  it("returns pause as-is", () => {
    const edit: GridEdit = { action: "pause", afterLine: 1 };
    expect(decomposeEdit(edit)).toEqual([edit]);
  });

  it("decomposes patch into one edit per field", () => {
    const edit: GridEdit = { action: "patch", line: 0, syllables: "01", text: "moon", pos: "noun" };
    const result = decomposeEdit(edit);
    expect(result).toEqual([
      { action: "patch", line: 0, syllables: "01" },
      { action: "patch", line: 0, text: "moon" },
      { action: "patch", line: 0, pos: "noun" },
    ]);
  });

  it("decomposes append into insert + per-field patches", () => {
    const edit: GridEdit = { action: "append", afterLine: 2, text: "star", rhymeGroup: "A" };
    const result = decomposeEdit(edit);
    expect(result).toEqual([
      { action: "append", afterLine: 2 },
      { action: "patch", line: 3, rhymeGroup: "A" },
      { action: "patch", line: 3, text: "star" },
    ]);
  });

  it("decomposes prepend into insert + per-field patches", () => {
    const edit: GridEdit = { action: "prepend", beforeLine: 1, text: "dawn" };
    const result = decomposeEdit(edit);
    expect(result).toEqual([
      { action: "prepend", beforeLine: 1 },
      { action: "patch", line: 1, text: "dawn" },
    ]);
  });

  it("returns patch with no fields as-is", () => {
    const edit: GridEdit = { action: "patch", line: 0 };
    expect(decomposeEdit(edit)).toEqual([edit]);
  });

  it("returns append with no fields as-is", () => {
    const edit: GridEdit = { action: "append", afterLine: 0 };
    expect(decomposeEdit(edit)).toEqual([edit]);
  });
});

/* ------------------------------------------------------------------ */
/*  Agent reactive loop                                               */
/* ------------------------------------------------------------------ */

describe("Agent", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls generate immediately on start", async () => {
    const generate = mockGenerate([{ action: "patch", line: 0, text: "a" }]);
    const config = makeConfig({ generate });
    const agent = new Agent(config);

    agent.start();
    // Flush the microtask for the from(Promise) inside exhaustMap
    await vi.advanceTimersByTimeAsync(0);

    expect(generate).toHaveBeenCalledTimes(1);
    agent.destroy();
  });

  it("emits field edits individually after poll interval", async () => {
    const onEdit = vi.fn();
    const edits: GridEdit[] = [
      { action: "patch", line: 0, text: "a" },
      { action: "patch", line: 1, text: "b" },
      { action: "patch", line: 2, text: "c" },
    ];
    const config = makeConfig({ generate: mockGenerate(edits), onEdit });
    const agent = new Agent(config);

    agent.start();
    await vi.advanceTimersByTimeAsync(0); // generate resolves

    expect(onEdit).not.toHaveBeenCalled(); // nothing consumed yet

    // Each single-field edit is consumed at a poll boundary (500ms)
    await vi.advanceTimersByTimeAsync(POLL);
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith({ action: "patch", line: 0, text: "a" });

    await vi.advanceTimersByTimeAsync(POLL);
    expect(onEdit).toHaveBeenCalledTimes(2);
    expect(onEdit).toHaveBeenCalledWith({ action: "patch", line: 1, text: "b" });

    await vi.advanceTimersByTimeAsync(POLL);
    expect(onEdit).toHaveBeenCalledTimes(3);
    expect(onEdit).toHaveBeenCalledWith({ action: "patch", line: 2, text: "c" });

    agent.destroy();
  });

  it("decomposes multi-field edits and emits fields individually", async () => {
    const onEdit = vi.fn();
    // A single edit with 3 fields → 3 micro-edits
    const edits: GridEdit[] = [{ action: "patch", line: 0, syllables: "01", text: "moon", pos: "noun" }];
    // Use 1ms field delay so each field fires on a separate tick
    const config = makeConfig({
      generate: mockGenerate(edits),
      onEdit,
      fieldDelayMinMs: 1,
      fieldDelayMaxMs: 1,
    });
    const agent = new Agent(config);

    agent.start();
    await vi.advanceTimersByTimeAsync(0); // generate resolves

    // First poll decomposes the edit, emitting the first field
    await vi.advanceTimersByTimeAsync(POLL);
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenNthCalledWith(1, { action: "patch", line: 0, syllables: "01" });

    await vi.advanceTimersByTimeAsync(1);
    expect(onEdit).toHaveBeenCalledTimes(2);
    expect(onEdit).toHaveBeenNthCalledWith(2, { action: "patch", line: 0, text: "moon" });

    await vi.advanceTimersByTimeAsync(1);
    expect(onEdit).toHaveBeenCalledTimes(3);
    expect(onEdit).toHaveBeenNthCalledWith(3, { action: "patch", line: 0, pos: "noun" });

    agent.destroy();
  });

  it("stops emitting when stopped", async () => {
    const onEdit = vi.fn();
    const edits: GridEdit[] = [
      { action: "patch", line: 0, text: "a" },
      { action: "patch", line: 1, text: "b" },
    ];
    const config = makeConfig({ generate: mockGenerate(edits), onEdit });
    const agent = new Agent(config);

    agent.start();
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(POLL);
    expect(onEdit).toHaveBeenCalledTimes(1);

    agent.stop();

    await vi.advanceTimersByTimeAsync(POLL);
    expect(onEdit).toHaveBeenCalledTimes(1); // no more edits

    agent.destroy();
  });

  it("clears both queues on stop", async () => {
    const onEdit = vi.fn();
    const edits: GridEdit[] = [
      { action: "patch", line: 0, text: "a" },
      { action: "patch", line: 1, text: "b" },
    ];
    const config = makeConfig({ generate: mockGenerate(edits), onEdit });
    const agent = new Agent(config);

    agent.start();
    await vi.advanceTimersByTimeAsync(0); // queue filled

    agent.stop();
    agent.start();
    // The queues were cleared on stop; generate is called again on restart
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(POLL);
    // Should get the first edit from the fresh generate call
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith({ action: "patch", line: 0, text: "a" });

    agent.destroy();
  });

  it("refills the queue when consumer depletes it below threshold", async () => {
    const generate = vi.fn<GenerateEdits>();
    // First call returns 3 edits (at threshold)
    generate.mockResolvedValueOnce([
      { action: "patch", line: 0, text: "a" },
      { action: "patch", line: 1, text: "b" },
      { action: "patch", line: 2, text: "c" },
    ]);
    // Second call (refill) returns 3 more
    generate.mockResolvedValueOnce([
      { action: "patch", line: 3, text: "d" },
      { action: "patch", line: 4, text: "e" },
      { action: "patch", line: 5, text: "f" },
    ]);
    // Default for any further calls
    generate.mockResolvedValue([]);

    const onEdit = vi.fn();
    const config = makeConfig({ generate, onEdit });
    const agent = new Agent(config);

    agent.start();
    await vi.advanceTimersByTimeAsync(0); // first generate fills queue with 3

    expect(generate).toHaveBeenCalledTimes(1);

    // Pop first edit → queue drops to 2 (< 3) → consumer triggers refill
    await vi.advanceTimersByTimeAsync(POLL);
    expect(onEdit).toHaveBeenCalledTimes(1);

    // Let the refill generate resolve
    await vi.advanceTimersByTimeAsync(0);
    expect(generate).toHaveBeenCalledTimes(2);

    // Queue now has 2 (old) + 3 (refill) = 5. Consume all remaining.
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(POLL);
      await vi.advanceTimersByTimeAsync(0); // flush any refill
    }
    expect(onEdit).toHaveBeenCalledTimes(6); // 1 before refill + 5 after

    agent.destroy();
  });

  it("does not call generate concurrently (exhaustMap)", async () => {
    let resolveFirst!: (v: GridEdit[]) => void;
    const firstCall = new Promise<GridEdit[]>((r) => {
      resolveFirst = r;
    });

    const generate = vi.fn<GenerateEdits>();
    generate.mockReturnValueOnce(firstCall);
    generate.mockResolvedValue([{ action: "patch", line: 0, text: "later" }]);

    const onEdit = vi.fn();
    const config = makeConfig({ generate, onEdit });
    const agent = new Agent(config);

    agent.start();
    await vi.advanceTimersByTimeAsync(0);

    // First call is still pending
    expect(generate).toHaveBeenCalledTimes(1);

    // Resolve with 3 edits (at threshold, no immediate refill)
    resolveFirst([
      { action: "patch", line: 0, text: "a" },
      { action: "patch", line: 1, text: "b" },
      { action: "patch", line: 2, text: "c" },
    ]);
    await vi.advanceTimersByTimeAsync(0);

    // Still only 1 call – no refill yet (queue at threshold)
    expect(generate).toHaveBeenCalledTimes(1);

    // Consumer pops one → queue drops below threshold → refill triggered
    await vi.advanceTimersByTimeAsync(POLL);
    await vi.advanceTimersByTimeAsync(0); // let refill resolve
    expect(generate).toHaveBeenCalledTimes(2);

    agent.destroy();
  });

  it("handles generate errors gracefully", async () => {
    const generate = vi.fn<GenerateEdits>();
    generate.mockRejectedValueOnce(new Error("API error"));
    generate.mockResolvedValueOnce([{ action: "patch", line: 0, text: "recovered" }]);

    const onEdit = vi.fn();
    const config = makeConfig({ generate, onEdit });
    const agent = new Agent(config);

    // Suppress expected console.error
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    agent.start();
    await vi.advanceTimersByTimeAsync(0); // first call fails

    expect(spy).toHaveBeenCalledWith("Agent LLM error:", expect.any(Error));

    // No edits in queue, so consumer won't fire yet
    await vi.advanceTimersByTimeAsync(POLL);
    expect(onEdit).not.toHaveBeenCalled();

    spy.mockRestore();
    agent.destroy();
  });

  it("passes feedback from GenerationError to the next generate call", async () => {
    const generate = vi.fn<GenerateEdits>();
    const genError = new GenerationError("bad json", '{"invalid": true}');
    generate.mockRejectedValueOnce(genError);
    generate.mockResolvedValueOnce([{ action: "patch", line: 0, text: "ok" }]);

    const config = makeConfig({ generate });
    const agent = new Agent(config);

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    agent.start();
    await vi.advanceTimersByTimeAsync(0); // first call fails

    // Error handler schedules a retry after POLL_INTERVAL (500ms)
    await vi.advanceTimersByTimeAsync(POLL);
    await vi.advanceTimersByTimeAsync(0); // let second generate resolve

    expect(generate).toHaveBeenCalledTimes(2);
    const secondCallFeedback = generate.mock.calls[1][2] as GenerationFeedback;
    expect(secondCallFeedback).toEqual({
      rawOutput: '{"invalid": true}',
      error: "bad json",
    });

    spy.mockRestore();
    agent.destroy();
  });

  it("passes feedback from plain errors to the next generate call", async () => {
    const generate = vi.fn<GenerateEdits>();
    generate.mockRejectedValueOnce(new Error("network timeout"));
    generate.mockResolvedValueOnce([{ action: "patch", line: 0, text: "ok" }]);

    const config = makeConfig({ generate });
    const agent = new Agent(config);

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    agent.start();
    await vi.advanceTimersByTimeAsync(0); // first call fails

    // Error handler schedules a retry after POLL_INTERVAL (500ms)
    await vi.advanceTimersByTimeAsync(POLL);
    await vi.advanceTimersByTimeAsync(0);

    expect(generate).toHaveBeenCalledTimes(2);
    const feedback = generate.mock.calls[1][2] as GenerationFeedback;
    expect(feedback).toEqual({
      rawOutput: "",
      error: "network timeout",
    });

    spy.mockRestore();
    agent.destroy();
  });

  it("clears feedback after successful generation", async () => {
    const generate = vi.fn<GenerateEdits>();
    generate.mockRejectedValueOnce(new GenerationError("bad", "raw"));
    generate.mockResolvedValueOnce([{ action: "patch", line: 0, text: "ok" }]);
    generate.mockResolvedValueOnce([{ action: "patch", line: 1, text: "more" }]);

    const config = makeConfig({ generate });
    const agent = new Agent(config);

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    agent.start();
    await vi.advanceTimersByTimeAsync(0); // first call fails

    // Error handler schedules retry after POLL_INTERVAL
    await vi.advanceTimersByTimeAsync(POLL);
    await vi.advanceTimersByTimeAsync(0);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1][2]).toBeTruthy(); // had feedback

    // Consumer pops the edit → refill triggers third call (no feedback)
    await vi.advanceTimersByTimeAsync(POLL);
    await vi.advanceTimersByTimeAsync(0);
    expect(generate).toHaveBeenCalledTimes(3);
    expect(generate.mock.calls[2][2]).toBeNull();

    spy.mockRestore();
    agent.destroy();
  });

  it("tracks isActive correctly", () => {
    const agent = new Agent(makeConfig());

    expect(agent.isActive).toBe(false);
    agent.start();
    expect(agent.isActive).toBe(true);
    agent.stop();
    expect(agent.isActive).toBe(false);

    agent.destroy();
  });

  it("passes current grid words and transcript to generate", async () => {
    const words: GridWord[] = [makeWord({ index: 0, text: "sun" })];
    const generate = mockGenerate([{ action: "patch", line: 0, text: "moon" }]);
    const config = makeConfig({
      generate,
      getGridWords: () => words,
      getTranscript: () => "hello world",
    });
    const agent = new Agent(config);

    agent.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(generate).toHaveBeenCalledWith(
      [{ line: 0, pause: false, syllables: "", rhymeGroup: "", text: "sun", pos: "", count: 0 }],
      "hello world",
      null, // no feedback on first call
    );

    agent.destroy();
  });

  it("can restart after destroy by creating a new instance", async () => {
    const onEdit = vi.fn();
    const config = makeConfig({ onEdit });

    const agent1 = new Agent(config);
    agent1.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(POLL);
    expect(onEdit).toHaveBeenCalledTimes(1);
    agent1.destroy();

    // New instance works independently
    const agent2 = new Agent(config);
    agent2.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(POLL);
    expect(onEdit).toHaveBeenCalledTimes(2);
    agent2.destroy();
  });
});
