import { html, render } from "lit-html";
import type { GridElement } from "../grid/grid-element";
import type { StoredSettings } from "../storage";
import "./header-element.css";

const DEFAULT_WPM = 100;

export class HeaderElement extends HTMLElement {
  static define() {
    if (!customElements.get("header-element")) customElements.define("header-element", HeaderElement);
  }

  private playing = false;
  private autoMode = false;
  private grid?: GridElement;
  private wpm = DEFAULT_WPM;
  private settings: StoredSettings = {};
  private dialog?: HTMLDialogElement;

  connectedCallback() {
    this.renderUI();
  }

  disconnectedCallback() {
    this.stop();
  }

  /** Link this header to a grid element it controls. */
  setGrid(grid: GridElement) {
    this.grid = grid;
  }

  /** Current words-per-minute value. */
  getWpm(): number {
    return this.wpm;
  }

  /** Set WPM (e.g. from stored state). Re-renders the UI. */
  setWpm(wpm: number) {
    this.wpm = wpm;
    this.renderUI();
  }

  /** Current settings. */
  getSettings(): StoredSettings {
    return { ...this.settings };
  }

  /** Set settings (e.g. from stored state). */
  setSettings(settings: StoredSettings) {
    this.settings = { ...settings };
  }

  /* ---------------------------------------------------------------- */
  /*  Rendering                                                       */
  /* ---------------------------------------------------------------- */

  private renderUI() {
    render(
      html`
        <button class="header-btn" type="button" @click=${this.onPlayStopClick}>${this.playing ? "Stop" : "Play"}</button>
        <button class="header-btn" type="button" @click=${this.onAutoClick}>Auto: ${this.autoMode ? "ON" : "OFF"}</button>
        <div class="wpm-group">
          <input class="wpm-input" type="number" min="1" max="600" .value=${String(this.wpm)} @change=${this.onWpmChange} />
          <span>wpm</span>
        </div>
        <button class="header-btn" type="button" @click=${this.onSettingsClick}>Settings</button>
        <button class="header-btn" type="button" @click=${this.onHelpClick}>Help</button>
        <button class="header-btn" type="button" @click=${this.onClearClick}>Clear</button>
      `,
      this
    );
  }

  /* ---------------------------------------------------------------- */
  /*  Play / Stop                                                     */
  /* ---------------------------------------------------------------- */

  private onPlayStopClick = () => {
    if (this.playing) {
      this.stop();
    } else {
      this.start();
    }
  };

  private start() {
    if (!this.grid) return;
    this.playing = true;
    this.renderUI();
    this.dispatchEvent(new CustomEvent("player-start", { bubbles: true, composed: true }));
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    this.grid?.clearHighlight();
    this.renderUI();
    this.dispatchEvent(new CustomEvent("player-stop", { bubbles: true, composed: true }));
  }

  /** Start playback externally (e.g. from keyboard shortcut). */
  externalStart() {
    if (this.playing) return;
    if (!this.grid) return;
    this.playing = true;
    this.renderUI();
  }

  /** Stop playback externally (e.g. from keyboard shortcut). */
  externalStop() {
    if (!this.playing) return;
    this.playing = false;
    this.grid?.clearHighlight();
    this.renderUI();
  }

  /* ---------------------------------------------------------------- */
  /*  Auto mode (AI agent)                                            */
  /* ---------------------------------------------------------------- */

  private onAutoClick = () => {
    if (!this.autoMode && !this.settings.geminiApiKey) {
      this.openSettingsDialog();
      return;
    }
    this.autoMode = !this.autoMode;
    this.renderUI();
    const event = this.autoMode ? "agent-start" : "agent-stop";
    this.dispatchEvent(new CustomEvent(event, { bubbles: true, composed: true }));
  };

  /** Turn auto mode off externally (e.g. when API key is missing). */
  externalAutoOff() {
    if (!this.autoMode) return;
    this.autoMode = false;
    this.renderUI();
  }

  /* ---------------------------------------------------------------- */
  /*  Clear                                                           */
  /* ---------------------------------------------------------------- */

  private onClearClick = () => {
    this.dispatchEvent(new CustomEvent("header-clear", { bubbles: true, composed: true }));
  };

  /* ---------------------------------------------------------------- */
  /*  WPM                                                             */
  /* ---------------------------------------------------------------- */

  private onWpmChange = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const value = Math.max(1, Math.min(600, Number(input.value) || DEFAULT_WPM));
    this.wpm = value;
    input.value = String(value);
    this.dispatchEvent(new CustomEvent("wpm-change", { bubbles: true, composed: true, detail: value }));
  };

  /* ---------------------------------------------------------------- */
  /*  Settings dialog                                                 */
  /* ---------------------------------------------------------------- */

  private onSettingsClick = () => {
    this.openSettingsDialog();
  };

  private onHelpClick = () => {
    this.openHelpDialog();
  };

  private openSettingsDialog() {
    // Remove any existing dialog
    this.dialog?.remove();

    const dialog = document.createElement("dialog");
    dialog.className = "settings-dialog";

    const onSave = () => {
      const apiKeyInput = dialog.querySelector<HTMLInputElement>("#gemini-api-key");
      if (apiKeyInput) {
        this.settings.geminiApiKey = apiKeyInput.value.trim() || undefined;
      }
      this.dispatchEvent(new CustomEvent("settings-change", { bubbles: true, composed: true, detail: { ...this.settings } }));
      dialog.close();
      dialog.remove();
      this.dialog = undefined;
    };

    const onCancel = () => {
      dialog.close();
      dialog.remove();
      this.dialog = undefined;
    };

    render(
      html`
        <h3 class="dialog-title">Settings</h3>
        <div class="field">
          <label for="gemini-api-key">Gemini API Key</label>
          <input id="gemini-api-key" type="password" .value=${this.settings.geminiApiKey ?? ""} />
        </div>
        <div class="dialog-actions">
          <button type="button" @click=${onCancel}>Cancel</button>
          <button type="button" @click=${onSave}>Save</button>
        </div>
      `,
      dialog
    );

    document.body.appendChild(dialog);
    this.dialog = dialog;
    dialog.showModal();
  }

  /* ---------------------------------------------------------------- */
  /*  Help dialog                                                      */
  /* ---------------------------------------------------------------- */

  private openHelpDialog() {
    this.dialog?.remove();

    const dialog = document.createElement("dialog");
    dialog.className = "help-dialog";

    const onClose = () => {
      dialog.close();
      dialog.remove();
      this.dialog = undefined;
    };

    render(
      html`
        <section class="help-section">
          <h2>Quick Start</h2>
          <p>Header controls, from left to right:</p>
          <dl class="help-dl">
            <dt>Play / Stop</dt>
            <dd>Start or stop the poem loop. Each loop cycles through every row and speaks the resolved word.</dd>
            <dt>Auto</dt>
            <dd>Toggle AI composition mode. The AI agent fills and edits slots automatically. Requires a Gemini API key (see Settings).</dd>
            <dt>WPM</dt>
            <dd>Words per minute — controls playback speed (1–600).</dd>
            <dt>Settings</dt>
            <dd>Configure your Gemini API key. Only needed for AI mode.</dd>
            <dt>Help</dt>
            <dd>Opens this dialog.</dd>
            <dt>Clear</dt>
            <dd>Reset the entire grid to a blank state.</dd>
          </dl>
          <p><strong>Keyboard shortcuts</strong></p>
          <dl class="help-dl">
            <dt><kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Enter</kbd></dt>
            <dd>Start playback or re‑evaluate patterns while playing (update).</dd>
            <dt><kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Shift</kbd> + <kbd>Enter</kbd></dt>
            <dd>Stop playback.</dd>
          </dl>
        </section>

        <section class="help-section">
          <h2>Poem Voicing</h2>
          <p>Each row in the grid is a <strong>slot</strong> that produces one spoken word. A blank row (all fields empty) acts as a silent rest.</p>
          <h3>Syllable Stress</h3>
          <p>
            The first three columns set a stress pattern. Each cell is blank, <code>0</code> (unstressed), <code>1</code> (primary stress),
            <code>2</code> (secondary stress), or <code>.</code> (wildcard — matches zero or more syllables of any stress). Cells are read left to right, e.g.
            <code>1.0</code> matches words starting stressed and ending unstressed. If no words match, the constraint is dropped so every slot always produces a
            word.
          </p>
          <h3>Rhyme Groups</h3>
          <p>
            Assign slots to a rhyme group (<code>A</code>–<code>G</code>). All slots in the same group are constrained to rhyme with each other. The first slot
            in each group with user-entered text anchors the rhyme key. The solver uses progressive suffix relaxation to find the tightest partial rhyme when
            exact matches are scarce.
          </p>
        </section>

        <section class="help-section">
          <h3>Text</h3>
          <p>
            When count ≤ 1 (default), the text you type is the exact word spoken (literal mode). When count &gt; 1, the text becomes a
            <strong>semantic query</strong> — the system finds words whose meaning is similar using vector embeddings. Leave text blank with count &gt; 1 to
            draw from the full dictionary.
          </p>
          <h3>Part of Speech</h3>
          <p>Filter candidates to a specific part of speech (noun, verb, adjective, etc.). Applied before stress and rhyme constraints.</p>
          <h3>Count</h3>
          <p>
            Controls how many candidate words cycle in each slot. Default is 1 (literal). Click to cycle through 2, 4, 8, or type any number. When count &gt; 1,
            the solver finds matching candidates ranked by semantic similarity.
          </p>
        </section>

        <div class="dialog-actions">
          <button type="button" @click=${onClose}>Close</button>
        </div>
      `,
      dialog
    );

    document.body.appendChild(dialog);
    this.dialog = dialog;
    dialog.showModal();
  }
}
