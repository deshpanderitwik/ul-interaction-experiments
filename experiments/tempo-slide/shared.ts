import { NoteSynth } from '../../modules/note-synth';
import { recordNote } from '../recorder/recorder';

// Tempo Slide's arpeggio: an F major chord spelled across an octave — root,
// major third, fifth, octave → F3, A3, C4, F4. Each degree flashes its own hue
// the moment it sounds.
export type ArpStep = { freq: number; color: string };

export const ARP: ArpStep[] = [
  { freq: 174.61, color: '#2e7bff' }, // F3  root    — blue
  { freq: 220.0, color: '#c64fff' }, // A3  third   — violet
  { freq: 261.63, color: '#ffb02e' }, // C4  fifth   — amber
  { freq: 349.23, color: '#2ee08a' }, // F4  octave  — green
];

// Parallel list of just the flash colors, for interpolateColor in the worklet.
export const ARP_COLORS = ARP.map((s) => s.color);

// Sine pluck via the native synth. Optional-chaining short-circuits (no sound,
// no throw) on a build without the module; never throws.
export function pluck(freq: number) {
  recordNote(freq, 0.85);
  NoteSynth?.pluck(freq, 0.85, 0.5).catch(() => {});
}

// Vertical position → step interval in ms. Top of the screen is fast, bottom is
// slow, clamped to the range below.
export const FAST_MS = 90;
export const SLOW_MS = 520;

export function intervalForY(y: number, height: number): number {
  const t = height > 0 ? Math.max(0, Math.min(1, y / height)) : 0.5;
  return FAST_MS + t * (SLOW_MS - FAST_MS);
}
