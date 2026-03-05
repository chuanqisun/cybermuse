import { BehaviorSubject } from "rxjs";
import { Agent, createGeminiGenerator } from "./agent";
import "./grid/grid-element";
import { GridElement } from "./grid/grid-element";
import { HeaderElement } from "./header/header-element";
import { HelpElement } from "./help/help-element";
import { PitchContour } from "./pitch-contour";
import { resolveViaWorker, setResolveWorkerApiKey } from "./resolve-client";
import { countCandidates } from "./sampler";
import { Scheduler } from "./scheduler";
import { SoundEngine } from "./sound-engine";
import { initStorageBridge } from "./storage-bridge";
import "./style.css";
import type { SynthStatus } from "./synthesizer";
import { Synthesizer } from "./synthesizer";
import { Transcriber } from "./transcriber";
import type { ResolvedGrid } from "./types";
import { initVoice, stopVoice } from "./voice";

GridElement.define();
HeaderElement.define();
HelpElement.define();

const grid = document.querySelector<GridElement>("grid-element");
const header = document.querySelector<HeaderElement>("header-element");
const help = new HelpElement();
const resolvedPattern = new BehaviorSubject<ResolvedGrid | null>(null);
const transcriber = new Transcriber();
let playing = false;

const soundEngine = new SoundEngine();
const pitchContour = new PitchContour();

const synthesizer = new Synthesizer({
  onStatusChange(statuses) {
    const statusMap = new Map<number, SynthStatus>();
    for (const entry of statuses) {
      statusMap.set(entry.slotIndex, entry.status);
    }
    grid?.setSynthStatuses(statusMap);
  },
});

const scheduler = new Scheduler({
  onWord(word, index) {
    grid?.highlight(index, word || undefined);
    transcriber.addWord(word);
    if (word) {
      // Feed energy into the pitch contour so range widens with complexity
      pitchContour.setEnergy(soundEngine.currentEnergy);
      const rate = pitchContour.next();
      synthesizer.playWord(word, rate);
      // Sync Warp Core beat to each spoken word
      soundEngine.onWordBeat();
    } else {
      // Blank row — let the pitch contour breathe
      pitchContour.onPause();
      // Keep the trance melody playing through blanks
      soundEngine.onBlankBeat();
    }
  },
  onLoopEnd() {
    transcriber.lineBreak();
  },
});

resolvedPattern.subscribe((resolved) => {
  if (resolved) {
    scheduler.setGrid(resolved);
    // Kick off synthesis for all candidate words
    const slotIndices = resolved.words.map((w) => w.index);
    synthesizer.synthesizeGrid(resolved.candidates, slotIndices);
  }
});

if (grid && header) {
  header.setGrid(grid);
  header.setHelp(help);

  // Wire up storage bridge (hydrates grid & header from IndexedDB)
  initStorageBridge(grid, header)
    .then(({ isFirstVisit }) => {
      if (isFirstVisit) help.open();
    })
    .catch((err) => console.error("Failed to init storage:", err));
}

function applyResolved(resolved: ResolvedGrid) {
  resolvedPattern.next(resolved);
  const counts = new Map<number, number>();
  for (const w of resolved.words) {
    if (!w.blank) counts.set(w.index, countCandidates(w));
  }
  grid?.setResolvedCounts(counts);
}

// Eval button — manually re-resolve the grid (immediate, human-triggered)
document.addEventListener("header-eval", () => {
  if (!grid) return;
  const words = grid.getWords();
  resolveViaWorker(words)
    .then(applyResolved)
    .catch((err) => console.error("Failed to resolve grid:", err));
});

// Clear button
document.addEventListener("header-clear", () => {
  grid?.clear();
  stopPlay();
  transcriber.reset();
  playing = false;
});

function startPlay() {
  if (!grid) return;

  // Always re-evaluate patterns with the latest grid data (immediate, human-triggered)
  const words = grid.getWords();
  resolveViaWorker(words)
    .then(applyResolved)
    .catch((err) => console.error("Failed to resolve grid:", err));

  if (playing) return; // already playing — just re-resolved above
  playing = true;
  transcriber.start();
  header?.externalStart();
  const peek = scheduler.peekNext();
  if (peek?.word) {
    synthesizer.ensureSynthesized(peek.word);
  }
  scheduler.start();
}

function stopPlay() {
  if (!playing) return;
  playing = false;
  scheduler.stop();
  stopVoice();
  transcriber.stop();
  pitchContour.reset();
  console.log("Transcript:", transcriber.toString());
  header?.externalStop();
  // Stopping playback also stops the agent and turns off auto mode
  stopAgent();
  header?.externalAutoOff();
}

header?.addEventListener("player-start", () => startPlay());
header?.addEventListener("player-stop", () => stopPlay());

// Wire WPM changes to the scheduler
if (header) {
  scheduler.setWpm(header.getWpm());
  soundEngine.setWpm(header.getWpm());
}
document.addEventListener("wpm-change", ((e: CustomEvent<number>) => {
  scheduler.setWpm(e.detail);
  soundEngine.setWpm(e.detail);
}) as EventListener);

// Keyboard shortcuts: mod-enter to play/re-evaluate, mod-shift-enter to stop
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    if (e.shiftKey) {
      stopPlay();
    } else {
      startPlay();
    }
  }
});

// Initialize voice (non-blocking). Vector DB is initialized by the resolve worker.
initVoice().catch((err) => console.error("Failed to initialize voice:", err));

// Propagate Gemini API key to the resolve worker whenever settings load or change.
// This listener is intentionally never removed; it lives for the full page lifetime.
document.addEventListener("settings-change", ((e: CustomEvent<{ geminiApiKey?: string }>) => {
  setResolveWorkerApiKey(e.detail.geminiApiKey);
}) as EventListener);

/* ------------------------------------------------------------------ */
/*  Agent                                                             */
/* ------------------------------------------------------------------ */

/** Debounce delay for agent-triggered resolves (ms). */
const AGENT_RESOLVE_DEBOUNCE_MS = 100;
let agentResolveTimer: ReturnType<typeof setTimeout> | null = null;

/** Schedule a debounced resolve after an agent edit. */
function scheduleAgentResolve() {
  if (agentResolveTimer !== null) clearTimeout(agentResolveTimer);
  agentResolveTimer = setTimeout(() => {
    agentResolveTimer = null;
    if (!grid) return;
    const words = grid.getWords();
    resolveViaWorker(words)
      .then(applyResolved)
      .catch((err) => console.error("Agent resolve error:", err));
  }, AGENT_RESOLVE_DEBOUNCE_MS);
}

/** Cancel any pending agent resolve. */
function cancelAgentResolve() {
  if (agentResolveTimer !== null) {
    clearTimeout(agentResolveTimer);
    agentResolveTimer = null;
  }
}

let agent: Agent | null = null;

/**
 * Start the AI agent. Creates the agent if necessary, using the
 * current API key from settings.  The agent's onEdit callback goes
 * through the same {@link GridElement.applyEdit} path as any other
 * programmatic edit, keeping the code path shared.
 */
function startAgent() {
  if (!grid) return;

  const apiKey = header?.getSettings().geminiApiKey;
  if (!apiKey) {
    console.warn("Cannot start agent: no Gemini API key configured.");
    header?.externalAutoOff();
    return;
  }

  // Re‑create agent so it picks up the latest API key
  agent?.destroy();
  agent = new Agent({
    generate: createGeminiGenerator(apiKey),
    getGridWords: () => grid!.getWords(),
    getTranscript: () => transcriber.toString(),
    onEdit: (edit) => {
      const changed = grid!.blinkEdit(edit);
      grid!.applyEdit(edit);
      if (changed) soundEngine.playEditSound(edit);
      // Debounce resolve after agent edits to avoid rapid-fire re-resolves
      scheduleAgentResolve();
    },
    onGenerationError: () => {
      soundEngine.playErrorBuzz();
    },
  });
  agent.start();
  soundEngine.startBackground();
  // Starting the agent also starts playback
  startPlay();
}

function stopAgent() {
  agent?.stop();
  cancelAgentResolve();
  soundEngine.stopBackground();
}

document.addEventListener("agent-start", () => startAgent());
document.addEventListener("agent-stop", () => stopAgent());
