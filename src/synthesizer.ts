import { generateBuffer, playBufferPitched } from "./voice";

export type SynthStatus = "pending" | "synthesizing" | "ready";

export interface SynthStatusEntry {
  slotIndex: number;
  status: SynthStatus;
}

export interface SynthesizerCallbacks {
  onStatusChange(statuses: SynthStatusEntry[]): void;
}

/**
 * Asynchronous sound synthesis system, decoupled from resolver and scheduler.
 *
 * Synthesizes words one-by-one using meSpeak.js, caches results in a map to
 * avoid duplicate computation, and reports per-line synthesis status.
 */
export class Synthesizer {
  /** word → audio buffer cache (shared across grids). */
  private cache = new Map<string, ArrayBuffer>();
  /** Words currently being synthesized → waiting resolvers. */
  private inflightWaiters = new Map<string, Array<() => void>>();
  /** Per-slot: total candidate count and how many are cached. */
  private slotProgress = new Map<number, { total: number; cached: number }>();
  /** Abort controller for the current synthesis run. */
  private abortController: AbortController | null = null;
  private callbacks: SynthesizerCallbacks;
  /** Serialised snapshot of the last emitted statuses for deduplication. */
  private lastEmittedKey = "";

  constructor(callbacks: SynthesizerCallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * Start synthesizing all candidate words for a resolved grid.
   * Cancels any previous in-progress synthesis run.
   */
  async synthesizeGrid(candidates: string[][], slotIndices: number[]): Promise<void> {
    // Cancel any previous run
    this.abortController?.abort();
    const controller = new AbortController();
    this.abortController = controller;

    // Build per-slot progress tracking
    this.slotProgress.clear();
    for (let i = 0; i < candidates.length; i++) {
      const words = candidates[i];
      if (words.length === 0) continue;
      const cachedCount = words.filter((w) => this.cache.has(w)).length;
      this.slotProgress.set(slotIndices[i], { total: words.length, cached: cachedCount });
    }
    this.emitStatus();

    // Synthesize word by word across all slots
    for (let i = 0; i < candidates.length; i++) {
      if (controller.signal.aborted) return;
      const words = candidates[i];
      const slotIndex = slotIndices[i];

      for (const word of words) {
        if (controller.signal.aborted) return;
        await this.ensureSynthesized(word);

        // Update slot progress
        const progress = this.slotProgress.get(slotIndex);
        if (progress) {
          progress.cached = words.filter((w) => this.cache.has(w)).length;
          this.emitStatus();
        }
      }
    }
  }

  /**
   * Ensure a single word is synthesized and cached.
   * Returns immediately if already cached.
   */
  async ensureSynthesized(word: string): Promise<void> {
    if (this.cache.has(word)) return;

    // If already in-flight, wait for it to complete via notification
    const waiters = this.inflightWaiters.get(word);
    if (waiters) {
      return new Promise<void>((resolve) => {
        waiters.push(resolve);
      });
    }

    this.inflightWaiters.set(word, []);
    try {
      const buffer = await generateBuffer(word);
      if (buffer) {
        this.cache.set(word, buffer);
      }
    } finally {
      // Notify all waiters and clean up
      const pending = this.inflightWaiters.get(word);
      this.inflightWaiters.delete(word);
      if (pending) {
        for (const resolve of pending) resolve();
      }
    }
  }

  /** Play a word from the cache.
   *  @param playbackRate  Pitch multiplier (1.0 = original).
   *  @returns true if the word was cached and played. */
  playWord(word: string, playbackRate = 1.0): boolean {
    const buffer = this.cache.get(word);
    if (buffer) {
      playBufferPitched(buffer, playbackRate);
      return true;
    }
    return false;
  }

  /** Check if a word is already cached. */
  isCached(word: string): boolean {
    return this.cache.has(word);
  }

  /** Get the current per-slot synthesis status. */
  getStatuses(): SynthStatusEntry[] {
    const entries: SynthStatusEntry[] = [];
    for (const [slotIndex, progress] of this.slotProgress) {
      let status: SynthStatus;
      if (progress.cached >= progress.total) {
        status = "ready";
      } else if (progress.cached > 0 || this.inflightWaiters.size > 0) {
        status = "synthesizing";
      } else {
        status = "pending";
      }
      entries.push({ slotIndex, status });
    }
    return entries;
  }

  /** Stop any in-progress synthesis. */
  cancel(): void {
    this.abortController?.abort();
  }

  /** Clear the cache and reset state. */
  reset(): void {
    this.cancel();
    this.slotProgress.clear();
    this.emitStatus();
  }

  private emitStatus(): void {
    const statuses = this.getStatuses();
    const key = JSON.stringify(statuses);
    if (key === this.lastEmittedKey) return;
    this.lastEmittedKey = key;
    this.callbacks.onStatusChange(statuses);
  }
}
