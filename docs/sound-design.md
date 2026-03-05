```markdown
# Sound Design Reference — Sci-Fi UI

## Overview

This document defines the canonical sound design for the project.
Three background atmospheres run concurrently as ambient layers.
Three UI sound effects are used for interaction feedback.

---

## Background Sounds

### BG-1 · Warp Core Throb

**Role:** Primary rhythmic engine layer. Low, pumping, mechanical.

**Synthesis Method:** Dual detuned sawtooth oscillators → lowpass filter with resonant LFO → amplitude square-wave LFO for pumping feel.

**Parameters:**

| Parameter        | Value         | Notes                        |
| ---------------- | ------------- | ---------------------------- |
| Osc 1 Frequency  | 55 Hz         | Base pitch                   |
| Osc 2 Frequency  | 55.5 Hz       | Slight detune for beating    |
| Osc Type         | Sawtooth      | Harmonically rich            |
| Filter Type      | Lowpass       | Cuts high content            |
| Filter Frequency | 200 Hz (base) | Modulated by LFO             |
| Filter Q         | 8             | High resonance for character |
| Filter LFO Rate  | 3 Hz          | Rhythmic filter sweep        |
| Filter LFO Depth | ±150 Hz       | Sweep range                  |
| Amp LFO Type     | Square        | Hard pump gating             |
| Amp LFO Rate     | 1.5 Hz        | Pump tempo                   |
| Amp LFO Depth    | ±0.25         | Gain modulation range        |
| Master Gain      | 0.2           | Pre-envelope level           |
| Attack           | 0.3 s         | Fade in                      |
| Release          | 0.8 s         | Fade out                     |

**Dynamic Frequency Control:**

The oscillator base frequency (`oscFrequency`) is the primary dynamic parameter.
Modulate this at runtime to shift the perceived pitch and tension of the engine.
```

oscFrequency: 55 Hz → neutral / cruising
oscFrequency: 35–45 Hz → low tension / power down
oscFrequency: 65–90 Hz → high tension / acceleration
oscFrequency: 110 Hz → alarm / critical state

```

The detune offset on Osc 2 should track Osc 1:
```

osc2.frequency = oscFrequency + 0.5

```

The filter LFO depth can also scale proportionally with frequency
to maintain timbral consistency across pitch ranges:
```

filterLFODepth = oscFrequency \* 2.7

````

**Reference Implementation (Web Audio API):**

```javascript
function createWarpCoreThrob(audioCtx, oscFrequency = 55) {
  const now = audioCtx.currentTime;

  const osc1 = audioCtx.createOscillator();
  osc1.type = 'sawtooth';
  osc1.frequency.value = oscFrequency;

  const osc2 = audioCtx.createOscillator();
  osc2.type = 'sawtooth';
  osc2.frequency.value = oscFrequency + 0.5;

  const filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 200;
  filter.Q.value = 8;

  const filterLfo = audioCtx.createOscillator();
  filterLfo.type = 'sine';
  filterLfo.frequency.value = 3;

  const filterLfoGain = audioCtx.createGain();
  filterLfoGain.gain.value = oscFrequency * 2.7; // scales with pitch

  filterLfo.connect(filterLfoGain);
  filterLfoGain.connect(filter.frequency);

  const ampLfo = audioCtx.createOscillator();
  ampLfo.type = 'square';
  ampLfo.frequency.value = 1.5;

  const ampLfoGain = audioCtx.createGain();
  ampLfoGain.gain.value = 0.25;

  const masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.2;

  ampLfo.connect(ampLfoGain);
  ampLfoGain.connect(masterGain.gain);

  const envGain = audioCtx.createGain();
  envGain.gain.setValueAtTime(0, now);
  envGain.gain.linearRampToValueAtTime(1, now + 0.3);

  osc1.connect(filter);
  osc2.connect(filter);
  filter.connect(masterGain);
  masterGain.connect(envGain);
  envGain.connect(audioCtx.destination);

  [osc1, osc2, filterLfo, ampLfo].forEach(o => o.start(now));

  // Return node refs for live modulation
  return {
    osc1,
    osc2,
    filter,
    filterLfo,
    filterLfoGain,
    ampLfo,
    masterGain,
    envGain,

    /**
     * Smoothly shift the base oscillator frequency at runtime.
     * @param {number} targetFreq  - Target frequency in Hz
     * @param {number} rampTime    - Transition duration in seconds
     */
    setFrequency(targetFreq, rampTime = 1.0) {
      const t = audioCtx.currentTime;
      osc1.frequency.linearRampToValueAtTime(targetFreq, t + rampTime);
      osc2.frequency.linearRampToValueAtTime(targetFreq + 0.5, t + rampTime);
      filterLfoGain.gain.linearRampToValueAtTime(targetFreq * 2.7, t + rampTime);
    },

    /**
     * Fade out and stop all nodes.
     * @param {number} fadeTime - Duration of fade in seconds
     */
    stop(fadeTime = 0.8) {
      const t = audioCtx.currentTime;
      envGain.gain.setValueAtTime(envGain.gain.value, t);
      envGain.gain.linearRampToValueAtTime(0, t + fadeTime);
      [osc1, osc2, filterLfo, ampLfo].forEach(o => o.stop(t + fadeTime + 0.05));
    }
  };
}
````

**Usage Example:**

```javascript
const ctx = new AudioContext();
const throb = createWarpCoreThrob(ctx, 55);

// Later — shift to high tension over 2 seconds
throb.setFrequency(90, 2.0);

// Later — power down
throb.setFrequency(35, 3.5);

// Stop
throb.stop(1.2);
```

---

### BG-2 · Cryo Chamber Hum

**Role:** Secondary tonal layer. Cold, static, harmonic drone.

**Synthesis Method:** Three sine oscillators tuned to a harmonic series with slight detuning on the third → slow sine LFO on pitch for organic drift.

**Parameters:**

| Parameter       | Value    | Notes                     |
| --------------- | -------- | ------------------------- |
| Osc 1 Frequency | 100 Hz   | Root                      |
| Osc 2 Frequency | 150 Hz   | Perfect fifth harmonic    |
| Osc 3 Frequency | 200.3 Hz | Octave + slight detune    |
| Osc Type        | Sine     | Pure, cold tone           |
| LFO Rate        | 0.15 Hz  | Very slow pitch drift     |
| LFO Depth       | ±3 Hz    | Subtle organic movement   |
| Master Gain     | 0.12     | Quiet background presence |
| Attack          | 1.5 s    | Slow fade in              |
| Release         | 1.5 s    | Slow fade out             |

**Reference Implementation (Web Audio API):**

```javascript
function createCryoChamberHum(audioCtx) {
  const now = audioCtx.currentTime;

  const osc1 = audioCtx.createOscillator();
  osc1.type = "sine";
  osc1.frequency.value = 100;

  const osc2 = audioCtx.createOscillator();
  osc2.type = "sine";
  osc2.frequency.value = 150;

  const osc3 = audioCtx.createOscillator();
  osc3.type = "sine";
  osc3.frequency.value = 200.3;

  const lfo = audioCtx.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 0.15;

  const lfoGain = audioCtx.createGain();
  lfoGain.gain.value = 3;

  lfo.connect(lfoGain);
  lfoGain.connect(osc1.frequency);
  lfoGain.connect(osc2.frequency);

  const envGain = audioCtx.createGain();
  envGain.gain.setValueAtTime(0, now);
  envGain.gain.linearRampToValueAtTime(0.12, now + 1.5);

  [osc1, osc2, osc3].forEach((o) => o.connect(envGain));
  envGain.connect(audioCtx.destination);

  [osc1, osc2, osc3, lfo].forEach((o) => o.start(now));

  return {
    osc1,
    osc2,
    osc3,
    lfo,
    lfoGain,
    envGain,

    stop(fadeTime = 1.5) {
      const t = audioCtx.currentTime;
      envGain.gain.setValueAtTime(envGain.gain.value, t);
      envGain.gain.linearRampToValueAtTime(0, t + fadeTime);
      [osc1, osc2, osc3, lfo].forEach((o) => o.stop(t + fadeTime + 0.05));
    },
  };
}
```

---

### BG-3 · Trance Melody Arpeggiator

**Role:** Melodic lead layer. EDM/trance-inspired arpeggio that evolves with the poem's energy.

**Synthesis Method:** Three detuned sawtooth oscillators (supersaw) per note → shared resonant lowpass filter with slow LFO sweep → beat-synced feedback delay.

**Harmonic Design:**

Minor pentatonic scale rooted on A4 (440 Hz), spanning ~2 octaves. Same interval set as the voice PitchContour (rooted on A3) so the arp melody is always harmonically coherent with the spoken pitch.

```
  Index:  0   1   2   3   4   5   6   7   8   9  10
  Semi :  0   3   5   7  10  12  15  17  19  22  24
  Note :  A4  C5  D5  E5  G5  A5  C6  D6  E6  G6  A6
```

**Arpeggiator Pattern:** Up-down bounce through the available scale range, which expands with energy level.

**Parameters:**

| Parameter              | Value (min → max) | Driven by            |
| ---------------------- | ----------------- | -------------------- |
| Root Frequency         | 440 Hz (A4)       | Fixed                |
| Osc Type               | Sawtooth ×3       | Fixed (supersaw)     |
| Detune Spread          | ±7 cents          | Fixed                |
| Filter Type            | Lowpass           | Fixed                |
| Filter Frequency       | 600 → 5 000 Hz    | Energy               |
| Filter Q               | 5                 | Fixed                |
| Filter LFO Rate        | 0.08 → 0.35 Hz    | Energy               |
| Filter LFO Depth       | ±200 → ±1 400 Hz  | Energy               |
| Master Gain            | 0 → 0.18          | Energy (starts ≥15%) |
| Note Duration          | 65% of beat       | Fixed ratio          |
| Note Attack            | 8 ms              | Fixed                |
| Delay Time             | beat × 0.75       | WPM (dotted-eighth)  |
| Delay Feedback         | 0.20 → 0.45       | Energy               |
| Delay Filter           | 2 200 Hz LP       | Fixed                |
| Energy Threshold       | 15%               | ~30 beats            |
| Notes Available (low)  | 3 (A4–D5)         | Energy = 0.15        |
| Notes Available (mid)  | 6 (A4–A5)         | Energy = 0.5         |
| Notes Available (full) | 11 (A4–A6)        | Energy = 1.0         |

**Energy Evolution:**

| Energy | Behaviour                                         |
| ------ | ------------------------------------------------- |
| < 0.15 | Silent — no melody                                |
| 0.15   | Fades in: simple 3-note motif, dark filter        |
| 0.50   | Lyrical 6-note arp, filter opening, delay grows   |
| 1.00   | Euphoric full-range arp, bright filter, rich echo |

**Signal Chain:**

```
BG-3 Trance Melody Arpeggiator
─────────────────────────────────────────────────────
[Per-note Supersaw ×3] ──► Lowpass Filter (600–5kHz, Q5)
                                    ▲
                           FilterLFO (sine 0.08–0.35Hz)
                           × LFOGain (200–1400)
                                    │
                           ──► MasterGain (0–0.18) ─┬──► EnvGain ──► bgBus (dry)
                                                     │
                                                     └──► Delay (beat×0.75)
                                                            ↕ feedback (0.20–0.45)
                                                          DelayLP (2200Hz)
                                                            └──► EnvGain (wet)
```

---

## UI Sound Effects

### SFX-1 · Hover Blip

**Role:** Cursor hover / focus state feedback.

**Synthesis Method:** Single sine oscillator, very short decay envelope.

**Parameters:**

| Parameter | Value   |
| --------- | ------- |
| Frequency | 2400 Hz |
| Osc Type  | Sine    |
| Peak Gain | 0.2     |
| Decay     | 60 ms   |

**Reference Implementation:**

```javascript
function playHoverBlip(audioCtx) {
  const now = audioCtx.currentTime;

  const osc = audioCtx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = 2400;

  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.2, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

  osc.connect(gain);
  gain.connect(audioCtx.destination);

  osc.start(now);
  osc.stop(now + 0.06);
}
```

---

### SFX-2 · Select Confirm

**Role:** Button press / selection confirmation.

**Synthesis Method:** Two sine oscillators fired in sequence — low then high — creating an ascending two-tone chime.

**Parameters:**

| Parameter | Tone 1 | Tone 2  |
| --------- | ------ | ------- |
| Frequency | 800 Hz | 1200 Hz |
| Osc Type  | Sine   | Sine    |
| Peak Gain | 0.25   | 0.25    |
| Onset     | 0 ms   | 80 ms   |
| Decay     | 100 ms | 120 ms  |

**Reference Implementation:**

```javascript
function playSelectConfirm(audioCtx) {
  const now = audioCtx.currentTime;

  const osc1 = audioCtx.createOscillator();
  osc1.type = "sine";
  osc1.frequency.value = 800;

  const g1 = audioCtx.createGain();
  g1.gain.setValueAtTime(0.25, now);
  g1.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

  osc1.connect(g1);
  g1.connect(audioCtx.destination);
  osc1.start(now);
  osc1.stop(now + 0.1);

  const osc2 = audioCtx.createOscillator();
  osc2.type = "sine";
  osc2.frequency.value = 1200;

  const g2 = audioCtx.createGain();
  g2.gain.setValueAtTime(0, now);
  g2.gain.setValueAtTime(0.25, now + 0.08);
  g2.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

  osc2.connect(g2);
  g2.connect(audioCtx.destination);
  osc2.start(now);
  osc2.stop(now + 0.2);
}
```

---

### SFX-3 · Error Buzz

**Role:** Invalid action / rejection feedback.

**Synthesis Method:** Dual detuned square oscillators → lowpass filter. Harsh, low, buzzing character.

**Parameters:**

| Parameter        | Value   |
| ---------------- | ------- |
| Osc 1 Frequency  | 150 Hz  |
| Osc 2 Frequency  | 155 Hz  |
| Osc Type         | Square  |
| Filter Type      | Lowpass |
| Filter Frequency | 500 Hz  |
| Peak Gain        | 0.2     |
| Sustain          | 150 ms  |
| Decay            | 150 ms  |

**Reference Implementation:**

```javascript
function playErrorBuzz(audioCtx) {
  const now = audioCtx.currentTime;

  const osc1 = audioCtx.createOscillator();
  osc1.type = "square";
  osc1.frequency.value = 150;

  const osc2 = audioCtx.createOscillator();
  osc2.type = "square";
  osc2.frequency.value = 155;

  const filter = audioCtx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 500;

  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.2, now);
  gain.gain.setValueAtTime(0.2, now + 0.15);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

  osc1.connect(filter);
  osc2.connect(filter);
  filter.connect(gain);
  gain.connect(audioCtx.destination);

  osc1.start(now);
  osc2.start(now);
  osc1.stop(now + 0.3);
  osc2.stop(now + 0.3);
}
```

---

## Signal Chain Diagrams

```
BG-1 Warp Core Throb
─────────────────────────────────────────────────────
Osc1 (saw 55Hz) ─┐
                  ├──► Lowpass Filter (200Hz, Q8) ──► MasterGain ──► EnvGain ──► OUT
Osc2 (saw 55.5Hz)─┘         ▲                              ▲
                             │                              │
                    FilterLFO (sine 3Hz)           AmpLFO (square 1.5Hz)
                    × LFOGain (150)                × AmpLFOGain (0.25)


BG-2 Cryo Chamber Hum
─────────────────────────────────────────────────────
Osc1 (sine 100Hz)  ─┐
Osc2 (sine 150Hz)  ─┼──► EnvGain (0.12) ──► OUT
Osc3 (sine 200.3Hz)─┘       ▲▲
                             ││ (pitch mod on osc1+osc2)
                    LFO (sine 0.15Hz) × LFOGain (3)


BG-3 Trance Melody Arpeggiator
─────────────────────────────────────────────────────
[Supersaw ×3] ──► LP Filter (600–5kHz) ──► MasterGain ─┬──► EnvGain ──► OUT
                       ▲                                │
              FilterLFO (0.08–0.35Hz)                   └──► Delay (beat×0.75)
              × LFOGain (200–1400)                            ↕ Feedback(.2–.45)
                                                           DelayLP (2200Hz) ──► EnvGain


SFX-1 Hover Blip
─────────────────────────────────────────────────────
Osc (sine 2400Hz) ──► Gain (decay 60ms) ──► OUT


SFX-2 Select Confirm
─────────────────────────────────────────────────────
Osc1 (sine 800Hz)  ──► Gain1 (t=0ms,   decay 100ms) ──► OUT
Osc2 (sine 1200Hz) ──► Gain2 (t=80ms,  decay 120ms) ──► OUT


SFX-3 Error Buzz
─────────────────────────────────────────────────────
Osc1 (square 150Hz) ─┐
                      ├──► Lowpass (500Hz) ──► Gain (sustain+decay 300ms) ──► OUT
Osc2 (square 155Hz) ─┘
```

---

## Dynamic Frequency Modulation — BG-1 Warp Core Throb

The `setFrequency(targetFreq, rampTime)` method on the returned node
object is the primary runtime control surface.

### Recommended Frequency Map

| Game State       | Frequency | Ramp Time | Effect              |
| ---------------- | --------- | --------- | ------------------- |
| Idle / Drifting  | 40 Hz     | 3.0 s     | Deep, slow, minimal |
| Cruising         | 55 Hz     | 2.0 s     | Neutral baseline    |
| Engaging Systems | 70 Hz     | 1.0 s     | Rising tension      |
| Combat / Alert   | 90 Hz     | 0.5 s     | Urgent, aggressive  |
| Critical / Alarm | 110 Hz    | 0.2 s     | Harsh, immediate    |
| Power Down       | 30 Hz     | 4.0 s     | Slow collapse       |

### Automation Pattern Example

```javascript
// Scenario: docking sequence
throb.setFrequency(55, 0); // start neutral
throb.setFrequency(80, 1.5); // spin up on approach
throb.setFrequency(40, 3.0); // settle into dock
throb.setFrequency(30, 5.0); // power down to standby
```

### Continuous Sensor-Driven Modulation

Map any continuous input (proximity, health, speed) to frequency:

```javascript
/**
 * Map a normalized 0–1 value to oscillator frequency.
 * @param {object} throb     - Node returned by createWarpCoreThrob()
 * @param {number} intensity - Normalized input value 0.0 → 1.0
 * @param {number} rampTime  - Smoothing time in seconds
 */
function modulateByIntensity(throb, intensity, rampTime = 0.3) {
  const minFreq = 30;
  const maxFreq = 110;
  const targetFreq = minFreq + (maxFreq - minFreq) * intensity;
  throb.setFrequency(targetFreq, rampTime);
}

// Example: tie to a health value updated every frame
function onHealthUpdate(healthNormalized) {
  const dangerLevel = 1.0 - healthNormalized; // invert: low health = high intensity
  modulateByIntensity(throb, dangerLevel, 0.5);
}
```

---

## Integration Checklist

- [ ] `AudioContext` created on first user gesture (browser autoplay policy)
- [ ] BG-1 and BG-2 started together on scene load
- [ ] BG-1 `setFrequency` wired to game state machine
- [ ] SFX functions called directly on interaction events
- [ ] All nodes stopped and context closed on scene teardown
- [ ] Master gain bus added if mixing multiple layers

---

_Generated for Web Audio API. All frequencies in Hz, times in seconds._

```

```
