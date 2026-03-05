import { get, set } from "idb-keyval";

/* ------------------------------------------------------------------ */
/*  Storage keys                                                      */
/* ------------------------------------------------------------------ */
const GRID_KEY = "cybermuse:grid";
const SETTINGS_KEY = "cybermuse:settings";
const WPM_KEY = "cybermuse:wpm";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

/** Serialisable representation of a single grid cell. */
export interface StoredCell {
  kind: "cycle" | "text";
  /** For cycle cells: current option index. */
  index?: number;
  /** For cycle cells: typed override value. */
  override?: string;
  /** For text cells: current value. */
  value?: string;
}

/** Serialisable grid snapshot – one array of cells per row. */
export type StoredGrid = StoredCell[][];

export interface StoredSettings {
  geminiApiKey?: string;
}

/* ------------------------------------------------------------------ */
/*  Default values                                                    */
/* ------------------------------------------------------------------ */

export const DEFAULT_WPM = 100;

/* ------------------------------------------------------------------ */
/*  Grid persistence                                                  */
/* ------------------------------------------------------------------ */

export async function saveGrid(grid: StoredGrid): Promise<void> {
  await set(GRID_KEY, grid);
}

export async function loadGrid(): Promise<StoredGrid | undefined> {
  return get<StoredGrid>(GRID_KEY);
}

/* ------------------------------------------------------------------ */
/*  Settings persistence                                              */
/* ------------------------------------------------------------------ */

export async function saveSettings(settings: StoredSettings): Promise<void> {
  await set(SETTINGS_KEY, settings);
}

export async function loadSettings(): Promise<StoredSettings | undefined> {
  return get<StoredSettings>(SETTINGS_KEY);
}

/* ------------------------------------------------------------------ */
/*  WPM persistence                                                   */
/* ------------------------------------------------------------------ */

export async function saveWpm(wpm: number): Promise<void> {
  await set(WPM_KEY, wpm);
}

export async function loadWpm(): Promise<number | undefined> {
  return get<number>(WPM_KEY);
}
