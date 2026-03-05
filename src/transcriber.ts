/**
 * Transcriber — captures the full trace of the generated poem.
 *
 * In addition to words, it records special labels:
 *   [started]  — when playback begins
 *   [stopped]  — when playback stops
 *   [pause]    — one marker per blank word (consecutive blanks are kept separate)
 *
 * Clearing the system should call `reset()` to wipe the transcript.
 * Call `toString()` to retrieve the full transcription as a single string.
 */
export class Transcriber {
  private tokens: string[] = [];

  /** Record the start of a playback session. */
  start(): void {
    this.tokens.push("[started]");
    this.tokens.push("\n");
  }

  /** Record the end of a playback session. */
  stop(): void {
    this.tokens.push("\n[stopped]");
  }

  /**
   * Record a word emitted by the scheduler.
   * Empty / falsy words are recorded as `[pause]`.
   */
  addWord(word: string): void {
    if (!word) {
      this.tokens.push("[pause]");
    } else {
      this.tokens.push(word);
    }
  }

  /** Insert a line break (e.g. at the end of a loop cycle). */
  lineBreak(): void {
    this.tokens.push("\n");
  }

  /** Clear the entire transcript (e.g. when the grid is cleared). */
  reset(): void {
    this.tokens = [];
  }

  /** Return the full transcription as a space-separated string. */
  toString(): string {
    return this.tokens.join(" ");
  }
}
