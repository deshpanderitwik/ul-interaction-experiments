import { NoteSynth } from '../../modules/note-synth';
import { recordNote } from '../recorder/recorder';

// Note Radial geometry + voice.
export const N = 7; // ring notes (the 7 scale degrees)
export const RADIAL_RADIUS = 96; // ring radius from the finger
export const RADIAL_NOTE_R = 24; // ring note circle radius
export const POP_R = 36; // popped-note circle radius
export const DEADZONE = 28; // no selection within this radius of the finger

export function pluck(freq: number, decay = 0.6) {
  recordNote(freq, 0.9);
  NoteSynth?.pluck(freq, 0.9, decay).catch(() => {});
}

// Sustained pitch-bend voice (legato). Optional-chained so it's a no-op on a
// binary built before these native methods existed.
export function bendStart(freq: number) {
  NoteSynth?.bendStart?.(freq, 0.55)?.catch?.(() => {});
}
export function bendSet(freq: number) {
  NoteSynth?.bendSet?.(freq)?.catch?.(() => {});
}
export function bendStop() {
  NoteSynth?.bendStop?.(0.05)?.catch?.(() => {});
}
