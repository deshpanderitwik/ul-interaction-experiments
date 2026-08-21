// Clean import surface: `import { NoteSynth } from '../../modules/note-synth'`.
// NoteSynth may be null on a binary that doesn't include the native module
// (e.g. an older install receiving this JS over OTA) — callers must guard it.
export { default as NoteSynth } from './src/NoteSynthModule';
export { WAVES, type WaveName } from './src/NoteSynthModule';
