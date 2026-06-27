import { NoteSynth } from '../../modules/note-synth';
import { recordNote } from '../recorder/recorder';
import { getScale, scaleFrequencies } from '../scale';

// The current scale's pitches across the F3..F5 register form the burst pool.
export function scalePool(): number[] {
  return scaleFrequencies(getScale(), 53, 77);
}

// Log-normalized pitch position within [lo, hi] Hz → 0..1, for vertical layout.
export function pitchNorm(freq: number, lo: number, hi: number): number {
  const a = Math.log(lo);
  const b = Math.log(hi);
  return Math.max(0, Math.min(1, (Math.log(freq) - a) / (b - a || 1)));
}

// Sine pluck via the native synth. Silent (no throw) on a build without it.
export function pluck(freq: number, gain: number) {
  recordNote(freq, gain);
  NoteSynth?.pluck(freq, gain, 0.6).catch(() => {});
}

export function randItem<T>(arr: readonly T[]): T {
  return arr[(Math.random() * arr.length) | 0];
}
