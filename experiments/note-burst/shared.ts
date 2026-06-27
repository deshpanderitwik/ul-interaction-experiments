import { NoteSynth } from '../../modules/note-synth';
import { recordNote } from '../recorder/recorder';

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

// Pitch range of the pool, for normalizing a frequency to 0..1 (and from there
// to color / vertical position).
export const F_MIN_HZ = F_MINOR[0];
export const F_MAX_HZ = F_MINOR[F_MINOR.length - 1];

// Log-normalized pitch position 0 (lowest) .. 1 (highest).
export function pitchNorm(freq: number): number {
  const lo = Math.log(F_MIN_HZ);
  const hi = Math.log(F_MAX_HZ);
  return Math.max(0, Math.min(1, (Math.log(freq) - lo) / (hi - lo || 1)));
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g] = [c, x];
  else if (hp < 2) [r, g] = [x, c];
  else if (hp < 3) [g, b] = [c, x];
  else if (hp < 4) [g, b] = [x, c];
  else if (hp < 5) [r, b] = [x, c];
  else [r, b] = [c, x];
  const m = l - c / 2;
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

// Map a pitch to a color: low notes blue, high notes warm. Computed in JS at
// spawn time, so each dot just carries a hex string.
export function colorForFreq(freq: number): string {
  const hue = 220 - pitchNorm(freq) * 200; // 220 (blue) → 20 (warm)
  return hslToHex(hue, 0.85, 0.6);
}

// Sine pluck via the native synth. Silent (no throw) on a build without it.
export function pluck(freq: number, gain: number) {
  recordNote(freq, gain);
  NoteSynth?.pluck(freq, gain, 0.6).catch(() => {});
}

export function randItem<T>(arr: readonly T[]): T {
  return arr[(Math.random() * arr.length) | 0];
}
