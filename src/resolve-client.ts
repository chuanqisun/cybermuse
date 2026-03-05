import type { GridWord, ResolvedGrid } from "./types";

let worker: Worker | null = null;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./resolve-worker.ts", import.meta.url), { type: "module" });
  }
  return worker;
}

/** Forward a Gemini API key to the resolve worker. */
export function setResolveWorkerApiKey(key: string | undefined): void {
  getWorker().postMessage({ type: "setApiKey", payload: key });
}

/**
 * Resolve grid words via the web worker.
 *
 * Uses a one-shot {@link MessageChannel} so that each call gets its own
 * dedicated response port (no multiplexing needed).
 */
export function resolveViaWorker(gridWords: GridWord[]): Promise<ResolvedGrid> {
  return new Promise((resolve, reject) => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = (e: MessageEvent) => {
      port1.close();
      if (e.data.ok) {
        resolve(e.data.result as ResolvedGrid);
      } else {
        reject(new Error(e.data.error as string));
      }
    };
    getWorker().postMessage({ type: "resolve", payload: gridWords }, [port2]);
  });
}
