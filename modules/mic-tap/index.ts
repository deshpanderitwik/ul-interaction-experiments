// Clean import surface: `import { MicTap } from '../../modules/mic-tap'`.
// MicTap may be null on a binary that doesn't include the native module
// (e.g. an older install receiving this JS over OTA) — callers must guard it.
// The capture/playback surface (recordStart, play, setFx, …) additionally
// needs a binary with runtime >= 1.3.0.
export { default as MicTap } from './src/MicTapModule';
export type { MicFrame, Sample } from './src/MicTapModule';
