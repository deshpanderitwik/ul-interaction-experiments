import { NativeModule, requireOptionalNativeModule } from 'expo';

/** Oscillator shapes for the v2 voices, by native index. */
export const WAVES = { sine: 0, triangle: 1, saw: 2, square: 3 } as const;
export type WaveName = keyof typeof WAVES;

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
