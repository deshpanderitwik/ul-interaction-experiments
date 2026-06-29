// Layout, palette and symbol geometry for Duet.

export type Cell = { cx: number; cy: number; r: number };

// Two cells placed away from one another on a diagonal so each gets its own
// space to glow and ripple without bleeding into the other.
export function layout(width: number, height: number): { a: Cell; b: Cell } {
  const r = Math.min(width * 0.21, height * 0.16, 150);
  return {
    a: { cx: width * 0.3, cy: height * 0.34, r },
    b: { cx: width * 0.7, cy: height * 0.66, r },
  };
}

// Cell colors.
export const COL_SINE_CSS = 'rgb(84,242,224)'; // teal
export const COL_SQUARE_CSS = 'rgb(247,107,219)'; // magenta

// One-and-a-half periods of a sine, centered in the cell, as an SVG path string.
export function sineSymbolPath(cell: Cell): string {
  const w = cell.r * 1.15;
  const amp = cell.r * 0.42;
  const left = cell.cx - w / 2;
  const periods = 1.5;
  const n = 56;
  let d = '';
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = left + t * w;
    const y = cell.cy - Math.sin(t * periods * 2 * Math.PI) * amp;
    d += `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)} `;
  }
  return d.trim();
}

// A crenellated square wave (vertical edges + flat tops/bottoms) as a path.
export function squareSymbolPath(cell: Cell): string {
  const w = cell.r * 1.1;
  const amp = cell.r * 0.4;
  const left = cell.cx - w / 2;
  const halves = 4; // two full periods
  const seg = w / halves;
  let level = -1; // start low
  let y = cell.cy - level * amp;
  let d = `M ${left.toFixed(2)} ${y.toFixed(2)} `;
  for (let k = 0; k < halves; k++) {
    const x = left + (k + 1) * seg;
    d += `L ${x.toFixed(2)} ${y.toFixed(2)} `; // flat run
    if (k < halves - 1) {
      level = -level; // flip and draw the vertical edge
      y = cell.cy - level * amp;
      d += `L ${x.toFixed(2)} ${y.toFixed(2)} `;
    }
  }
  return d.trim();
}
