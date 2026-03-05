import { html, render } from "lit-html";
import type { GridElement } from "../grid/grid-element";
import type { HelpElement } from "../help/help-element";
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
  private help?: HelpElement;
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

  /** Link a help element for the about dialog. */
  setHelp(help: HelpElement) {
    this.help = help;
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
        <div class="header-title">CyberMUSE</div>
        <div class="header-actions">
          <button class="header-btn ${this.playing ? "active" : ""}" type="button" @click=${this.onPlayStopClick}>Loop: ${this.playing ? "ON" : "OFF"}</button>
          <span class="header-divider"></span>
          <button class="header-btn ${this.autoMode ? "active" : ""}" type="button" @click=${this.onAutoClick}>AI: ${this.autoMode ? "ON" : "OFF"}</button>
          <span class="header-divider"></span>
          <button class="header-btn" type="button" @click=${this.onEvalClick}>Update</button>
          <div class="wpm-group">
            <span class="header-divider"></span>
            <input class="wpm-input" type="number" min="1" max="600" .value=${String(this.wpm)} @change=${this.onWpmChange} />
            <span class="wpm-label">wpm</span>
            <span class="header-divider"></span>
          </div>
          <button class="header-btn" type="button" @click=${this.onSettingsClick}>Settings</button>
          <span class="header-divider"></span>
          <button class="header-btn" type="button" @click=${this.onClearClick}>Clear</button>
          <span class="header-divider"></span>
          <button class="header-btn" type="button" @click=${this.onHelpClick}>Help</button>
        </div>
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
  /*  Eval (re-resolve)                                               */
  /* ---------------------------------------------------------------- */

  private onEvalClick = () => {
    this.dispatchEvent(new CustomEvent("header-eval", { bubbles: true, composed: true }));
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
  /*  Help dialog                                                      */
  /* ---------------------------------------------------------------- */

  private onHelpClick = () => {
    this.help?.open();
  };

  /* ---------------------------------------------------------------- */
  /*  Settings dialog                                                 */
  /* ---------------------------------------------------------------- */

  private onSettingsClick = () => {
    this.openSettingsDialog();
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
}
