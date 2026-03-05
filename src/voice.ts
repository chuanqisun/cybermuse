declare const meSpeak: {
  loadVoice(url: string, callback?: (success: boolean) => void): void;
  speak(
    text: string,
    options?: {
      pitch?: number;
      speed?: number;
      amplitude?: number;
      wordgap?: number;
      nostop?: boolean;
      rawdata?: boolean | string;
    },
    callback?: (success: boolean, id: number, stream: ArrayBuffer) => void,
  ): number;
  play(
    stream: ArrayBuffer,
    relativeVolume?: number,
    callback?: ((success: boolean) => void) | null,
    id?: number,
  ): number;
  stop(id?: number): void;
};

let initialized = false;
let lastSpeechId = 0;

/** Lazy AudioContext for pitch-shifted playback via Web Audio API. */
let voiceCtx: AudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;

function getVoiceCtx(): AudioContext {
  if (!voiceCtx) voiceCtx = new AudioContext();
  if (voiceCtx.state === "suspended") void voiceCtx.resume();
  return voiceCtx;
}

export async function initVoice(): Promise<void> {
  if (initialized) return;
  if (typeof meSpeak === "undefined") {
    console.warn("meSpeak not loaded");
    return;
  }

  return new Promise<void>((resolve) => {
    meSpeak.loadVoice("en/en", (success) => {
      if (success) {
        initialized = true;
      } else {
        console.warn("meSpeak voice loading failed");
      }
      resolve();
    });
  });
}

/**
 * Generate a WAV audio buffer without playing it.
 * Returns null if meSpeak is not available.
 *
 * @param text        Text to synthesize.
 * @param pitchOffset Pitch offset in abstract units; each unit shifts pitch by 15
 *                    (meSpeak range 0–99, default 50). Practical range ~-3 to +3.
 * @param speed       Words per minute, clamped to 80–450 (default 175).
 */
export function generateBuffer(text: string, pitchOffset = 0, speed = 175): Promise<ArrayBuffer | null> {
  if (!initialized || typeof meSpeak === "undefined") {
    return Promise.resolve(null);
  }

  const pitch = Math.max(0, Math.min(99, 50 + pitchOffset * 15));
  const clampedSpeed = Math.max(80, Math.min(450, speed));

  return new Promise((resolve) => {
    meSpeak.speak(
      text,
      {
        pitch,
        speed: clampedSpeed,
        amplitude: 100,
        nostop: true,
        rawdata: true,
      },
      (success, _id, stream) => {
        resolve(success ? stream : null);
      },
    );
  });
}

/**
 * Play a pre-generated audio buffer at the original pitch.
 */
export function playBuffer(buffer: ArrayBuffer): void {
  if (!initialized || typeof meSpeak === "undefined") return;

  if (lastSpeechId > 0) {
    meSpeak.stop(lastSpeechId);
  }

  // Clone the buffer so the cached original isn't detached by decodeAudioData()
  lastSpeechId = meSpeak.play(buffer.slice(0));
}

/**
 * Play a pre-generated audio buffer with pitch shifting.
 *
 * Uses the Web Audio API to decode the WAV and play through an
 * {@link AudioBufferSourceNode} whose `playbackRate` shifts the pitch.
 *
 * @param buffer       Cached WAV ArrayBuffer from {@link generateBuffer}.
 * @param playbackRate Pitch multiplier.  1.0 = original,
 *                     >1 = higher & faster, <1 = lower & slower.
 *                     Practical range: ~0.75 – 1.50.
 */
export function playBufferPitched(buffer: ArrayBuffer, playbackRate = 1.0): void {
  // Fall back to legacy path for unity rate
  if (playbackRate === 1.0) {
    playBuffer(buffer);
    return;
  }

  const ctx = getVoiceCtx();

  // Stop any previous pitched playback
  if (currentSource) {
    try {
      currentSource.stop();
    } catch {
      /* already stopped */
    }
    currentSource = null;
  }
  // Also stop any meSpeak playback to avoid overlap
  if (lastSpeechId > 0 && typeof meSpeak !== "undefined") {
    meSpeak.stop(lastSpeechId);
    lastSpeechId = 0;
  }

  // Clone — decodeAudioData detaches the underlying ArrayBuffer
  const clone = buffer.slice(0);

  ctx
    .decodeAudioData(clone)
    .then((audioBuffer) => {
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.playbackRate.value = playbackRate;
      source.connect(ctx.destination);
      source.start();
      currentSource = source;
      source.onended = () => {
        if (currentSource === source) currentSource = null;
      };
    })
    .catch((err) => {
      console.warn("Failed to decode audio buffer for pitched playback:", err);
    });
}

export function stopVoice(): void {
  if (typeof meSpeak !== "undefined" && initialized) {
    meSpeak.stop();
    lastSpeechId = 0;
  }
  // Also stop any pitched Web Audio source
  if (currentSource) {
    try {
      currentSource.stop();
    } catch {
      /* already stopped */
    }
    currentSource = null;
  }
}
