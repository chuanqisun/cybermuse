import type { GridEdit } from "./types";

/* ------------------------------------------------------------------ */
/*  Internal node graph types                                         */
/* ------------------------------------------------------------------ */

interface WarpCoreNodes {
  osc1: OscillatorNode;
  osc2: OscillatorNode;
  filterLfo: OscillatorNode;
  filter: BiquadFilterNode;
  filterLfoGain: GainNode;
  masterGain: GainNode;
  /** Manual beat gate – enveloped on each word utterance for rhythm sync. */
  beatGain: GainNode;
  envGain: GainNode;
  /** Trigger a beat pulse at the given AudioContext time. */
  triggerBeat(audioTime: number, beatDurationSec: number): void;
  /** Smoothly shift the base oscillator frequency. */
  setFrequency(targetFreq: number, rampTime?: number): void;
  /** Fade out and stop all nodes. */
  stop(fadeTime?: number): void;
}

interface CryoChamberNodes {
  osc1: OscillatorNode;
  osc2: OscillatorNode;
  osc3: OscillatorNode;
  lfo: OscillatorNode;
  envGain: GainNode;
  stop(fadeTime?: number): void;
}

interface TranceMelodyNodes {
  /** Trigger the next arpeggio note synced to the word beat. */
  triggerNote(audioTime: number, beatDurationSec: number, energy: number): void;
  /** Update feedback delay time to match the current WPM. */
  setDelayTempo(wpm: number): void;
  /** Fade out and stop all persistent nodes. */
  stop(fadeTime?: number): void;
}

interface PercussionNodes {
  /**
   * Schedule a full beat of percussion hits at the given audio time.
   * Subdivisions (kick, clap, hi-hats) are placed relative to
   * `audioTime` using `beatDurationSec` so everything locks to WPM.
   */
  triggerBeat(audioTime: number, beatDurationSec: number, energy: number, beatCount: number): void;
  /** Fade out the master gain. */
  stop(fadeTime?: number): void;
}

/* ------------------------------------------------------------------ */
/*  BG-1 · Warp Core Throb                                           */
/* ------------------------------------------------------------------ */

/**
 * Creates the Warp Core Throb background layer.
 *
 * The amplitude is NOT modulated by a continuous LFO; instead, a manual
 * `beatGain` node is enveloped on each word utterance via `triggerBeat()`.
 * This guarantees perfect phase-lock between the sonic pulse and the poem
 * rhythm driven by the Scheduler.
 */
function _createWarpCore(ctx: AudioContext, output: AudioNode, oscFrequency = 55): WarpCoreNodes {
  const now = ctx.currentTime;

  const osc1 = ctx.createOscillator();
  osc1.type = "sawtooth";
  osc1.frequency.value = oscFrequency;

  const osc2 = ctx.createOscillator();
  osc2.type = "sawtooth";
  osc2.frequency.value = oscFrequency + 0.5;

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 200;
  filter.Q.value = 8;

  const filterLfo = ctx.createOscillator();
  filterLfo.type = "sine";
  filterLfo.frequency.value = 3;

  const filterLfoGain = ctx.createGain();
  filterLfoGain.gain.value = oscFrequency * 2.7;

  filterLfo.connect(filterLfoGain);
  filterLfoGain.connect(filter.frequency);

  const masterGain = ctx.createGain();
  masterGain.gain.value = 0.2;

  // Beat gate: starts at idle sustain; triggerBeat() envelopes it on each word
  const beatGain = ctx.createGain();
  beatGain.gain.value = 0.3;

  // Fade-in envelope wrapping everything
  const envGain = ctx.createGain();
  envGain.gain.setValueAtTime(0, now);
  envGain.gain.linearRampToValueAtTime(1, now + 0.3);

  osc1.connect(filter);
  osc2.connect(filter);
  filter.connect(masterGain);
  masterGain.connect(beatGain);
  beatGain.connect(envGain);
  envGain.connect(output);

  [osc1, osc2, filterLfo].forEach((o) => o.start(now));

  return {
    osc1,
    osc2,
    filter,
    filterLfo,
    filterLfoGain,
    masterGain,
    beatGain,
    envGain,

    triggerBeat(audioTime: number, beatDurationSec: number) {
      const g = beatGain.gain;
      g.cancelScheduledValues(audioTime);
      // Attack: hit peak on the beat
      g.setValueAtTime(1.0, audioTime);
      // Decay to sustain mid-beat
      g.linearRampToValueAtTime(0.5, audioTime + beatDurationSec * 0.4);
      // Release back to idle near the next beat
      g.linearRampToValueAtTime(0.3, audioTime + beatDurationSec * 0.9);
    },

    setFrequency(targetFreq: number, rampTime = 1.0) {
      const t = ctx.currentTime;
      osc1.frequency.linearRampToValueAtTime(targetFreq, t + rampTime);
      osc2.frequency.linearRampToValueAtTime(targetFreq + 0.5, t + rampTime);
      filterLfoGain.gain.linearRampToValueAtTime(targetFreq * 2.7, t + rampTime);
    },

    stop(fadeTime = 0.8) {
      const t = ctx.currentTime;
      envGain.gain.setValueAtTime(envGain.gain.value, t);
      envGain.gain.linearRampToValueAtTime(0, t + fadeTime);
      const stopAt = t + fadeTime + 0.05;
      [osc1, osc2, filterLfo].forEach((o) => o.stop(stopAt));
    },
  };
}

/* ------------------------------------------------------------------ */
/*  BG-2 · Cryo Chamber Hum                                          */
/* ------------------------------------------------------------------ */

function _createCryoChamber(ctx: AudioContext, output: AudioNode): CryoChamberNodes {
  const now = ctx.currentTime;

  const osc1 = ctx.createOscillator();
  osc1.type = "sine";
  osc1.frequency.value = 100;

  const osc2 = ctx.createOscillator();
  osc2.type = "sine";
  osc2.frequency.value = 150;

  const osc3 = ctx.createOscillator();
  osc3.type = "sine";
  osc3.frequency.value = 200.3;

  const lfo = ctx.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 0.15;

  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 3;

  lfo.connect(lfoGain);
  lfoGain.connect(osc1.frequency);
  lfoGain.connect(osc2.frequency);

  const envGain = ctx.createGain();
  envGain.gain.setValueAtTime(0, now);
  envGain.gain.linearRampToValueAtTime(0.12, now + 1.5);

  [osc1, osc2, osc3].forEach((o) => o.connect(envGain));
  envGain.connect(output);

  [osc1, osc2, osc3, lfo].forEach((o) => o.start(now));

  return {
    osc1,
    osc2,
    osc3,
    lfo,
    envGain,
    stop(fadeTime = 1.5) {
      const t = ctx.currentTime;
      envGain.gain.setValueAtTime(envGain.gain.value, t);
      envGain.gain.linearRampToValueAtTime(0, t + fadeTime);
      const stopAt = t + fadeTime + 0.05;
      [osc1, osc2, osc3, lfo].forEach((o) => o.stop(stopAt));
    },
  };
}

/* ------------------------------------------------------------------ */
/*  BG-3 · Trance Melody Arpeggiator                                  */
/* ------------------------------------------------------------------ */

/**
 * Minor pentatonic scale in semitones from A2 (110 Hz).
 * Spanning ~2 octaves for wide melodic reach.
 *
 * ```
 *   Index:  0   1   2   3   4   5   6   7   8   9  10
 *   Semi :  0   3   5   7  10  12  15  17  19  22  24
 *   Note :  A1  C2  D2  E2  G2  A2  C3  D3  E3  G3  A3
 * ```
 *
 * Uses the same minor pentatonic intervals as the voice
 * {@link PitchContour} (which is rooted on A3) so the arp and
 * the spoken melody are always harmonically coherent.
 */
const MELODY_SCALE_SEMI = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24];
const MELODY_ROOT_HZ = 110; // A2

/**
 * Creates the Trance Melody Arpeggiator background layer.
 *
 * ## Synth architecture
 *
 * Each note is a **detuned supersaw** — three sawtooth oscillators
 * spread ±5 cents apart — giving the classic trance lead shimmer.
 * Notes are routed through a shared resonant lowpass filter with a
 * slow LFO sweep.
 *
 * ## Arpeggiator
 *
 * An up-down ("bounce") pattern walks through the minor pentatonic
 * scale.  The available note range expands with energy:
 *
 * | Energy | Notes available | Character               |
 * | ------ | --------------- | ----------------------- |
 * | 0.0    | 3 (A4–D5)      | Simple motif, meditative |
 * | 0.5    | 6 (A4–A5)      | Lyrical trance melody    |
 * | 1.0    | 11 (full)      | Euphoric wide arp        |
 *
 * ## Beat-synced delay
 *
 * A feedback delay tuned to a dotted-eighth fraction of the beat
 * duration adds the spacious, rhythmic echo characteristic of
 * EDM/trance production.
 *
 * ## Energy-driven modulation
 *
 * - **Gain**: melody kicks in early at energy 0.05 with an audible floor.
 * - **Filter cutoff**: 800 Hz (warm) → 5 500 Hz (bright).
 * - **Filter LFO depth**: widens with energy for dramatic sweeps.
 * - **Delay feedback**: increases from 0.2 → 0.45 for richer echoes.
 */
function _createTranceMelody(ctx: AudioContext, output: AudioNode, wpm: number): TranceMelodyNodes {
  const now = ctx.currentTime;

  // ---- Persistent filter chain ----

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 600;
  filter.Q.value = 7;

  // Classic trance slow-sweep filter LFO
  const filterLfo = ctx.createOscillator();
  filterLfo.type = "sine";
  filterLfo.frequency.value = 0.08; // very slow sweep

  const filterLfoGain = ctx.createGain();
  filterLfoGain.gain.value = 200; // ±200 Hz modulation

  filterLfo.connect(filterLfoGain);
  filterLfoGain.connect(filter.frequency);

  // ---- Master gain (energy-driven) ----

  const masterGain = ctx.createGain();
  masterGain.gain.value = 0; // starts silent, fades in with energy

  // ---- Beat-synced feedback delay ----

  const delay = ctx.createDelay(2.0);
  const beatSec = 60 / Math.max(1, wpm);
  delay.delayTime.value = beatSec * 0.75; // dotted-eighth feel

  const delayFilter = ctx.createBiquadFilter();
  delayFilter.type = "lowpass";
  delayFilter.frequency.value = 2200; // darken repeats

  const feedback = ctx.createGain();
  feedback.gain.value = 0.25;

  // ---- Fade-in envelope ----

  const envGain = ctx.createGain();
  envGain.gain.setValueAtTime(0, now);
  envGain.gain.linearRampToValueAtTime(1, now + 0.5);

  // ---- Signal chain ----
  //
  //  [per-note oscs] → filter → masterGain ─┬→ envGain → output  (dry)
  //                                          └→ delay → delayFilter
  //                                               ↑          ↓
  //                                           feedback ←─────┘
  //                                                           └→ envGain (wet)

  filter.connect(masterGain);
  masterGain.connect(envGain); // dry path
  masterGain.connect(delay); // wet send
  delay.connect(delayFilter);
  delayFilter.connect(feedback);
  feedback.connect(delay); // feedback loop
  delayFilter.connect(envGain); // wet to output
  envGain.connect(output);

  filterLfo.start(now);

  // ---- Arpeggiator state ----

  let arpStep = 0;
  let arpDir = 1;

  return {
    triggerNote(audioTime: number, beatDurationSec: number, energy: number) {
      // Don't play until energy reaches 5%
      if (energy < 0.05) return;

      // Determine available range based on energy (3 notes → full 11)
      const maxIdx = Math.min(MELODY_SCALE_SEMI.length - 1, 2 + Math.floor(energy * (MELODY_SCALE_SEMI.length - 3)));

      // Up-down bounce arpeggiator
      arpStep += arpDir;
      if (arpStep >= maxIdx) {
        arpStep = maxIdx;
        arpDir = -1;
      }
      if (arpStep <= 0) {
        arpStep = 0;
        arpDir = 1;
      }

      const semitones = MELODY_SCALE_SEMI[arpStep];
      const freq = MELODY_ROOT_HZ * Math.pow(2, semitones / 12);

      const noteDur = beatDurationSec * 0.65;

      // ---- Supersaw: 3 detuned sawtooth oscillators ----

      const osc1 = ctx.createOscillator();
      osc1.type = "sawtooth";
      osc1.frequency.setValueAtTime(freq, audioTime);

      const osc2 = ctx.createOscillator();
      osc2.type = "sawtooth";
      osc2.frequency.setValueAtTime(freq * 1.007, audioTime); // +12 cents

      const osc3 = ctx.createOscillator();
      osc3.type = "sawtooth";
      osc3.frequency.setValueAtTime(freq * 0.993, audioTime); // −12 cents

      // ---- Per-note ADSR envelope ----
      const noteGain = ctx.createGain();
      const peakGain = 0.16;
      noteGain.gain.setValueAtTime(0, audioTime);
      noteGain.gain.linearRampToValueAtTime(peakGain, audioTime + 0.008);
      noteGain.gain.linearRampToValueAtTime(peakGain * 0.6, audioTime + noteDur * 0.5);
      noteGain.gain.exponentialRampToValueAtTime(0.001, audioTime + noteDur);

      osc1.connect(noteGain);
      osc2.connect(noteGain);
      osc3.connect(noteGain);
      noteGain.connect(filter);

      osc1.start(audioTime);
      osc2.start(audioTime);
      osc3.start(audioTime);
      const stopAt = audioTime + noteDur + 0.02;
      osc1.stop(stopAt);
      osc2.stop(stopAt);
      osc3.stop(stopAt);

      // ---- Energy-driven modulation (applied each beat) ----

      // Normalise energy above threshold
      const e = Math.min(1, (energy - 0.05) / 0.95);

      // Filter: 400 Hz (warm/bassy) → 3500 Hz (bright)
      filter.frequency.setTargetAtTime(400 + e * 3100, audioTime, 0.1);

      // Master gain: 0.06 → 0.32 (audible from the start)
      masterGain.gain.setTargetAtTime(0.06 + e * 0.26, audioTime, 0.05);

      // Filter LFO: slow 0.08 Hz → faster 0.35 Hz
      filterLfo.frequency.setTargetAtTime(0.08 + e * 0.27, audioTime, 0.2);

      // LFO depth: ±200 Hz → ±1400 Hz
      filterLfoGain.gain.setTargetAtTime(200 + e * 1200, audioTime, 0.2);

      // Delay feedback: 0.20 → 0.45 for richer echoes
      feedback.gain.setTargetAtTime(0.2 + e * 0.25, audioTime, 0.1);
    },

    setDelayTempo(wpm: number) {
      const beat = 60 / Math.max(1, wpm);
      delay.delayTime.setTargetAtTime(beat * 0.75, ctx.currentTime, 0.3);
    },

    stop(fadeTime = 1.2) {
      const t = ctx.currentTime;
      envGain.gain.setValueAtTime(envGain.gain.value, t);
      envGain.gain.linearRampToValueAtTime(0, t + fadeTime);
      const stopAt = t + fadeTime + 0.1;
      filterLfo.stop(stopAt);
    },
  };
}

/* ------------------------------------------------------------------ */
/*  BG-4 · Percussion                                                */
/* ------------------------------------------------------------------ */

/**
 * Creates a beat-synced percussion layer.
 *
 * All hits are synthesised — no samples needed.
 *
 * ## Pattern (per beat)
 *
 * ```
 *   Position    0       0.25      0.5       0.75
 *               |        |        |         |
 *   Kick        X                 X
 *   Clap                          X
 *   Hi-hat      x        x        x         x     (closed)
 *   Open HH                                 x     (energy > 0.5)
 * ```
 *
 * The pattern uses a 4-subdivision grid within each beat.
 *
 * ## Energy-driven modulation
 *
 * | Energy | Behaviour                                     |
 * | ------ | --------------------------------------------- |
 * | < 0.08 | Silent                                        |
 * | 0.08   | Hi-hats only, quiet                           |
 * | 0.20   | Kick enters                                   |
 * | 0.40   | Clap enters                                   |
 * | 0.50   | Open hi-hat on off-beats                       |
 * | 1.00   | Full volume, all elements                      |
 */
function _createPercussion(ctx: AudioContext, output: AudioNode): PercussionNodes {
  const masterGain = ctx.createGain();
  masterGain.gain.value = 0;
  masterGain.connect(output);

  // -- Synthesised kick drum --
  function _kick(t: number, vol: number) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(35, t + 0.07);

    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);

    osc.connect(g);
    g.connect(masterGain);
    osc.start(t);
    osc.stop(t + 0.21);
  }

  // -- Synthesised clap (noise burst + bandpass) --
  function _clap(t: number, vol: number) {
    const bufLen = Math.ceil(ctx.sampleRate * 0.06);
    const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1200;
    bp.Q.value = 1.5;

    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

    src.connect(bp);
    bp.connect(g);
    g.connect(masterGain);
    src.start(t);
    src.stop(t + 0.085);
  }

  // -- Synthesised closed hi-hat (high-passed noise) --
  function _hihat(t: number, vol: number, open: boolean) {
    const dur = open ? 0.12 : 0.04;
    const bufLen = Math.ceil(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = open ? 6000 : 8000;

    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);

    src.connect(hp);
    hp.connect(g);
    g.connect(masterGain);
    src.start(t);
    src.stop(t + dur + 0.01);
  }

  return {
    triggerBeat(audioTime: number, beatDurationSec: number, energy: number, beatCount: number) {
      if (energy < 0.08) return;

      // Normalise energy above threshold
      const e = Math.min(1, (energy - 0.08) / 0.92);

      // Master gain: 0 → 0.55
      masterGain.gain.setTargetAtTime(0.1 + e * 0.45, audioTime, 0.05);

      const sub = beatDurationSec / 4; // subdivision = 16th-note feel

      // -- Hi-hats on every subdivision --
      const hhVol = 0.08 + e * 0.1;
      for (let i = 0; i < 4; i++) {
        const t = audioTime + sub * i;
        // Open hi-hat on the last subdivision when energy is high enough
        const open = i === 3 && energy > 0.5;
        _hihat(t, open ? hhVol * 1.3 : hhVol, open);
      }

      // -- Kick on beats 1 & 3 (subdivisions 0 & 2) --
      if (energy > 0.2) {
        const kickVol = 0.12 + e * 0.14;
        _kick(audioTime, kickVol);
        _kick(audioTime + sub * 2, kickVol * 0.8);
      }

      // -- Clap on beat 3 (subdivision 2) --
      if (energy > 0.4) {
        const clapVol = 0.1 + e * 0.12;
        // Alternate: clap on even beats, skip on odd to avoid monotony
        if (beatCount % 2 === 0) {
          _clap(audioTime + sub * 2, clapVol);
        }
      }
    },

    stop(fadeTime = 0.8) {
      const t = ctx.currentTime;
      masterGain.gain.setValueAtTime(masterGain.gain.value, t);
      masterGain.gain.linearRampToValueAtTime(0, t + fadeTime);
    },
  };
}

/* ------------------------------------------------------------------ */
/*  SFX-1 · Hover Blip                                               */
/* ------------------------------------------------------------------ */

function _playHoverBlip(ctx: AudioContext, output: AudioNode): void {
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = 2400;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.2, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

  osc.connect(gain);
  gain.connect(output);
  osc.start(now);
  osc.stop(now + 0.065);
}

/* ------------------------------------------------------------------ */
/*  SFX-2 · Select Confirm                                           */
/* ------------------------------------------------------------------ */

function _playSelectConfirm(ctx: AudioContext, output: AudioNode): void {
  const now = ctx.currentTime;

  const osc1 = ctx.createOscillator();
  osc1.type = "sine";
  osc1.frequency.value = 800;

  const g1 = ctx.createGain();
  g1.gain.setValueAtTime(0.25, now);
  g1.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

  osc1.connect(g1);
  g1.connect(output);
  osc1.start(now);
  osc1.stop(now + 0.105);

  const osc2 = ctx.createOscillator();
  osc2.type = "sine";
  osc2.frequency.value = 1200;

  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(0, now);
  g2.gain.setValueAtTime(0.25, now + 0.08);
  g2.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

  osc2.connect(g2);
  g2.connect(output);
  osc2.start(now);
  osc2.stop(now + 0.205);
}

/* ------------------------------------------------------------------ */
/*  SFX-3 · Error Buzz                                               */
/* ------------------------------------------------------------------ */

function _playErrorBuzz(ctx: AudioContext, output: AudioNode): void {
  const now = ctx.currentTime;

  const osc1 = ctx.createOscillator();
  osc1.type = "square";
  osc1.frequency.value = 150;

  const osc2 = ctx.createOscillator();
  osc2.type = "square";
  osc2.frequency.value = 155;

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 500;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.2, now);
  gain.gain.setValueAtTime(0.2, now + 0.15);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

  osc1.connect(filter);
  osc2.connect(filter);
  filter.connect(gain);
  gain.connect(output);

  osc1.start(now);
  osc2.start(now);
  osc1.stop(now + 0.305);
  osc2.stop(now + 0.305);
}

/* ------------------------------------------------------------------ */
/*  WPM → oscillator frequency mapping                               */
/* ------------------------------------------------------------------ */

/**
 * Maps WPM to a Warp Core base frequency.
 *
 * Reference table (from sound-design.md):
 * - 30 Hz  → power down / minimal
 * - 40 Hz  → idle / drifting
 * - 55 Hz  → cruising (neutral ~100 WPM)
 * - 70 Hz  → engaging systems (~140 WPM)
 * - 90 Hz  → combat / alert (~180 WPM)
 * - 110 Hz → critical (~220+ WPM)
 */
function wpmToWarpFreq(wpm: number): number {
  // Piecewise interpolation: 60 WPM → 40 Hz, 100 WPM → 55 Hz, 200 WPM → 90 Hz
  if (wpm <= 60) return 40;
  if (wpm <= 100) return 40 + ((wpm - 60) / 40) * 15; // 40 → 55
  if (wpm <= 200) return 55 + ((wpm - 100) / 100) * 35; // 55 → 90
  return Math.min(110, 90 + ((wpm - 200) / 50) * 20); // 90 → 110
}

/* ------------------------------------------------------------------ */
/*  SoundEngine                                                       */
/* ------------------------------------------------------------------ */

/**
 * Standalone sound system decoupled from the Agent.
 *
 * Signal chain:
 *
 * ```
 *   BG oscillators ──► bgBus (GainNode) ──┐
 *                                          ├──► AudioContext.destination
 *   SFX oscillators ──► sfxBus (GainNode)─┘
 * ```
 *
 * The BG and SFX buses are separate gain nodes so that SFX transients
 * never interfere with the background music level, and vice-versa.
 *
 * Beat synchronisation: The Warp Core Throb's amplitude is gated
 * manually via `triggerBeat()` on each word utterance rather than
 * by an autonomous LFO.  This guarantees that every drum-like pulse
 * lands exactly on the beat defined by the Scheduler's WPM.
 */
export class SoundEngine {
  private _ctx: AudioContext | null = null;
  private bgBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private warpCore: WarpCoreNodes | null = null;
  private cryoChamber: CryoChamberNodes | null = null;
  private tranceMelody: TranceMelodyNodes | null = null;
  private percussion: PercussionNodes | null = null;
  private _bgActive = false;
  private _wpm = 100;
  /** Cumulative beat count since background started. */
  private _beatCount = 0;
  /** Energy level 0–1, derived from beat count. */
  private _energy = 0;

  // ---- AudioContext lifecycle ----------------------------------------

  /**
   * Lazily initialises the AudioContext and master gain buses.
   * Must only be called from a user-gesture handler or later
   * (browser autoplay policy).
   */
  private get ctx(): AudioContext {
    if (!this._ctx) {
      this._ctx = new AudioContext();

      // Background music bus – slightly lower than SFX so UI cues cut through
      this.bgBus = this._ctx.createGain();
      this.bgBus.gain.value = 0.75;
      this.bgBus.connect(this._ctx.destination);

      // SFX bus – full level for UI feedback clarity
      this.sfxBus = this._ctx.createGain();
      this.sfxBus.gain.value = 1.0;
      this.sfxBus.connect(this._ctx.destination);
    }
    // Recover from browser-suspended context (e.g. tab hidden then shown)
    if (this._ctx.state === "suspended") {
      void this._ctx.resume();
    }
    return this._ctx;
  }

  // ---- Background music -----------------------------------------------

  /** Start both background layers. Safe to call when already running. */
  startBackground(): void {
    if (this._bgActive) return;
    this._bgActive = true;
    const ctx = this.ctx;
    const bg = this.bgBus!;
    const initFreq = wpmToWarpFreq(this._wpm);
    this.warpCore = _createWarpCore(ctx, bg, initFreq);
    this.cryoChamber = _createCryoChamber(ctx, bg);
    this.tranceMelody = _createTranceMelody(ctx, bg, this._wpm);
    this.percussion = _createPercussion(ctx, bg);
  }

  /** Fade out and stop both background layers. */
  stopBackground(): void {
    if (!this._bgActive) return;
    this._bgActive = false;
    this.warpCore?.stop();
    this.cryoChamber?.stop();
    this.tranceMelody?.stop();
    this.percussion?.stop();
    this.warpCore = null;
    this.cryoChamber = null;
    this.tranceMelody = null;
    this.percussion = null;
    this._beatCount = 0;
    this._energy = 0;
  }

  // ---- WPM & beat sync ------------------------------------------------

  /**
   * Update the playback tempo.  Adjusts the Warp Core oscillator
   * frequency so the timbral tension tracks the poem's pace.
   */
  setWpm(wpm: number): void {
    this._wpm = Math.max(1, wpm);
    if (this.warpCore) {
      const targetFreq = wpmToWarpFreq(this._wpm);
      this.warpCore.setFrequency(targetFreq, 2.0);
    }
    this.tranceMelody?.setDelayTempo(this._wpm);
  }

  /**
   * Call this every time a non-blank word is uttered by the Scheduler.
   *
   * Triggers the Warp Core beat gate at the current audio clock time,
   * locking the rhythmic pulse to the poem playback beat.
   *
   * Also advances the energy level and modulates trance parameters:
   * - Filter LFO rate ramps from 3 Hz → 7 Hz
   * - Cryo Chamber gain rises from 0.12 → 0.20
   * - A subtle sine-sweep trance kick fades in above 10 % energy
   */
  onWordBeat(): void {
    if (!this.warpCore || !this._ctx) return;

    this._beatCount++;
    // Energy reaches 1.0 after (~30 sec at 100 WPM)
    this._energy = Math.min(1, this._beatCount / 50);

    const beatDurationSec = 60 / this._wpm;
    this.warpCore.triggerBeat(this._ctx.currentTime, beatDurationSec);

    // --- Energy-driven modulation ---

    // Filter LFO: 3 Hz (calm) → 7 Hz (frantic)
    this.warpCore.filterLfo.frequency.value = 3 + this._energy * 4;

    // Cryo Chamber gain: 0.12 (ambient) → 0.20 (present)
    if (this.cryoChamber) {
      this.cryoChamber.envGain.gain.value = 0.12 + this._energy * 0.08;
    }

    // Trance melody arpeggiator: kicks in above 5 % energy
    this.tranceMelody?.triggerNote(this._ctx.currentTime, beatDurationSec, this._energy);

    // Percussion: beat-synced kick / clap / hi-hat pattern
    this.percussion?.triggerBeat(this._ctx.currentTime, beatDurationSec, this._energy, this._beatCount);
  }

  /**
   * Call on blank / rest rows.  Treats blanks identically to filled
   * words so the melody and rhythm play straight through pauses.
   */
  onBlankBeat(): void {
    if (!this.warpCore || !this._ctx) return;

    this._beatCount++;
    this._energy = Math.min(1, this._beatCount / 50);

    const beatDurationSec = 60 / this._wpm;
    this.warpCore.triggerBeat(this._ctx.currentTime, beatDurationSec);

    this.warpCore.filterLfo.frequency.value = 3 + this._energy * 4;

    if (this.cryoChamber) {
      this.cryoChamber.envGain.gain.value = 0.12 + this._energy * 0.08;
    }

    this.tranceMelody?.triggerNote(this._ctx.currentTime, beatDurationSec, this._energy);
    this.percussion?.triggerBeat(this._ctx.currentTime, beatDurationSec, this._energy, this._beatCount);
  }

  /** Current energy level (0–1). Useful for driving external systems
   *  like the pitch contour or visual effects. */
  get currentEnergy(): number {
    return this._energy;
  }

  // ---- SFX ------------------------------------------------------------

  /** AI edited a cycle/button field (syllables, rhymeGroup, pos, count) or performed a structural action. */
  playHoverBlip(): void {
    _playHoverBlip(this.ctx, this.sfxBus!);
  }

  /** AI edited the text input field. */
  playSelectConfirm(): void {
    _playSelectConfirm(this.ctx, this.sfxBus!);
  }

  /** AI generation error occurred. */
  playErrorBuzz(): void {
    _playErrorBuzz(this.ctx, this.sfxBus!);
  }

  /**
   * Classify an agent `GridEdit` and play the matching SFX automatically.
   *
   * - `edit.text` is defined → Select Confirm (text input was written)
   * - anything else          → Hover Blip    (button/cycle field changed)
   */
  playEditSound(edit: GridEdit): void {
    if (edit.text !== undefined) {
      this.playSelectConfirm();
    } else {
      this.playHoverBlip();
    }
  }

  // ---- Teardown -------------------------------------------------------

  /** Stop all sounds and release the AudioContext. */
  destroy(): void {
    this.stopBackground();
    void this._ctx?.close();
    this._ctx = null;
    this.bgBus = null;
    this.sfxBus = null;
  }
}
