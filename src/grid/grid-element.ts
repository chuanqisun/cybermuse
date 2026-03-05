import { html, nothing, render } from "lit-html";
import { repeat } from "lit-html/directives/repeat.js";
import { debounceTime, Subject, Subscription } from "rxjs";
import type { SynthStatus } from "../synthesizer";
import type { GridEdit } from "../types";
import { CellBlinker } from "./cell-blinker";
import "./grid-element.css";

const MAX_SYLLABLES = 3;
const ROWS = 25;

const syllableOptions = ["", "0", "1", "2", "."];
const letterOptions = ["", "A", "B", "C", "D", "E", "F", "G"];
const posOptions = [
  "",
  "adjective",
  "adverb",
  "auxiliary verb",
  "conjunction",
  "definite article",
  "determiner",
  "exclamation",
  "indefinite article",
  "infinitive marker",
  "linking verb",
  "modal verb",
  "noun",
  "number",
  "ordinal number",
  "preposition",
  "pronoun",
  "verb",
];
const countOptions = ["", "2", "4", "8"];

/** Column tooltip labels. */
const columnTooltips: Record<number, string> = {
  0: "syllable 1",
  1: "syllable 2",
  2: "syllable 3",
  [MAX_SYLLABLES]: "rhyme group",
  [MAX_SYLLABLES + 1]: "word",
  [MAX_SYLLABLES + 2]: "part of speech",
  [MAX_SYLLABLES + 3]: "pattern count",
};

/** Gruvbox bright palette for rhyme group border colors. */
const rhymeGroupColors: Record<string, string> = Object.fromEntries(letterOptions.filter((l) => l).map((l) => [l, `var(--rhyme-group-${l.toLowerCase()})`]));

export interface GridWord {
  index: number; // zero based, start from first non-blank row
  blank: boolean;
  syllables?: string;
  rhymeGroup?: string;
  text?: string;
  pos?: string;
  count?: number;
}

interface CycleCell {
  kind: "cycle";
  options: string[];
  index: number;
  override?: string;
}

interface TextCell {
  kind: "text";
  value: string;
}

type Cell = CycleCell | TextCell;

/** Serialisable representation of a single grid cell. */
export interface GridCellSnapshot {
  kind: "cycle" | "text";
  index?: number;
  override?: string;
  value?: string;
}

/** Serialisable grid snapshot – one array of cell snapshots per row. */
export type GridSnapshot = GridCellSnapshot[][];

export class GridElement extends HTMLElement {
  static define() {
    if (!customElements.get("grid-element")) customElements.define("grid-element", GridElement);
  }

  private cells: Cell[][] = [];
  private typeAppending = false;
  private typeCellKey = "";
  private typeInput$ = new Subject<void>();
  private typeSub?: Subscription;
  private highlightedRows = new Set<number>();
  private highlightedWord?: string;
  private focusedRow = -1;
  private resolvedCounts = new Map<number, number>();
  private synthStatuses = new Map<number, SynthStatus>();
  private cellBlinker!: CellBlinker;

  connectedCallback() {
    this.cells = Array.from({ length: ROWS }, () => this.createRowCells());
    this.cellBlinker = new CellBlinker(() => this.renderGrid());
    this.typeSub = this.typeInput$.pipe(debounceTime(400)).subscribe(() => {
      this.typeAppending = false;
    });
    this.renderGrid();
  }

  disconnectedCallback() {
    this.typeSub?.unsubscribe();
    this.cellBlinker.destroy();
  }

  private createRowCells(): Cell[] {
    const cells: Cell[] = [];
    for (let c = 0; c < MAX_SYLLABLES; c++) {
      cells.push({ kind: "cycle", options: syllableOptions, index: 0 });
    }
    cells.push({ kind: "cycle", options: letterOptions, index: 0 });
    cells.push({ kind: "text", value: "" });
    cells.push({ kind: "cycle", options: posOptions, index: 0 });
    cells.push({ kind: "cycle", options: countOptions, index: 0 });
    return cells;
  }

  private renderGrid() {
    const template = html`
      <form class="board" @click=${this.onFormClick} @input=${this.onFormInput} @keydown=${this.onFormKeyDown} @submit=${preventDefault}>
        ${repeat(
          this.cells,
          (_row, rowIndex) => rowIndex,
          (row, rowIndex) => {
            const count = this.resolvedCounts.get(rowIndex);
            const synthStatus = this.synthStatuses.get(rowIndex);
            const rhymeCell = row[MAX_SYLLABLES];
            const rhymeLabel = rhymeCell?.kind === "cycle" ? (rhymeCell.options[rhymeCell.index] ?? "") : "";
            const rhymeColor = rhymeGroupColors[rhymeLabel];
            const discIcon = synthStatus === "ready" ? "●" : synthStatus === "synthesizing" ? "○" : nothing;
            return html`
              <div class="row ${rhymeColor ? "rhymed" : ""}" style=${rhymeColor ? `--rhyme-color: ${rhymeColor}` : ""}>
                <div class="row-left">
                  <span class="synth-disc" data-blank=${!synthStatus}>${discIcon}</span>
                  ${repeat(
                    row.slice(0, MAX_SYLLABLES + 1),
                    (_cell, colIndex) => colIndex,
                    (cell, colIndex) => this.renderCell(cell, rowIndex, colIndex)
                  )}
                </div>
                <div class="row-right">
                  ${repeat(
                    row.slice(MAX_SYLLABLES + 1),
                    (_cell, colOffset) => MAX_SYLLABLES + 1 + colOffset,
                    (cell, colOffset) => this.renderCell(cell, rowIndex, MAX_SYLLABLES + 1 + colOffset)
                  )}
                  <span class="cell resolved-count" data-blank=${count === undefined}>${count ?? nothing}</span>
                </div>
              </div>
            `;
          }
        )}
      </form>
    `;
    render(template, this);
  }

  private renderCell(cell: Cell, row: number, col: number) {
    const blinkKey = `${row},${col}`;
    const isAiEditing = this.cellBlinker?.isOn(blinkKey) ?? false;

    if (cell.kind === "cycle") {
      const label = cell.override ?? cell.options[cell.index] ?? "";
      const isPos = col === MAX_SYLLABLES + 2;
      const tooltip = columnTooltips[col] ?? "";
      return html`
        <button
          class="cell ${isPos ? "pos" : ""} ${isAiEditing ? "ai-editing" : ""}"
          type="button"
          title=${tooltip}
          data-blank=${label === ""}
          data-row=${row}
          data-col=${col}
        >
          ${label || nothing}
        </button>
      `;
    }

    const isHighlighted = this.highlightedRows.has(row);
    const isFocused = row === this.focusedRow;
    const showSampled = isHighlighted && !isFocused && !!this.highlightedWord;
    const displayValue = showSampled ? this.highlightedWord! : cell.value;
    const tooltip = columnTooltips[col] ?? "";

    return html`
      <input
        class="cell text ${isHighlighted ? "highlighted" : ""} ${isAiEditing ? "ai-editing" : ""}"
        type="text"
        title=${tooltip}
        placeholder=${isHighlighted && this.highlightedWord ? this.highlightedWord : ""}
        data-row=${row}
        data-col=${col}
        .value=${displayValue}
        @focus=${(e: FocusEvent) => {
          this.focusedRow = row;
          this.renderGrid();
          (e.target as HTMLInputElement).select();
        }}
        @blur=${() => {
          this.focusedRow = -1;
          this.renderGrid();
        }}
      />
    `;
  }

  private onFormClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    const { row, col } = this.cellCoords(target);
    if (row < 0) return;

    const cell = this.cells[row]?.[col];
    if (cell?.kind !== "cycle") return;

    // Count column: cycle through presets; if override, jump to next preset > override
    if (col === MAX_SYLLABLES + 3) {
      const currentValue = Number(cell.override ?? cell.options[cell.index]);
      cell.override = undefined;
      if (!Number.isNaN(currentValue) && currentValue > 0) {
        const next = countOptions
          .map((opt, i) => ({ v: Number(opt), i }))
          .filter(({ v }) => !Number.isNaN(v) && v > currentValue)
          .sort((a, b) => a.v - b.v)[0];
        cell.index = next ? next.i : 0;
      } else {
        cell.index = (cell.index + 1) % cell.options.length;
      }
    } else {
      cell.index = (cell.index + 1) % cell.options.length;
    }

    this.renderGrid();
    this.emitChange();
  };

  private onFormInput = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const { row, col } = this.cellCoords(target);
    if (row < 0) return;

    const cell = this.cells[row]?.[col];
    if (cell?.kind === "text") {
      cell.value = target.value;
      this.emitChange();
    }
  };

  private onFormKeyDown = (event: KeyboardEvent) => {
    const cellEl = (event.target as HTMLElement).closest<HTMLElement>(".cell");
    if (!cellEl) return;
    const { row, col } = this.cellCoords(cellEl);
    if (row < 0) return;

    // Arrow key navigation
    const arrowDeltas: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const delta = arrowDeltas[event.key];
    if (delta) {
      // For text inputs, Left/Right arrows respect cursor position and selection
      if (cellEl instanceof HTMLInputElement && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        const start = cellEl.selectionStart ?? 0;
        const end = cellEl.selectionEnd ?? 0;
        const hasSelection = start !== end;

        if (hasSelection) {
          // Let browser deselect and move cursor to left/right edge — no cell navigation
          return;
        }
        if (event.key === "ArrowLeft" && start > 0) {
          // Not at left edge — let browser move cursor normally
          return;
        }
        if (event.key === "ArrowRight" && end < cellEl.value.length) {
          // Not at right edge — let browser move cursor normally
          return;
        }
      }

      event.preventDefault();
      const nextRow = clamp(row + delta[0], 0, this.rowCount - 1);
      const nextCol = clamp(col + delta[1], 0, this.colCount - 1);
      this.querySelector<HTMLElement>(`.cell[data-row="${nextRow}"][data-col="${nextCol}"]`)?.focus();
      return;
    }

    // Remaining shortcuts apply only to cycle-cell buttons
    if (!(cellEl instanceof HTMLButtonElement)) return;
    const cell = this.cells[row]?.[col];
    if (cell?.kind !== "cycle") return;

    // Backspace / Delete → clear
    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      cell.index = 0;
      cell.override = undefined;
      this.renderGrid();
      this.emitChange();
      this.focusCell(row, col);
      return;
    }

    const key = event.key;

    // Syllable columns
    if (col < MAX_SYLLABLES) {
      const match = cell.options.indexOf(key);
      if (match >= 0) {
        event.preventDefault();
        cell.index = match;
        this.renderGrid();
        this.emitChange();
        this.focusCell(row, col);
      }
      return;
    }

    // Rhyme group column
    if (col === MAX_SYLLABLES) {
      const match = cell.options.indexOf(key.toUpperCase());
      if (match >= 0) {
        event.preventDefault();
        cell.index = match;
        this.renderGrid();
        this.emitChange();
        this.focusCell(row, col);
      }
      return;
    }

    // POS column: letter cycles through matching options
    // Primary matches (POS starts with letter) first, then secondary (any word starts with letter)
    if (col === MAX_SYLLABLES + 2 && /^[a-zA-Z]$/.test(key)) {
      event.preventDefault();
      const letter = key.toLowerCase();
      const currentValue = cell.options[cell.index] ?? "";
      const primary = cell.options.filter((opt) => opt !== "" && opt.toLowerCase().startsWith(letter));
      const secondary = cell.options.filter(
        (opt) =>
          opt !== "" &&
          !opt.toLowerCase().startsWith(letter) &&
          opt
            .toLowerCase()
            .split(" ")
            .some((word) => word.startsWith(letter))
      );
      const matches = [...primary, ...secondary];
      if (matches.length === 0) return;

      const currentIdx = matches.indexOf(currentValue);
      if (currentIdx >= 0 && currentIdx < matches.length - 1) {
        cell.index = cell.options.indexOf(matches[currentIdx + 1]);
      } else if (currentIdx === matches.length - 1) {
        cell.index = 0; // wrap to blank
      } else {
        cell.index = cell.options.indexOf(matches[0]);
      }

      this.renderGrid();
      this.emitChange();
      this.focusCell(row, col);
      return;
    }

    // Count column: type digits, debounce controls append vs replace
    if (col === MAX_SYLLABLES + 3 && /^\d$/.test(key)) {
      event.preventDefault();
      const cellKey = `${row},${col}`;
      const shouldAppend = this.typeAppending && this.typeCellKey === cellKey;
      this.typeCellKey = cellKey;
      cell.override = shouldAppend ? (cell.override ?? "") + key : key;
      this.typeAppending = true;
      this.typeInput$.next();
      this.renderGrid();
      this.emitChange();
      this.focusCell(row, col);
    }
  };

  private focusCell(row: number, col: number) {
    this.querySelector<HTMLElement>(`.cell[data-row="${row}"][data-col="${col}"]`)?.focus();
  }

  private cellCoords(el: HTMLElement): { row: number; col: number } {
    const row = Number(el.dataset.row);
    const col = Number(el.dataset.col);
    return Number.isNaN(row) || Number.isNaN(col) ? { row: -1, col: -1 } : { row, col };
  }

  private emitChange() {
    this.dispatchEvent(new CustomEvent("grid-change", { bubbles: true, composed: true }));
  }

  highlight(index: number | number[], word?: string) {
    // index is relative to the first non-blank row (same as GridWord.index)
    let firstNonBlank = -1;
    for (let i = 0; i < this.cells.length; i++) {
      if (!this.isRowBlank(this.cells[i])) {
        firstNonBlank = i;
        break;
      }
    }
    this.highlightedRows.clear();
    if (firstNonBlank !== -1) {
      const indices = Array.isArray(index) ? index : [index];
      for (const idx of indices) {
        this.highlightedRows.add(firstNonBlank + idx);
      }
    }
    this.highlightedWord = word;
    this.renderGrid();
  }

  clearHighlight() {
    this.highlightedRows.clear();
    this.highlightedWord = undefined;
    this.renderGrid();
  }

  /** Update the resolved pool sizes displayed after the last button on each row.
   *  @param counts Maps relative word index to pool size. */
  setResolvedCounts(counts: Map<number, number>) {
    let firstNonBlank = -1;
    for (let i = 0; i < this.cells.length; i++) {
      if (!this.isRowBlank(this.cells[i])) {
        firstNonBlank = i;
        break;
      }
    }
    const next = new Map<number, number>();
    if (firstNonBlank >= 0) {
      for (const [relIndex, count] of counts) {
        next.set(firstNonBlank + relIndex, count);
      }
    }
    if (mapsEqual(this.resolvedCounts, next)) return;
    this.resolvedCounts = next;
    this.renderGrid();
  }

  /** Update the synthesis status indicators for each row.
   *  @param statuses Maps relative word index to synth status. */
  setSynthStatuses(statuses: Map<number, SynthStatus>) {
    let firstNonBlank = -1;
    for (let i = 0; i < this.cells.length; i++) {
      if (!this.isRowBlank(this.cells[i])) {
        firstNonBlank = i;
        break;
      }
    }
    const next = new Map<number, SynthStatus>();
    if (firstNonBlank >= 0) {
      for (const [relIndex, status] of statuses) {
        next.set(firstNonBlank + relIndex, status);
      }
    }
    if (mapsEqual(this.synthStatuses, next)) return;
    this.synthStatuses = next;
    this.renderGrid();
  }

  getWords(): GridWord[] {
    const rows = this.cells;
    let firstNonBlank = -1;
    let lastNonBlank = -1;

    for (let i = 0; i < rows.length; i++) {
      if (!this.isRowBlank(rows[i])) {
        if (firstNonBlank === -1) firstNonBlank = i;
        lastNonBlank = i;
      }
    }

    if (firstNonBlank === -1) return [];

    const result: GridWord[] = [];
    for (let i = firstNonBlank; i <= lastNonBlank; i++) {
      const row = rows[i];
      const blank = this.isRowBlank(row);
      const word: GridWord = { index: i - firstNonBlank, blank };

      if (!blank) {
        const syllables = row
          .slice(0, MAX_SYLLABLES)
          .map((c) => (c.kind === "cycle" ? (c.options[c.index] ?? "") : ""))
          .join("");
        if (syllables) word.syllables = syllables;

        const rhymeCell = row[MAX_SYLLABLES];
        const rhymeGroup = rhymeCell?.kind === "cycle" ? (rhymeCell.options[rhymeCell.index] ?? "") : "";
        if (rhymeGroup) word.rhymeGroup = rhymeGroup;

        const textCell = row[MAX_SYLLABLES + 1];
        const text = textCell?.kind === "text" ? textCell.value : "";
        if (text) word.text = text;

        const posCell = row[MAX_SYLLABLES + 2];
        const pos = posCell?.kind === "cycle" ? (posCell.override ?? posCell.options[posCell.index] ?? "") : "";
        if (pos) word.pos = pos;

        const countCell = row[MAX_SYLLABLES + 3];
        const countStr = countCell?.kind === "cycle" ? (countCell.override ?? countCell.options[countCell.index] ?? "") : "";
        if (countStr) word.count = Number(countStr);
      }

      result.push(word);
    }

    return result;
  }

  /* ---------------------------------------------------------------- */
  /*  Serialisation / deserialisation                                  */
  /* ---------------------------------------------------------------- */

  /** Serialise the current grid state for persistence. */
  serialise(): GridSnapshot {
    return this.cells.map((row) =>
      row.map((cell): GridCellSnapshot => {
        if (cell.kind === "cycle") {
          const stored: GridCellSnapshot = { kind: "cycle", index: cell.index };
          if (cell.override !== undefined) stored.override = cell.override;
          return stored;
        }
        return { kind: "text", value: cell.value };
      })
    );
  }

  /** Restore grid state from a persisted snapshot. */
  deserialise(stored: GridSnapshot): void {
    for (let r = 0; r < stored.length && r < this.cells.length; r++) {
      const row = this.cells[r];
      const storedRow = stored[r];
      for (let c = 0; c < storedRow.length && c < row.length; c++) {
        const src = storedRow[c];
        const dest = row[c];
        if (src.kind === "cycle" && dest.kind === "cycle") {
          dest.index = src.index ?? 0;
          dest.override = src.override;
        } else if (src.kind === "text" && dest.kind === "text") {
          dest.value = src.value ?? "";
        }
      }
    }
    this.renderGrid();
  }

  /** Reset all cells to their default (blank) state. */
  clear(): void {
    this.cells = Array.from({ length: ROWS }, () => this.createRowCells());
    this.resolvedCounts.clear();
    this.synthStatuses.clear();
    this.highlightedRows.clear();
    this.highlightedWord = undefined;
    this.renderGrid();
    this.emitChange();
  }

  /* ---------------------------------------------------------------- */
  /*  Shared edit API (used by both UI and AI agent)                   */
  /* ---------------------------------------------------------------- */

  /**
   * Apply a single {@link GridEdit} to the grid.
   *
   * This is the **shared code‑path** for all programmatic mutations —
   * the AI agent, future human‑initiated batch edits, and undo/redo
   * should all funnel through here.
   */
  applyEdit(edit: GridEdit): void {
    switch (edit.action) {
      case "patch": {
        if (edit.line == null) return;
        const rowIdx = this.lineToRow(edit.line);
        if (rowIdx < 0 || rowIdx >= this.cells.length) return;
        this.setRowFields(rowIdx, edit);
        break;
      }
      case "clear": {
        if (edit.line == null) return;
        const rowIdx = this.lineToRow(edit.line);
        if (rowIdx < 0 || rowIdx >= this.cells.length) return;
        this.cells[rowIdx] = this.createRowCells();
        break;
      }
      case "prepend": {
        if (edit.beforeLine == null) return;
        const rowIdx = this.lineToRow(edit.beforeLine);
        if (rowIdx < 0 || rowIdx >= this.cells.length) return;
        for (let i = this.cells.length - 1; i > rowIdx; i--) {
          this.cells[i] = this.cells[i - 1];
        }
        this.cells[rowIdx] = this.createRowCells();
        this.setRowFields(rowIdx, edit);
        break;
      }
      case "append": {
        if (edit.afterLine == null) return;
        const insertIdx = this.lineToRow(edit.afterLine) + 1;
        // Fixed‑size grid: can't insert beyond the last row.
        if (insertIdx < 0 || insertIdx >= this.cells.length) return;
        for (let i = this.cells.length - 1; i > insertIdx; i--) {
          this.cells[i] = this.cells[i - 1];
        }
        this.cells[insertIdx] = this.createRowCells();
        this.setRowFields(insertIdx, edit);
        break;
      }
      case "pause": {
        // Insert a blank row (silent rest) after the given line.
        if (edit.afterLine == null) return;
        const pauseIdx = this.lineToRow(edit.afterLine) + 1;
        if (pauseIdx < 0 || pauseIdx >= this.cells.length) return;
        for (let i = this.cells.length - 1; i > pauseIdx; i--) {
          this.cells[i] = this.cells[i - 1];
        }
        this.cells[pauseIdx] = this.createRowCells();
        // No setRowFields — leave it blank for a pause.
        break;
      }
    }
    this.renderGrid();
    this.emitChange();
  }

  /* ---------------------------------------------------------------- */
  /*  AI edit visual feedback                                         */
  /* ---------------------------------------------------------------- */

  /**
   * Trigger a fast blink on the cell(s) affected by the given edit.
   *
   * Must be called **after** {@link applyEdit} so that structural
   * inserts (prepend / append / pause) have already shifted the grid
   * and `lineToRow` resolves correctly.
   *
   * Only `patch` edits that carry explicit field values produce a blink;
   * structural-only actions (clear, pause, bare prepend/append) are
   * silently ignored.
   */
  blinkEdit(edit: GridEdit): boolean {
    // Derive the absolute row that was affected after applyEdit has run.
    let absRow = -1;
    if (edit.action === "patch" || edit.action === "clear") {
      if (edit.line != null) absRow = this.lineToRow(edit.line);
    } else if (edit.action === "prepend") {
      if (edit.beforeLine != null) absRow = this.lineToRow(edit.beforeLine);
    } else if (edit.action === "append" || edit.action === "pause") {
      if (edit.afterLine != null) absRow = this.lineToRow(edit.afterLine) + 1;
    }
    if (absRow < 0 || absRow >= this.cells.length) return false;

    const row = this.cells[absRow];

    // Determine which columns to blink based on which fields actually change.
    const cols: number[] = [];
    if (edit.syllables !== undefined) {
      const chars = edit.syllables.split("");
      const offset = MAX_SYLLABLES - chars.length;
      for (let c = 0; c < MAX_SYLLABLES; c++) {
        const cell = row?.[c];
        const currentLabel = cell?.kind === "cycle" ? (cell.override ?? cell.options[cell.index] ?? "") : "";
        const newChar = chars[c - offset] ?? "";
        if (newChar !== currentLabel) cols.push(c);
      }
    }
    if (edit.rhymeGroup !== undefined) {
      const cell = row[MAX_SYLLABLES];
      const current = cell?.kind === "cycle" ? (cell.override ?? cell.options[cell.index] ?? "") : "";
      if (edit.rhymeGroup !== current) cols.push(MAX_SYLLABLES);
    }
    if (edit.text !== undefined) {
      const cell = row[MAX_SYLLABLES + 1];
      const current = cell?.kind === "text" ? cell.value : "";
      if (edit.text !== current) cols.push(MAX_SYLLABLES + 1);
    }
    if (edit.pos !== undefined) {
      const cell = row[MAX_SYLLABLES + 2];
      const current = cell?.kind === "cycle" ? (cell.override ?? cell.options[cell.index] ?? "") : "";
      if (edit.pos !== current) cols.push(MAX_SYLLABLES + 2);
    }
    if (edit.count !== undefined) {
      const cell = row[MAX_SYLLABLES + 3];
      const current = cell?.kind === "cycle" ? (cell.override ?? cell.options[cell.index] ?? "") : "";
      if (String(edit.count) !== current) cols.push(MAX_SYLLABLES + 3);
    }

    for (const col of cols) {
      this.cellBlinker.triggerBlink(`${absRow},${col}`);
    }

    return cols.length > 0;
  }

  /* ---------------------------------------------------------------- */
  /*  Internal helpers for edit application                           */
  /* ---------------------------------------------------------------- */

  /**
   * Convert a line index (relative to the first non‑blank row, as
   * returned by {@link getWords}) to an absolute row index.
   */
  private lineToRow(lineIndex: number): number {
    for (let i = 0; i < this.cells.length; i++) {
      if (!this.isRowBlank(this.cells[i])) return i + lineIndex;
    }
    // Grid is empty – treat lineIndex as an absolute row index.
    return lineIndex;
  }

  /**
   * Set individual field values on the cells of the given row.
   * Only provided (non‑`undefined`) fields are touched.
   */
  private setRowFields(rowIdx: number, fields: { syllables?: string; rhymeGroup?: string; text?: string; pos?: string; count?: number }): void {
    const row = this.cells[rowIdx];
    if (!row) return;

    if (fields.syllables !== undefined) {
      const chars = fields.syllables.split("");
      // Right-align: pad from the left so short patterns fill rightmost cells.
      const offset = MAX_SYLLABLES - chars.length;
      for (let i = 0; i < MAX_SYLLABLES; i++) {
        const cell = row[i];
        if (cell.kind === "cycle") {
          const char = chars[i - offset] ?? "";
          const idx = cell.options.indexOf(char);
          cell.index = idx >= 0 ? idx : 0;
          cell.override = undefined;
        }
      }
    }

    if (fields.rhymeGroup !== undefined) {
      const cell = row[MAX_SYLLABLES];
      if (cell.kind === "cycle") {
        const idx = cell.options.indexOf(fields.rhymeGroup);
        cell.index = idx >= 0 ? idx : 0;
      }
    }

    if (fields.text !== undefined) {
      const cell = row[MAX_SYLLABLES + 1];
      if (cell.kind === "text") {
        cell.value = fields.text;
      }
    }

    if (fields.pos !== undefined) {
      const cell = row[MAX_SYLLABLES + 2];
      if (cell.kind === "cycle") {
        const idx = cell.options.indexOf(fields.pos);
        cell.index = idx >= 0 ? idx : 0;
        cell.override = undefined;
      }
    }

    if (fields.count !== undefined) {
      const cell = row[MAX_SYLLABLES + 3];
      if (cell.kind === "cycle") {
        const countStr = String(fields.count);
        const idx = cell.options.indexOf(countStr);
        if (idx >= 0) {
          cell.index = idx;
          cell.override = undefined;
        } else {
          cell.override = countStr;
        }
      }
    }
  }

  private isRowBlank(row: Cell[]): boolean {
    return row.every((cell) => {
      if (cell.kind === "cycle") return cell.index === 0 && cell.override === undefined;
      return cell.value === "";
    });
  }

  private get rowCount() {
    return this.cells.length;
  }

  private get colCount() {
    return this.cells[0]?.length ?? 0;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function preventDefault(e: Event) {
  e.preventDefault();
}

/** Shallow-compare two Maps for equality. */
function mapsEqual<K, V>(a: Map<K, V>, b: Map<K, V>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) {
    if (b.get(key) !== value) return false;
  }
  return true;
}
