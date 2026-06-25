import { NoteSynth } from '../../modules/note-synth';

// F natural minor (F G A♭ B♭ C D♭ E♭) as a pool of frequencies spanning
// F3..F5, so a burst can sample across a couple octaves. A4 = 440.
function midiToFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

// Semitone steps of the natural-minor scale from the root.
const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];

export const F_MINOR: number[] = (() => {
  const out: number[] = [];
  for (let m = 53; m <= 77; m++) {
    // F3 = MIDI 53; (m - 53) % 12 in the scale → keep it.
    if (MINOR_STEPS.includes(((m - 53) % 12 + 12) % 12)) out.push(midiToFreq(m));
  }
  return out;
})();

// Cool palette for the exploding dots.
export const DOT_COLORS = ['#8ecbff', '#c9a7ff', '#7af0d4', '#ffffff', '#9ad0ff'];

// Sine pluck via the native synth. Silent (no throw) on a build without it.
export function pluck(freq: number, gain: number) {
  NoteSynth?.pluck(freq, gain, 0.6).catch(() => {});
}

export function randItem<T>(arr: readonly T[]): T {
  return arr[(Math.random() * arr.length) | 0];
}
