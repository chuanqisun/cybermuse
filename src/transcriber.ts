/**
 * Transcriber — captures the full trace of the generated poem.
 *
 * In addition to words, it records special labels:
 *   [started]  — when playback begins
 *   [stopped]  — when playback stops
 *   [pause]    — collapses any run of consecutive blank words into one marker
 *
 * Clearing the system should call `reset()` to wipe the transcript.
 * Call `toString()` to retrieve the full transcription as a single string.
 */
export class Transcriber {
  private tokens: string[] = [];
  /** True when the last recorded token was a blank (used to collapse runs). */
  private lastWasBlank = false;

  /** Record the start of a playback session. */
  start(): void {
    this.tokens.push("[started]");
    this.tokens.push("\n");
    this.lastWasBlank = false;
  }

  /** Record the end of a playback session. */
  stop(): void {
    this.tokens.push("\n[stopped]");
    this.lastWasBlank = false;
  }

  /**
   * Record a word emitted by the scheduler.
   * Empty / falsy words are treated as blanks and collapsed into `[pause]`.
   */
  addWord(word: string): void {
    if (!word) {
      // Collapse consecutive blanks into a single [pause]
      if (!this.lastWasBlank) {
        this.tokens.push("[pause]");
        this.lastWasBlank = true;
      }
    } else {
      this.tokens.push(word);
      this.lastWasBlank = false;
    }
  }

  /** Insert a line break (e.g. at the end of a loop cycle). */
  lineBreak(): void {
    this.tokens.push("\n");
    this.lastWasBlank = false;
  }

  /** Clear the entire transcript (e.g. when the grid is cleared). */
  reset(): void {
    this.tokens = [];
    this.lastWasBlank = false;
  }

  /** Return the full transcription as a space-separated string. */
  toString(): string {
    return this.tokens.join(" ");
  }
}
