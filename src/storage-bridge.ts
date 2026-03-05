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

  // posOptions index: adjective=1, noun=12
  // letterOptions index: A=1, B=2
  // countOptions index: ""=0, "2"=1, "4"=2, "8"=3; override for non-standard values
  return [
    [c(0), c(0), c(0), c(0), t("cybermuse"), c(0), c(0)],
    [c(0), c(0), c(0), c(0), t("loves"),     c(0), c(0)],
    [c(0), c(0), c(0), c(1), t("romantic"),   c(1), c(2)],         // rhyme=A, pos=adjective, count=4
    [c(0), c(0), c(0), c(1), t("romantic"),   c(1), c(0, "7")],    // rhyme=A, pos=adjective, count=7 (override)
    emptyRow(),                                                      // blank separator
    [c(0), c(0), c(0), c(0), t("it"),         c(0), c(0)],
    [c(0), c(0), c(0), c(0), t("sings"),      c(0), c(0)],
    [c(0), c(0), c(0), c(1), t(""),           c(1), c(0, "5")],    // blank word, rhyme=A, pos=adjective, count=5
    [c(0), c(0), c(0), c(2), t(""),           c(12), c(3)],        // blank word, rhyme=B, pos=noun, count=8
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
