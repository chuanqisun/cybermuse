import type { ResolvedGrid } from "./types";

const DEFAULT_WPM = 100;

/** Convert WPM to milliseconds per word. */
function wpmToMs(wpm: number): number {
  return Math.round(60_000 / Math.max(1, wpm));
}

export interface SchedulerCallbacks {
  /** Called each time a word is played; also logged to console. */
  onWord(word: string, wordIndex: number): void;
  /** Called when the cursor wraps back to the start (one full cycle). */
  onLoopEnd?(): void;
}

/**
 * Phase 2 — Scheduler
 *
 * Loops through the resolved grid slots at a fixed BPM interval.
 * At each tick it picks one word from a pre-computed candidate list
 * (built once when the grid is set), cycling deterministically.
 *
 * The grid can be updated mid-play via setGrid(); candidate lists and
 * rhyme groups are rebuilt only when a new grid is applied — never
 * between cycles — so playback is fully deterministic until the user
 * changes a parameter.
 */
export class Scheduler {
  private resolved: ResolvedGrid | null = null;
  /** Pre-computed ordered candidate lists per slot. */
  private slotCandidates: string[][] = [];
  /** Per-slot round-robin cursor. */
  private slotCursors: number[] = [];
  private cursor = 0;
  private running = false;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private callbacks: SchedulerCallbacks;
  private wpm = DEFAULT_WPM;

  constructor(callbacks: SchedulerCallbacks) {
    this.callbacks = callbacks;
  }

  /** Update the playback speed. Takes effect on the next tick. */
  setWpm(wpm: number): void {
    this.wpm = Math.max(1, wpm);
  }

  /** Current step duration in ms (derived from WPM). */
  private get stepMs(): number {
    return wpmToMs(this.wpm);
  }

  /** Provide a new resolved grid. Applied immediately; cursor is clamped to fit. */
  setGrid(resolved: ResolvedGrid): void {
    this.resolved = resolved;
    this.buildCandidates();
    // When not running, reset cursor; when running, clamp to new bounds
    if (!this.running) {
      this.cursor = 0;
    } else if (this.slotCandidates.length > 0 && this.cursor >= this.slotCandidates.length) {
      this.cursor = 0;
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleTick(this.stepMs);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  /**
   * Peek at the word that will be selected on the next tick.
   * Returns null for blank rows, empty candidate lists, or when stopped.
   */
  peekNext(): { word: string; index: number } | null {
    const words = this.resolved?.words ?? [];
    if (words.length === 0) return null;

    let cursor = this.cursor;
    if (cursor >= this.slotCandidates.length) cursor = 0;

    const slot = words[cursor];
    if (!slot || slot.blank) return null;

    const candidates = this.slotCandidates[cursor];
    if (!candidates || candidates.length === 0) return null;

    const slotCursor = this.slotCursors[cursor] ?? 0;
    const word = candidates[slotCursor % candidates.length];
    return { word, index: slot.index };
  }

  /** Apply pre-computed candidate lists from the resolved grid. */
  private buildCandidates(): void {
    const words = this.resolved?.words ?? [];
    this.slotCandidates = this.resolved?.candidates ?? [];
    this.slotCursors = new Array(words.length).fill(0);
  }

  private scheduleTick(delay: number): void {
    this.timerId = setTimeout(() => this.tick(), delay);
  }

  private tick(): void {
    if (!this.running) return;

    // Wrap cursor at cycle boundary
    if (this.slotCandidates.length > 0 && this.cursor >= this.slotCandidates.length) {
      this.callbacks.onLoopEnd?.();
      this.cursor = 0;
    }

    const words = this.resolved?.words ?? [];
    if (words.length === 0) {
      // Empty grid — keep ticking, waiting for content
      this.scheduleTick(this.stepMs);
      return;
    }

    const slot = words[this.cursor];

    // Blank rows are silent rests — highlight but don't sample
    if (slot.blank) {
      this.callbacks.onWord("", slot.index);
      this.cursor++;
      this.scheduleTick(this.stepMs);
      return;
    }

    const candidates = this.slotCandidates[this.cursor];
    if (!candidates || candidates.length === 0) {
      this.callbacks.onWord("", slot.index);
      this.cursor++;
      this.scheduleTick(this.stepMs);
      return;
    }

    // Deterministic round-robin through pre-computed candidates
    const slotCursor = this.slotCursors[this.cursor];
    const word = candidates[slotCursor % candidates.length];
    this.slotCursors[this.cursor] = slotCursor + 1;

    console.log(word);
    this.callbacks.onWord(word, slot.index);

    this.cursor++;
    this.scheduleTick(this.stepMs);
  }
}
