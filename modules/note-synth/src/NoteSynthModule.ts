import { NativeModule, requireOptionalNativeModule } from 'expo';

// The shape of the native synth, as seen from JS. Each method maps 1:1 to a
// Function/AsyncFunction in NoteSynthModule.swift.
declare class NoteSynthModule extends NativeModule {
  /** True once the native audio engine is up and rendering. */
  isAvailable(): boolean;
  /** Trigger a sine pluck: frequency in Hz, gain 0..1, decay in seconds. */
  pluck(frequency: number, gain: number, decay: number): Promise<void>;
}

// requireOptional → returns null (instead of throwing) on a build that lacks the
// native module, so JS degrades to "no audio" rather than crashing the app.
export default requireOptionalNativeModule<NoteSynthModule>('NoteSynth');
