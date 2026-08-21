import { NativeModule, requireOptionalNativeModule } from 'expo';

/** Oscillator shapes for the v2 voices, by native index. */
export const WAVES = { sine: 0, triangle: 1, saw: 2, square: 3 } as const;
export type WaveName = keyof typeof WAVES;

// ---- wavetable engine (requires a binary with runtime >= 1.3.0) ----

/** Built-in wavetable slots (0–2 may be overwritten via loadTable). */
export const TABLES = { basic: 0, buzz: 1, vowel: 2 } as const;
/** Oscillator warp modes (phase shapers; fmFromB modulates osc A by osc B). */
export const WARPS = { none: 0, sync: 1, bend: 2, mirror: 3, pwm: 4, quantize: 5, fmFromB: 6 } as const;
/** Per-voice filter types. */
export const FILTERS = { off: 0, lowpass: 1, highpass: 2, bandpass: 3, notch: 4 } as const;
/** LFO shapes. */
export const LFO_SHAPES = { sine: 0, triangle: 1, saw: 2, square: 3, sampleHold: 4 } as const;

/**
 * A patch is a flat {key: number} dictionary; missing keys keep defaults.
 * Keys (per osc, X = A or B): oscX.on, oscX.table, oscX.pos (0..1 morph),
 * oscX.unison (1–7), oscX.detune (cents), oscX.spread (0..1),
 * oscX.level, oscX.semi, oscX.warp (WARPS), oscX.warpAmt (0..1),
 * oscX.phaseRand (0..1). Mixers: sub.level, noise.level. Envelopes:
 * amp.a/d/s/r and env2.a/d/s/r (seconds / levels), env2.toCutoff (Hz),
 * env2.toPos, env2.toPitch (semitones). LFOs (N = 1 or 2): lfoN.shape,
 * lfoN.hz, lfoN.toPitch (semis), lfoN.toCutoff (Hz), lfoN.toPos,
 * lfoN.toAmp, lfoN.toPan. Filter: filter.type (FILTERS), filter.cutoff (Hz),
 * filter.res (0..1), filter.keytrack (0..1). Also: drive (0..1),
 * glide (sec/octave-ish).
 */
export type PatchParams = Record<string, number>;

/**
 * The insert FX rack (Soundtoys-flavored, requires runtime >= 1.4.0), fixed
 * chain order, every unit off by default:
 *   saturator → filter → phaser → chorus/flanger → tremolo/auto-pan →
 *   micro-shift → crystallizer (granular pitch echo) → analog echo.
 * Flat keys (each unit has `.on` 0/1; mixes 0..1):
 * - sat.drive (0..1) / sat.style (0 tape, 1 tube, 2 fuzz) / sat.tone (0..1) / sat.mix
 * - filt.type (0 LP, 1 HP, 2 BP) / filt.cutoff (Hz) / filt.res (0..1) /
 *   filt.lfoHz / filt.lfoAmt (0..1) / filt.envAmt (0..1) / filt.mix
 * - phaser.rate (Hz) / phaser.depth / phaser.center (Hz) / phaser.fb /
 *   phaser.stages (2–8) / phaser.mix
 * - chorus.rate (Hz) / chorus.depth / chorus.delay (ms; 1–5ms + fb = flanger) /
 *   chorus.fb / chorus.spread / chorus.mix
 * - trem.rate (Hz) / trem.depth / trem.shape (0 sine, 1 square, 2 saw) /
 *   trem.pan (1 = auto-pan)
 * - micro.cents (± detune width) / micro.mix
 * - cryst.pitch (semitones) / cryst.size (ms) / cryst.fb / cryst.reverse / cryst.mix
 * - echo.time (ms) / echo.offset (ms, R vs L) / echo.fb / echo.pingpong /
 *   echo.toneLo (Hz) / echo.toneHi (Hz) / echo.wow (0..1) / echo.sat (0..1) / echo.mix
 */
export type FxParams = Record<string, number>;

// The shape of the native synth, as seen from JS. Each method maps 1:1 to a
// Function/AsyncFunction in NoteSynthModule.swift.
declare class NoteSynthModule extends NativeModule {
  /** True once the native audio engine is up and rendering. */
  isAvailable(): boolean;
  /** Trigger a sine pluck: frequency in Hz, gain 0..1, decay in seconds. */
  pluck(frequency: number, gain: number, decay: number): Promise<void>;
  /**
   * Trigger a one-shot sine note shaped by an ADSR envelope. attack/decay/
   * release/hold are in seconds; sustain is the held level (0..1). The note
   * gates on (A → D → S held for `hold`) then gates off (R).
   */
  playADSR(
    frequency: number,
    gain: number,
    attack: number,
    decay: number,
    sustain: number,
    hold: number,
    release: number
  ): Promise<void>;
  /**
   * v2 pluck with timbre (requires a binary with runtime >= 1.3.0): wave is a
   * WAVES index, cutoff a lowpass in Hz (<= 0 bypasses), pan -1..1 (balance
   * law — 0 sounds identical to the legacy mono pluck).
   */
  pluck2(
    frequency: number,
    gain: number,
    decay: number,
    wave: number,
    cutoff: number,
    pan: number
  ): Promise<void>;
  /** v2 ADSR note with the same timbre controls as pluck2. */
  playADSR2(
    frequency: number,
    gain: number,
    attack: number,
    decay: number,
    sustain: number,
    hold: number,
    release: number,
    wave: number,
    cutoff: number,
    pan: number
  ): Promise<void>;
  // ---- wavetable engine (null-guard AND runtime >= 1.3.0) ----

  /**
   * Upload a wavetable: `data` is frames × 2048 samples (frame-major, each
   * frame one cycle in -1..1). Mip-mapped (anti-aliased) at load. Up to 8
   * slots; 16 frames max. Resolves false on bad arguments.
   */
  loadTable(slot: number, frames: number, data: number[]): Promise<boolean>;
  /** Set a patch slot (8 slots). Sounding voices read the patch live. */
  setPatch(slot: number, params: PatchParams): Promise<void>;
  /** Live-tweak one patch parameter — a macro knob for sweeps and morphs. */
  setPatchParam(slot: number, key: string, value: number): Promise<void>;
  /** Gate a wavetable note on; resolves a voice handle for noteOff (or -1). */
  noteOn(patch: number, midi: number, gain: number, pan: number): Promise<number>;
  /** Release a gated note (enters its amp release). */
  noteOff(voice: number): Promise<void>;
  /** One-shot: gate on, hold `hold` seconds, then auto-release. */
  noteFire(patch: number, midi: number, gain: number, pan: number, hold: number): Promise<number>;
  /** All wavetable voices → release (soft panic). */
  releaseAll(): Promise<void>;
  /** Set one insert-rack parameter (see FxParams for the key reference). */
  setFxParam(key: string, value: number): Promise<void>;
  /** Set many insert-rack parameters at once (a preset). */
  setFxPreset(params: FxParams): Promise<void>;
  /**
   * Tremolator step pattern (0..1 levels; one step per trem.rate cycle).
   * An empty array returns the tremolo to its LFO.
   */
  setTremPattern(steps: number[]): Promise<void>;
  /**
   * Shared synth FX tail: reverbMix/delayMix wet % (0–100, default dry);
   * delayTime seconds (max 2); feedback 0–95. Negative leaves a field as-is.
   */
  setSynthFx(reverbMix: number, delayMix: number, delayTime: number, feedback: number): Promise<void>;

  /** Gate on the sustained bend voice at a frequency/gain. */
  bendStart(frequency: number, gain: number): Promise<void>;
  /** Slide the bend voice to a new frequency (smooth, legato glide). */
  bendSet(frequency: number): Promise<void>;
  /** Gate off the bend voice (ramps to silence). */
  bendStop(release: number): Promise<void>;
}

// requireOptional → returns null (instead of throwing) on a build that lacks the
// native module, so JS degrades to "no audio" rather than crashing the app.
export default requireOptionalNativeModule<NoteSynthModule>('NoteSynth');
