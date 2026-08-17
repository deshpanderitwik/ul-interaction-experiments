import { useEffect, useReducer } from 'react';

// Global musical scale, shared across all experiments. Pick a root + quality in
// the settings side sheet and every experiment's note pool follows. In-memory
// (resets on app restart), like the settings store.

export type ScaleType =
  | 'major' // Ionian
  | 'dorian'
  | 'phrygian'
  | 'lydian'
  | 'mixolydian'
  | 'minor' // Aeolian (natural minor)
  | 'locrian';
export type Scale = { root: number; type: ScaleType }; // root 0..11, C = 0

export const ROOT_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// The seven diatonic modes as semitone offsets from the root. Major = Ionian and
// Minor = Aeolian are kept as their familiar names (and preserve older presets).
const MODES: Record<ScaleType, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11], // Ionian
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  minor: [0, 2, 3, 5, 7, 8, 10], // Aeolian (natural minor)
  locrian: [0, 1, 3, 5, 6, 8, 10],
};

// Menu order + display labels, shown in the settings scale picker.
export const SCALE_TYPES: ScaleType[] = [
  'major',
  'dorian',
  'phrygian',
  'lydian',
  'mixolydian',
  'minor',
  'locrian',
];
export const SCALE_LABELS: Record<ScaleType, string> = {
  major: 'Major',
  dorian: 'Dorian',
  phrygian: 'Phrygian',
  lydian: 'Lydian',
  mixolydian: 'Mixolydian',
  minor: 'Minor',
  locrian: 'Locrian',
};

// Semitone offsets for a mode. Single source of truth — every experiment's note
// pool flows through this (directly or via scaleMidiLadder), so adding a mode here
// lights it up everywhere.
export function scaleSteps(type: ScaleType): number[] {
  return MODES[type] ?? MODES.major;
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
  return `${ROOT_NAMES[s.root]} ${SCALE_LABELS[s.type]}`;
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
  const set = new Set(scaleSteps(s.type).map((x) => (s.root + x) % 12));
  const out: number[] = [];
  for (let m = minMidi; m <= maxMidi; m++) {
    if (set.has(((m % 12) + 12) % 12)) out.push(midiToFreq(m));
  }
  return out;
}

// Root, third, fifth, octave (scale degrees 1,3,5,8) from a root MIDI note.
export function arpFrequencies(s: Scale, rootMidi: number): number[] {
  const st = scaleSteps(s.type);
  return [0, 2, 4, 7].map((d) => midiToFreq(rootMidi + st[d % 7] + 12 * Math.floor(d / 7)));
}

// One octave of the scale (7 degrees + octave = 8 notes) from a root MIDI note.
export function ladderNotes(s: Scale, rootMidi: number): { freq: number; label: string }[] {
  const st = scaleSteps(s.type);
  const out: { freq: number; label: string }[] = [];
  for (let i = 0; i <= 7; i++) {
    const midi = rootMidi + st[i % 7] + 12 * Math.floor(i / 7);
    out.push({ freq: midiToFreq(midi), label: noteName(midi) });
  }
  return out;
}
