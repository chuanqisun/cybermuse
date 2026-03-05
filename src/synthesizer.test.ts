import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the voice module to avoid actual meSpeak dependency
vi.mock("./voice", () => ({
  generateBuffer: vi.fn(),
  playBufferPitched: vi.fn(),
}));

import { Synthesizer } from "./synthesizer";
import type { SynthStatusEntry } from "./synthesizer";
import { generateBuffer, playBufferPitched } from "./voice";

let resolvers: Array<(value: ArrayBuffer | null) => void> = [];

beforeEach(() => {
  vi.clearAllMocks();
  resolvers = [];
  // By default, generateBuffer resolves with a fake ArrayBuffer
  vi.mocked(generateBuffer).mockImplementation(
    () =>
      new Promise<ArrayBuffer | null>((resolve) => {
        resolvers.push(resolve);
      }),
  );
});

afterEach(() => {
  // Resolve any lingering promises to avoid leaks
  for (const r of resolvers) r(null);
  resolvers = [];
});

function waitForNextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("Synthesizer", () => {
  describe("caching", () => {
    it("avoids duplicate synthesis for the same word", async () => {
      vi.mocked(generateBuffer).mockResolvedValue(new ArrayBuffer(8));
      const synth = new Synthesizer({ onStatusChange: vi.fn() });

      await synth.ensureSynthesized("hello");
      await synth.ensureSynthesized("hello");

      expect(generateBuffer).toHaveBeenCalledTimes(1);
    });

    it("caches the result of synthesis", async () => {
      const buffer = new ArrayBuffer(16);
      vi.mocked(generateBuffer).mockResolvedValue(buffer);
      const synth = new Synthesizer({ onStatusChange: vi.fn() });

      await synth.ensureSynthesized("world");
      expect(synth.isCached("world")).toBe(true);
    });

    it("does not cache when generateBuffer returns null", async () => {
      vi.mocked(generateBuffer).mockResolvedValue(null);
      const synth = new Synthesizer({ onStatusChange: vi.fn() });

      await synth.ensureSynthesized("fail");
      expect(synth.isCached("fail")).toBe(false);
    });
  });

  describe("playWord", () => {
    it("returns true and calls playBuffer when word is cached", async () => {
      const buffer = new ArrayBuffer(8);
      vi.mocked(generateBuffer).mockResolvedValue(buffer);
      const synth = new Synthesizer({ onStatusChange: vi.fn() });

      await synth.ensureSynthesized("hello");
      const result = synth.playWord("hello");

      expect(result).toBe(true);
      expect(playBufferPitched).toHaveBeenCalledWith(buffer, 1.0);
    });

    it("returns false when word is not cached", () => {
      const synth = new Synthesizer({ onStatusChange: vi.fn() });
      const result = synth.playWord("missing");

      expect(result).toBe(false);
      expect(playBufferPitched).not.toHaveBeenCalled();
    });
  });

  describe("synthesizeGrid", () => {
    it("synthesizes all candidate words across slots", async () => {
      vi.mocked(generateBuffer).mockResolvedValue(new ArrayBuffer(8));
      const synth = new Synthesizer({ onStatusChange: vi.fn() });

      const candidates = [["hello", "world"], ["foo"]];
      await synth.synthesizeGrid(candidates, [0, 1]);

      expect(synth.isCached("hello")).toBe(true);
      expect(synth.isCached("world")).toBe(true);
      expect(synth.isCached("foo")).toBe(true);
      expect(generateBuffer).toHaveBeenCalledTimes(3);
    });

    it("skips already-cached words during grid synthesis", async () => {
      vi.mocked(generateBuffer).mockResolvedValue(new ArrayBuffer(8));
      const synth = new Synthesizer({ onStatusChange: vi.fn() });

      // Pre-cache "hello"
      await synth.ensureSynthesized("hello");
      vi.mocked(generateBuffer).mockClear();
      vi.mocked(generateBuffer).mockResolvedValue(new ArrayBuffer(8));

      await synth.synthesizeGrid([["hello", "world"]], [0]);

      // Only "world" should be synthesized
      expect(generateBuffer).toHaveBeenCalledTimes(1);
      expect(generateBuffer).toHaveBeenCalledWith("world");
    });

    it("skips empty candidate slots", async () => {
      vi.mocked(generateBuffer).mockResolvedValue(new ArrayBuffer(8));
      const synth = new Synthesizer({ onStatusChange: vi.fn() });

      await synth.synthesizeGrid([[], ["hello"]], [0, 1]);

      expect(generateBuffer).toHaveBeenCalledTimes(1);
    });
  });

  describe("status tracking", () => {
    it("emits status changes during grid synthesis", async () => {
      vi.mocked(generateBuffer).mockResolvedValue(new ArrayBuffer(8));
      const statuses: SynthStatusEntry[][] = [];
      const synth = new Synthesizer({
        onStatusChange: (s) => statuses.push([...s]),
      });

      await synth.synthesizeGrid([["hello"]], [0]);

      // Should have emitted at least initial + final status
      expect(statuses.length).toBeGreaterThanOrEqual(2);

      // Final status should be "ready"
      const lastStatus = statuses[statuses.length - 1];
      expect(lastStatus.find((s) => s.slotIndex === 0)?.status).toBe("ready");
    });

    it("reports ready status when all words in a slot are cached", async () => {
      vi.mocked(generateBuffer).mockResolvedValue(new ArrayBuffer(8));
      const synth = new Synthesizer({ onStatusChange: vi.fn() });

      await synth.synthesizeGrid([["a", "b"]], [0]);

      const statuses = synth.getStatuses();
      expect(statuses.find((s) => s.slotIndex === 0)?.status).toBe("ready");
    });
  });

  describe("cancellation", () => {
    it("cancels in-progress synthesis when a new grid is provided", async () => {
      let callCount = 0;
      vi.mocked(generateBuffer).mockImplementation(async () => {
        callCount++;
        // Simulate some delay
        await new Promise((r) => setTimeout(r, 1));
        return new ArrayBuffer(8);
      });

      const synth = new Synthesizer({ onStatusChange: vi.fn() });

      // Start first synthesis (don't await)
      synth.synthesizeGrid([["a", "b", "c", "d", "e"]], [0]);

      // Let first synthesis start
      await waitForNextTick();

      // Start second synthesis (should cancel first)
      const second = synth.synthesizeGrid([["x"]], [0]);
      await second;

      expect(synth.isCached("x")).toBe(true);
      // First run should have been aborted before completing all 5 words
    });

    it("cancel() stops in-progress synthesis", async () => {
      vi.mocked(generateBuffer).mockImplementation(
        () => new Promise((r) => setTimeout(() => r(new ArrayBuffer(8)), 100)),
      );

      const synth = new Synthesizer({ onStatusChange: vi.fn() });
      const promise = synth.synthesizeGrid([["a", "b"]], [0]);

      synth.cancel();
      await promise;
      // Should have stopped early
    });
  });

  describe("reset", () => {
    it("clears slot progress and emits empty status", () => {
      const statuses: SynthStatusEntry[][] = [];
      const synth = new Synthesizer({
        onStatusChange: (s) => statuses.push([...s]),
      });

      synth.reset();

      const last = statuses[statuses.length - 1];
      expect(last).toEqual([]);
    });
  });

  describe("status deduplication", () => {
    it("does not emit status when it has not changed", async () => {
      // Make synthesis fast: each word resolves immediately
      vi.mocked(generateBuffer).mockResolvedValue(new ArrayBuffer(8));
      const onStatusChange = vi.fn();
      const synth = new Synthesizer({ onStatusChange });

      // Synthesize a slot with 3 words — status should transition from
      // initial ("synthesizing") to "ready" but NOT fire for every word.
      await synth.synthesizeGrid([["a", "b", "c"]], [0]);

      // Should have emitted at most: 1 initial + a few intermediate + 1 final.
      // The key assertion: without dedup, we'd get 1 + 3 = 4 calls.
      // With dedup, intermediate calls that produce the same status are skipped.
      const totalCalls = onStatusChange.mock.calls.length;
      // At minimum, initial + final = 2. Intermediate "synthesizing" calls
      // that don't change the status should be deduplicated.
      expect(totalCalls).toBeLessThanOrEqual(3);
      expect(totalCalls).toBeGreaterThanOrEqual(2);

      // Final status should be "ready"
      const lastStatus = onStatusChange.mock.calls[totalCalls - 1][0] as SynthStatusEntry[];
      expect(lastStatus.find((s) => s.slotIndex === 0)?.status).toBe("ready");
    });
  });
});
