// Layout, palette, symbol geometry and the SkSL shader for Duet.

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

// Cell colors, as shader floats (0..1 rgb) and matching CSS for the symbol glow.
export const COL_SINE_RGB = [0.33, 0.95, 0.88]; // teal
export const COL_SQUARE_RGB = [0.97, 0.42, 0.86]; // magenta
export const COL_SINE_CSS = 'rgb(84,242,224)';
export const COL_SQUARE_CSS = 'rgb(247,107,219)';

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

// Full-screen fragment shader drawing both cells: a shimmering, radiating glow
// that expands a ripple ring on each sound. Each cell contributes color only
// inside a generous disc around its center, so the rest of the screen stays
// black. ripAge is "seconds since this cell last made a sound" (large when
// idle → no ring).
export const SHADER = `
uniform float  u_time;   // seconds
uniform float2 u_aC;  uniform float u_aR;  uniform float u_aOn;  uniform float u_aRip;  uniform float3 u_aCol;
uniform float2 u_bC;  uniform float u_bR;  uniform float u_bOn;  uniform float u_bRip;  uniform float3 u_bCol;

float hash(float2 p) {
  return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453123);
}

float vnoise(float2 p) {
  float2 i = floor(p);
  float2 f = fract(p);
  float a = hash(i);
  float b = hash(i + float2(1.0, 0.0));
  float c = hash(i + float2(0.0, 1.0));
  float d = hash(i + float2(1.0, 1.0));
  float2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

half3 cell(float2 xy, float2 c, float rad, float on, float ripAge, float3 col, float t) {
  if (on < 0.001) return half3(0.0);
  float d = distance(xy, c);
  float dn = d / rad;                       // 0 at center, 1 at edge
  float ang = atan(xy.y - c.y, xy.x - c.x);

  // Soft core glow, brightest at center and fading past the rim. (smoothstep
  // edges are kept ascending — reversed edges are undefined in SkSL — and we
  // invert for the falling falloff.)
  float core = 1.0 - smoothstep(0.0, 1.35, dn);
  core = pow(core, 1.6);

  // Shimmer: slowly drifting angular noise bands.
  float shim = vnoise(float2(ang * 2.5 + t * 0.6, dn * 5.0 - t * 1.2));
  shim = 0.62 + 0.46 * shim;

  // Radiate: concentric pulse traveling outward.
  float radiate = mix(1.0, 0.5 + 0.5 * sin(dn * 12.0 - t * 3.2), 0.35);

  // Bright rim ring near the edge.
  float rim = (1.0 - smoothstep(0.82, 1.05, dn)) * smoothstep(0.55, 1.0, dn);

  float body = core * shim * radiate + rim * 0.55;

  // Ripple: a thin ring expanding outward, fired on each sound.
  float ring = 0.0;
  if (ripAge >= 0.0 && ripAge < 1.6) {
    float rr = ripAge * 1.35;               // ring radius (in dn units)
    float e = (dn - rr) / 0.12;
    float g = exp(-e * e);                  // gaussian (avoid pow on signed base)
    ring = g * exp(-ripAge * 2.2) * 1.5;
  }

  float intensity = (body + ring) * on;
  intensity *= 1.0 - smoothstep(0.0, 1.85, dn);   // contain the glow to a disc
  return half3(col * intensity);
}

half4 main(float2 xy) {
  half3 c = half3(0.0);
  c += cell(xy, u_aC, u_aR, u_aOn, u_time - u_aRip, u_aCol, u_time);
  c += cell(xy, u_bC, u_bR, u_bOn, u_time - u_bRip, u_bCol, u_time);
  return half4(c, 1.0);
}
`;
