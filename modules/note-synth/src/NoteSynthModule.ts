import { NativeModule, requireOptionalNativeModule } from 'expo';

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
}

// requireOptional → returns null (instead of throwing) on a build that lacks the
// native module, so JS degrades to "no audio" rather than crashing the app.
export default requireOptionalNativeModule<NoteSynthModule>('NoteSynth');
