import { useEffect, useReducer } from 'react';

// Global musical scale, shared across all experiments. Pick a root + quality in
// the settings side sheet and every experiment's note pool follows. In-memory
// (resets on app restart), like the settings store.

export type ScaleType = 'major' | 'minor';
export type Scale = { root: number; type: ScaleType }; // root 0..11, C = 0

export const ROOT_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10]; // natural minor

function steps(type: ScaleType): number[] {
  return type === 'major' ? MAJOR : MINOR;
}

let current: Scale = { root: 5, type: 'minor' }; // F minor
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function getScale(): Scale {
  return current;
}

export function setScale(next: Scale) {
  current = next;
  emit();
}

export function subscribeScale(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useScale(): Scale {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => subscribeScale(force), []);
  return current;
}

export function scaleName(s: Scale): string {
  return `${ROOT_NAMES[s.root]} ${s.type === 'major' ? 'Major' : 'Minor'}`;
}

export function midiToFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

// Octave numbering follows the DAW convention (Ableton/Yamaha): middle C
// (MIDI 60) = C3. Pitches are unchanged — this only names them.
export function noteName(midi: number): string {
  return `${ROOT_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 2}`;
}

// All scale-member MIDI notes within [minMidi, maxMidi], as frequencies.
export function scaleFrequencies(s: Scale, minMidi: number, maxMidi: number): number[] {
  const set = new Set(steps(s.type).map((x) => (s.root + x) % 12));
  const out: number[] = [];
  for (let m = minMidi; m <= maxMidi; m++) {
    if (set.has(((m % 12) + 12) % 12)) out.push(midiToFreq(m));
  }
  return out;
}

// Root, third, fifth, octave (scale degrees 1,3,5,8) from a root MIDI note.
export function arpFrequencies(s: Scale, rootMidi: number): number[] {
  const st = steps(s.type);
  return [0, 2, 4, 7].map((d) => midiToFreq(rootMidi + st[d % 7] + 12 * Math.floor(d / 7)));
}

// One octave of the scale (7 degrees + octave = 8 notes) from a root MIDI note.
export function ladderNotes(s: Scale, rootMidi: number): { freq: number; label: string }[] {
  const st = steps(s.type);
  const out: { freq: number; label: string }[] = [];
  for (let i = 0; i <= 7; i++) {
    const midi = rootMidi + st[i % 7] + 12 * Math.floor(i / 7);
    out.push({ freq: midiToFreq(midi), label: noteName(midi) });
  }
  return out;
}
