import { NativeModule, requireOptionalNativeModule } from 'expo';

// One tap buffer's worth of mic audio, pre-digested for drawing: `peaks` is a
// run of waveform columns (max |sample| per ~16ms bin, 0..1, oldest first) and
// `rms` is the buffer's overall level (0..1-ish).
export type MicFrame = { peaks: number[]; rms: number; sampleRate: number };

type MicTapEvents = {
  onAudio: (frame: MicFrame) => void;
};

// The shape of the native mic tap, as seen from JS. Each method maps 1:1 to a
// Function/AsyncFunction in MicTapModule.swift.
declare class MicTapModule extends NativeModule<MicTapEvents> {
  /** True while the mic tap is installed and capturing. */
  isRunning(): boolean;
  /**
   * Ask for mic permission (first use) and start capturing. Resolves true once
   * audio is flowing, false if the user denied microphone access.
   */
  start(): Promise<boolean>;
  /** Stop capturing (idempotent). Frames already delivered stay with JS. */
  stop(): Promise<void>;
}

// requireOptional → null (instead of throwing) on a build that lacks the native
// module, so JS degrades to a "needs the new build" notice rather than crashing.
export default requireOptionalNativeModule<MicTapModule>('MicTap');
