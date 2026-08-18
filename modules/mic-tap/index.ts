// Clean import surface: `import { MicTap } from '../../modules/mic-tap'`.
// MicTap may be null on a binary that doesn't include the native module
// (e.g. an older install receiving this JS over OTA) — callers must guard it.
export { default as MicTap } from './src/MicTapModule';
export type { MicFrame } from './src/MicTapModule';
