export type Word = {
  text: string;
  pos: string;
  definition: string;
  stress: string;
  syllables: number;
  rhyme: string;
  ipa?: string;
};

/** A grid word slot as output by the grid element. */
export interface GridWord {
  index: number;
  blank: boolean;
  syllables?: string;
  rhymeGroup?: string;
  text?: string;
  pos?: string;
  count?: number;
}

/** A resolved word slot: semantic pool pre-fetched from the vector DB. */
export interface ResolvedWord {
  index: number;
  /** True when the grid row is blank (rest / pause). */
  blank: boolean;
  /** Original user-entered text (if any). */
  text?: string;
  /** Stress pattern (e.g. "01", "1*0"). "." in grid cells is mapped to "*". */
  syllables?: string;
  /** Rhyme label shared across slots (e.g. "A", "B"). */
  rhymeGroup?: string;
  /** Part of speech filter (e.g. "noun", "verb"). */
  pos?: string;
  /** Pre-fetched semantically similar word texts from vector DB. */
  pool: string[];
  /** Exact number of candidate words to cycle among (0 = unconstrained). */
  count: number;
}

export interface ResolvedGrid {
  words: ResolvedWord[];
  /** Pre-computed candidate lists per slot (from constraint solver). */
  candidates: string[][];
}

/**
 * A single edit operation on the grid.
 *
 * Shared by both human‑initiated (UI) and AI‑initiated edits so that all
 * mutations flow through the same {@link GridElement.applyEdit} code path.
 */
export interface GridEdit {
  action: "patch" | "clear" | "prepend" | "append" | "pause";
  /** Line index for patch / clear (relative to first non‑blank row). */
  line?: number;
  /** Line index to insert before (prepend). */
  beforeLine?: number;
  /** Line index to insert after (append). */
  afterLine?: number;
  /** Syllable stress pattern, e.g. "01", "1.", "10". */
  syllables?: string;
  /** Rhyme group label: "A"–"G" or "". */
  rhymeGroup?: string;
  /** Literal word or semantic search query. */
  text?: string;
  /** Part of speech filter, e.g. "noun", "verb". */
  pos?: string;
  /** Candidate count (1 = literal, >1 = generative). */
  count?: number;
}
