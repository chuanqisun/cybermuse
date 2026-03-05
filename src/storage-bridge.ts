import type { GridElement } from "./grid/grid-element";
import type { HeaderElement } from "./header/header-element";
import type { StoredCell, StoredGrid, StoredSettings } from "./storage";
import { loadGrid, loadSettings, loadWpm, saveGrid, saveSettings, saveWpm } from "./storage";

/**
 * Default poem loaded when no stored grid exists.
 *
 * cybermuse
 * loves
 * romantic  (rhyme=A, pos=adjective, n=4)
 * romantic  (rhyme=A, pos=adjective, n=7)
 * (blank separator)
 * it
 * sings
 * (blank)   (rhyme=A, pos=adjective, n=5)
 * (blank)   (rhyme=B, pos=noun, n=8)
 *
 * Cell order per row: [syl0, syl1, syl2, rhyme, text, pos, count]
 */
function buildDefaultGrid(): StoredGrid {
  const c = (index: number, override?: string): StoredCell => ({ kind: "cycle", index, ...(override !== undefined ? { override } : {}) });
  const t = (value: string): StoredCell => ({ kind: "text", value });
  const emptyRow = (): StoredCell[] => [c(0), c(0), c(0), c(0), t(""), c(0), c(0)];

  // Indices into the option arrays defined in grid-element.ts:
  // letterOptions: A=1, B=2
  const RHYME_A = 1;
  const RHYME_B = 2;
  // posOptions: adjective=1, noun=12
  const POS_ADJECTIVE = 1;
  const POS_NOUN = 12;
  // countOptions: "4"=2, "8"=3; non-standard values (5, 7) use override
  const COUNT_4 = 2;
  const COUNT_8 = 3;

  return [
    [c(0), c(0), c(0), c(0),       t("cybermuse"), c(0),            c(0)],
    [c(0), c(0), c(0), c(0),       t("loves"),     c(0),            c(0)],
    [c(0), c(0), c(0), c(RHYME_A), t("romantic"),   c(POS_ADJECTIVE), c(COUNT_4)],
    [c(0), c(0), c(0), c(RHYME_A), t("romantic"),   c(POS_ADJECTIVE), c(0, "7")],
    emptyRow(),
    [c(0), c(0), c(0), c(0),       t("it"),         c(0),            c(0)],
    [c(0), c(0), c(0), c(0),       t("sings"),      c(0),            c(0)],
    [c(0), c(0), c(0), c(RHYME_A), t(""),           c(POS_ADJECTIVE), c(0, "5")],
    [c(0), c(0), c(0), c(RHYME_B), t(""),           c(POS_NOUN),     c(COUNT_8)],
  ];
}

/**
 * Storage bridge — listens for DOM events from UI components and persists
 * state to IndexedDB via the storage module. On initialisation it hydrates
 * components with any previously-stored data.
 *
 * Components never import storage directly; they only emit events.
 * This keeps the persistence logic in one place and the UI layer pure.
 */
export async function initStorageBridge(grid: GridElement, header: HeaderElement): Promise<void> {
  // ---- Hydrate from stored state --------------------------------
  const [storedGrid, storedWpm, storedSettings] = await Promise.all([loadGrid(), loadWpm(), loadSettings()]);

  if (storedGrid) {
    grid.deserialise(storedGrid);
  } else {
    grid.deserialise(buildDefaultGrid());
  }
  if (storedWpm !== undefined) header.setWpm(storedWpm);
  if (storedSettings) {
    header.setSettings(storedSettings);
    document.dispatchEvent(new CustomEvent("settings-change", { detail: { ...storedSettings } }));
  }

  // ---- Listen for changes and persist ---------------------------

  // Grid form data
  grid.addEventListener("grid-change", () => {
    saveGrid(grid.serialise());
  });

  // Clear → wipe stored grid
  document.addEventListener("header-clear", () => {
    saveGrid([]);
  });

  // WPM
  document.addEventListener("wpm-change", ((e: CustomEvent<number>) => {
    saveWpm(e.detail);
  }) as EventListener);

  // Settings
  document.addEventListener("settings-change", ((e: CustomEvent<StoredSettings>) => {
    saveSettings(e.detail);
  }) as EventListener);
}
