// Clean import surface: `import { MidiOut } from '../../modules/midi-out'`.
// MidiOut may be null on a binary that doesn't include the native module
// (e.g. an older install receiving this JS over OTA) — callers must guard it.
export { default as MidiOut } from './src/MidiOutModule';
