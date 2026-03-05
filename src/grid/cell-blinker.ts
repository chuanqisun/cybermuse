/**
 * CellBlinker — standalone per-cell blink state machine.
 *
 * Each cell is identified by an opaque string key (e.g. "row,col").
 * Calling `triggerBlink(key)` starts a 3-flash sequence (6 half-cycles
 * at 40 ms each → 240 ms total) that alternates between ON and OFF.
 *
 * Re-triggering the same key while a blink is in progress cancels the
 * running sequence and restarts from ON immediately — no stutter, no
 * overlapping timers.
 *
 * ON  = cell should display the `ai-editing` highlight class.
 * OFF = cell renders normally.
 *
 * After the final half-cycle the cell returns to its normal state
 * (blink key is removed from the internal map).
 */

const BLINK_HALF_CYCLES = 6; // 3 full on→off flashes
const BLINK_INTERVAL_MS = 40; // ms per half-cycle

export class CellBlinker {
  /** True  = highlight ON,  key absent = highlight OFF. */
  private readonly state = new Map<string, boolean>();
  /** One active timer per blinking key. */
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly onRender: () => void;

  /**
   * @param onRender - Called whenever blink state changes so the host
   *   can re-render the affected elements.
   */
  constructor(onRender: () => void) {
    this.onRender = onRender;
  }

  /**
   * Start (or restart) a blink sequence for the given key.
   *
   * Idempotent restart: if already blinking, the old timer is cancelled
   * and the full sequence begins again from the ON state.
   */
  triggerBlink(key: string): void {
    // Cancel any existing timer for this key
    const existing = this.timers.get(key);
    if (existing != null) clearTimeout(existing);

    // Immediately show ON state
    this.state.set(key, true);
    this.onRender();

    let count = 0;

    const tick = () => {
      count++;
      if (count >= BLINK_HALF_CYCLES) {
        // Sequence complete — restore normal state
        this.state.delete(key);
        this.timers.delete(key);
        this.onRender();
        return;
      }
      // even count → ON, odd count → OFF
      this.state.set(key, count % 2 === 0);
      this.onRender();
      this.timers.set(key, setTimeout(tick, BLINK_INTERVAL_MS));
    };

    this.timers.set(key, setTimeout(tick, BLINK_INTERVAL_MS));
  }

  /** Returns true when the cell at `key` is in the highlighted ON state. */
  isOn(key: string): boolean {
    return this.state.get(key) === true;
  }

  /** Cancel all active blinks and release all timers. */
  destroy(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.state.clear();
    this.timers.clear();
  }
}
