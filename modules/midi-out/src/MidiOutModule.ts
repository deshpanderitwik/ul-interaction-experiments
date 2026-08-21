import { NativeModule, requireOptionalNativeModule } from 'expo';

// The shape of the native MIDI out, as seen from JS. Each method maps 1:1 to
// a Function/AsyncFunction in MidiOutModule.swift. Requires a binary with
// runtime >= 1.3.0 — null on older builds.
declare class MidiOutModule extends NativeModule {
  /**
   * Create the virtual MIDI source (once) and enable the network session so a
   * laptop on the same Wi-Fi can receive. Resolves true when ready.
   */
  enable(): Promise<boolean>;
  /** True once the virtual source exists. */
  isEnabled(): boolean;
  /** channel 0–15, note 0–127, velocity 0–127. */
  noteOn(channel: number, note: number, velocity: number): Promise<void>;
  noteOff(channel: number, note: number): Promise<void>;
  /** Control change: controller 0–127, value 0–127. */
  cc(channel: number, controller: number, value: number): Promise<void>;
  /** CC 123 — everything off on a channel (panic). */
  allNotesOff(channel: number): Promise<void>;
}

// requireOptional → null (instead of throwing) on a build that lacks the
// native module, so JS degrades gracefully rather than crashing.
export default requireOptionalNativeModule<MidiOutModule>('MidiOut');
