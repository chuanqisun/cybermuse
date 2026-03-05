/**
 * PitchContour — melodic pitch generator for speech synthesis.
 *
 * Produces a sequence of `playbackRate` multipliers that turn flat
 * text-to-speech output into a lyrical, chant-like melodic line.
 *
 * ## Harmonic design
 *
 * The melodic alphabet is a **minor pentatonic scale** — five notes
 * derived from stacked perfect fifths.  The pentatonic is inherently
 * consonant: no semitone clashes, no tritones, every interval resolves
 * pleasantly.  It evokes both Western folk melody and Eastern modal
 * singing, fitting the poetry context.
 *
 * ```
 *   Scale degrees (semitones from root):
 *
 *   Index:  0   1   2   3*  4   5   6   7   8
 *   Semi : -7  -5  -2   0   3   5   7  10  12
 *   Note :  D   E   G   A   C   D   E   G   A
 *           ←  lower  →  root  ←  upper  →
 *
 *   (* = root / tonal center, index 3)
 * ```
 *
 * ## Contour algorithm
 *
 * A weighted random walk with **phrase-level arcs**:
 *
 * 1. **Stepwise bias** (50 %): move one scale degree in the current
 *    direction — the bread-and-butter of any singable melody.
 * 2. **Repetition** (15 %): stay on the same note — speech-like.
 * 3. **Small leap** (15 %): skip one degree — creates gentle surprise.
 * 4. **Contrary step** (10 %): step *against* the phrase direction —
 *    adds ornamental neighbour-note motion.
 * 5. **Big leap** (10 %): skip two degrees — dramatic, used sparingly.
 *
 * After a configurable *phrase length* (3–8 notes), the direction
 * flips, producing natural rise → fall arcs.  Boundary reflection
 * keeps the walk inside the allowed range.
 *
 * ## Energy scaling
 *
 * An external `energy` value (0 → 1) controls the **ambitus** — the
 * span of scale degrees available for the walk:
 *
 * | Energy | Allowed range      | Character              |
 * | ------ | ------------------ | ---------------------- |
 * | 0.0    | root ± 1 degree    | Chant on 3 notes       |
 * | 0.5    | root ± 2–3 degrees | Lyrical folk melody    |
 * | 1.0    | full 9-note scale  | Wide, dramatic contour |
 *
 * ## Pause handling
 *
 * Calling `onPause()` on a blank/rest row gently steers the walk
 * back toward the root — simulating the natural tendency of speech
 * pitch to return to a resting level between phrases.
 */

/** Minor pentatonic spanning ~1.5 octaves, centered on index 3 (root). */
const SCALE = [-7, -5, -2, 0, 3, 5, 7, 10, 12];
const CENTER = 3; // index of 0-semitone root

export class PitchContour {
  private scaleIdx = CENTER;
  /** Current phrase direction: +1 ascending, −1 descending. */
  private direction = 1;
  /** Notes emitted in the current phrase. */
  private phraseStep = 0;
  /** Length of the current phrase before direction flip. */
  private phraseLength: number;
  /** External energy level [0, 1] — widens the available range. */
  private energy = 0;

  constructor() {
    this.phraseLength = _randInt(4, 8);
  }

  /** Set the energy level (0 = minimal motion, 1 = full range). */
  setEnergy(energy: number): void {
    this.energy = Math.max(0, Math.min(1, energy));
  }

  /**
   * Call on a blank row / pause to start a new phrase and nudge
   * the walk back toward the tonal center.
   */
  onPause(): void {
    if (this.scaleIdx > CENTER + 1) this.direction = -1;
    else if (this.scaleIdx < CENTER - 1) this.direction = 1;
    this.phraseStep = 0;
    this.phraseLength = _randInt(3, 7);
  }

  /** Reset to initial state (e.g. on playback stop). */
  reset(): void {
    this.scaleIdx = CENTER;
    this.direction = 1;
    this.phraseStep = 0;
    this.phraseLength = _randInt(4, 8);
    this.energy = 0;
  }

  /**
   * Advance the contour by one note and return the pitch as a
   * Web Audio `playbackRate` multiplier.
   *
   * `1.0` = original pitch, `>1` = higher (and slightly faster),
   * `<1` = lower (and slightly slower).
   */
  next(): number {
    // 1. Compute allowed range from energy
    //    span goes from 1 (3 notes) at energy 0  → 4 (full 9 notes) at energy 1
    const span = 1 + Math.floor(this.energy * 3);
    const lo = Math.max(0, CENTER - span);
    const hi = Math.min(SCALE.length - 1, CENTER + span);

    // 2. Weighted random step selection
    const r = Math.random();
    let step: number;
    if (r < 0.15) {
      step = 0; // repetition
    } else if (r < 0.65) {
      step = this.direction; // stepwise
    } else if (r < 0.8) {
      step = this.direction * 2; // small leap
    } else if (r < 0.9) {
      step = -this.direction; // contrary (ornament / surprise)
    } else {
      step = this.direction * 3; // big leap (dramatic)
    }

    this.scaleIdx = _clamp(this.scaleIdx + step, lo, hi);

    // 3. Phrase management — flip direction after phraseLength notes
    this.phraseStep++;
    if (this.phraseStep >= this.phraseLength) {
      this.direction *= -1;
      this.phraseStep = 0;
      this.phraseLength = _randInt(3, 8);
    }

    // 4. Boundary reflection
    if (this.scaleIdx <= lo) this.direction = 1;
    if (this.scaleIdx >= hi) this.direction = -1;

    const semitones = SCALE[this.scaleIdx];
    return Math.pow(2, semitones / 12);
  }
}

/* ------------------------------------------------------------------ */
/*  Utilities                                                         */
/* ------------------------------------------------------------------ */

function _randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function _clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
