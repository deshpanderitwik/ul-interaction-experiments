import { NoteSynth } from '../../modules/note-synth';
import { recordNote } from '../recorder/recorder';
import { arpFrequencies, getScale } from '../scale';

// Tempo Slide's arpeggio: root / third / fifth / octave of the current scale,
// spelled across an octave from the root at octave 3. Each degree flashes its
// own hue the moment it sounds.
export const ARP_COLORS = ['#2e7bff', '#c64fff', '#ffb02e', '#2ee08a'];

export function currentArp(): { freq: number; color: string }[] {
  const rootMidi = 48 + getScale().root; // root at octave 3 (C3 = 48, F3 = 53)
  return arpFrequencies(getScale(), rootMidi).map((freq, i) => ({
    freq,
    color: ARP_COLORS[i],
  }));
}

// Sine pluck via the native synth. Optional-chaining short-circuits (no sound,
// no throw) on a build without the module; never throws.
export function pluck(freq: number) {
  recordNote(freq, 0.85);
  NoteSynth?.pluck(freq, 0.85, 0.5).catch(() => {});
}

// Vertical position → step interval in ms. Top of the screen is the fastest
// interval, bottom is the slowest (both user-configurable).
export function intervalForY(
  y: number,
  height: number,
  fastMs: number,
  slowMs: number
): number {
  const t = height > 0 ? Math.max(0, Math.min(1, y / height)) : 0.5;
  return fastMs + t * (slowMs - fastMs);
}
