// Note model + layout for NoteSketch. Kept separate from the interaction so the
// next step (wiring activation to sound) can import the same note definitions.

export type Note = {
  /** Stable id / pitch name, e.g. "F3". */
  id: string;
  /** Display label. */
  label: string;
  /** Center on the canvas. */
  cx: number;
  cy: number;
  /** Hit/draw radius. */
  r: number;
};

// Natural notes spanning one octave, F3 → F4 (low to high). Swap to the
// chromatic set here to get all 13 — everything else is data-driven.
export const NOTE_LABELS = [
  'F3',
  'G3',
  'A3',
  'B3',
  'C4',
  'D4',
  'E4',
  'F4',
] as const;

export const NOTE_RADIUS = 30;

// Semitone offset from C within an octave, for note-name → frequency.
const SEMITONE: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};

// Equal-tempered frequency (A4 = 440 Hz) for a label like "F3" / "F#3" / "Gb3".
export function noteFrequency(label: string): number {
  const m = /^([A-G][#b]?)(-?\d+)$/.exec(label);
  if (!m) return 440;
  const semitone = SEMITONE[m[1]] ?? 0;
  const octave = parseInt(m[2], 10);
  const midi = (octave + 1) * 12 + semitone; // MIDI: C4 = 60
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Lay the notes out as a vertical pitch ladder centered horizontally: lowest
// (F3) at the bottom, highest (F4) at the top.
export function buildNotes(width: number, height: number): Note[] {
  const topPad = 120;
  const bottomPad = 120;
  const n = NOTE_LABELS.length;
  const span = Math.max(1, height - topPad - bottomPad);
  const gap = n > 1 ? span / (n - 1) : 0;
  const cx = width / 2;
  return NOTE_LABELS.map((label, i) => ({
    id: label,
    label,
    cx,
    cy: height - bottomPad - i * gap,
    r: NOTE_RADIUS,
  }));
}

// Active-note color by trigger order. t in [0,1] is the note's position in the
// trigger sequence (0 = first/oldest, 1 = most recent). Ramps a blue from a
// dim-but-clearly-active shade up to a bright near-white, so the draw order
// reads as increasing intensity. Even t=0 stays distinct from the inactive
// outline.
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
