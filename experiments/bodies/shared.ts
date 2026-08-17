import { scaleSteps, type Scale } from '../scale';

// Bodies — the atom of solo composition. A "body" is a persistent, looping voice
// you plant in the scene: it sits at a point, plays one note on its subdivision,
// and keeps breathing until paused. This file is the pure data/geometry seam;
// index.tsx owns the scene, gestures, audio scheduling, and rendering.

export type Body = {
  id: number;
  x: number;
  y: number;
  /** Absolute MIDI note this body plays. */
  midi: number;
  /** Pulse subdivision — denominator of a whole note (1 = whole … 16 = 16th). */
  subdivision: number;
  /** Whether the body is currently sounding. */
  playing: boolean;
};

export const MAX_BODIES = 12;
export const BODY_R = 20; // core radius, px — small so bodies cover fine pitch ground
export const HIT_R = 32; // touch radius for tap/drag/hold, px

// Pulse subdivisions offered in the properties panel. `d` is the denominator of
// a whole note; triplets sit between the straight values (e.g. 1/8T = d12 is
// three per quarter).
export const SUBDIVISIONS = [
  { label: '1', d: 1 },
  { label: '1/2', d: 2 },
  { label: '1/4', d: 4 },
  { label: '1/4T', d: 6 },
  { label: '1/8', d: 8 },
  { label: '1/8T', d: 12 },
  { label: '1/16', d: 16 },
] as const;

// One pulse period in ms: a whole note is 4 beats, so 240000 / (bpm * denom).
export function periodMs(denom: number, bpm: number): number {
  return 240000 / (bpm * denom);
}

// Scale-member MIDI notes within [minMidi, maxMidi], ascending. The note picker
// steps through this so every body lands on the shared scale — coherence for free.
export function scaleMidiLadder(scale: Scale, minMidi: number, maxMidi: number): number[] {
  const set = new Set(scaleSteps(scale.type).map((s) => (scale.root + s) % 12));
  const out: number[] = [];
  for (let m = minMidi; m <= maxMidi; m++) {
    if (set.has(((m % 12) + 12) % 12)) out.push(m);
  }
  return out;
}

// Index of the ladder note closest to a MIDI value (for re-opening the picker on
// a body whose note may sit off the current scale after a scale change).
export function nearestIndex(ladder: number[], midi: number): number {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < ladder.length; i++) {
    const d = Math.abs(ladder[i] - midi);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}
