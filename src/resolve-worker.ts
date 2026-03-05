import { resolve } from "./resolver";
import { initVectors, setGeminiApiKey } from "./vectors";

// Initialize the vector database when the worker starts.
initVectors().catch((err) => console.error("resolve-worker: failed to init vectors:", err));

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data;

  switch (type) {
    case "setApiKey":
      setGeminiApiKey(payload as string | undefined);
      break;

    case "resolve": {
      const port = e.ports[0];
      if (!port) {
        console.error("resolve-worker: no MessagePort provided");
        return;
      }
      try {
        const result = await resolve(payload);
        port.postMessage({ ok: true, result });
      } catch (error) {
        port.postMessage({ ok: false, error: String(error) });
      }
      break;
    }
  }
};
