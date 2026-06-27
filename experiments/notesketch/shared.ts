// Note model + layout for NoteSketch — a vertical pitch ladder of the current
// global scale (one octave).

import { ladderNotes, type Scale } from '../scale';

export type Note = {
  /** Stable id / pitch name, e.g. "F3". */
  id: string;
  /** Display label. */
  label: string;
  /** Pitch in Hz. */
  freq: number;
  /** Center on the canvas. */
  cx: number;
  cy: number;
  /** Hit/draw radius. */
  r: number;
};

export const NOTE_RADIUS = 30;

// Lay the current scale out as a vertical pitch ladder (one octave, 8 notes),
// centered horizontally: root at the bottom, octave at the top.
export function buildNotes(width: number, height: number, scale: Scale): Note[] {
  const topPad = 168; // clear the REC pill in the host overlay (top-center)
  const bottomPad = 120;
  const ladder = ladderNotes(scale, 48 + scale.root); // root at octave 3
  const n = ladder.length;
  const span = Math.max(1, height - topPad - bottomPad);
  const gap = n > 1 ? span / (n - 1) : 0;
  const cx = width / 2;
  return ladder.map((nt, i) => ({
    id: nt.label,
    label: nt.label,
    freq: nt.freq,
    cx,
    cy: height - bottomPad - i * gap,
    r: NOTE_RADIUS,
  }));
}

// Active-note color by trigger order. t in [0,1] is the note's position in the
// trigger sequence (0 = first/oldest, 1 = most recent). Ramps a blue from a
// dim-but-clearly-active shade up to a bright near-white.
export function intensityColor(t: number): string {
  const c = Math.max(0, Math.min(1, t));
  const lerp = (a: number, b: number) => Math.round(a + (b - a) * c);
  return `rgb(${lerp(58, 223)}, ${lerp(74, 230)}, ${lerp(122, 255)})`;
}

// Shortest distance from point P to segment AB. A stroke segment "passes
// through" a note when this distance is within the note's radius.
export function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * dx;
  const qy = ay + t * dy;
  return Math.hypot(px - qx, py - qy);
}
