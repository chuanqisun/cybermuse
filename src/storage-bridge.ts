import type { GridElement } from "./grid/grid-element";
import type { HeaderElement } from "./header/header-element";
import type { StoredSettings } from "./storage";
import { loadGrid, loadSettings, loadWpm, saveGrid, saveSettings, saveWpm } from "./storage";

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

  if (storedGrid) grid.deserialise(storedGrid);
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
