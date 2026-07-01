import {
  Atlas,
  BlurMask,
  Canvas,
  Circle,
  Fill,
  Shader,
  Skia,
  useTexture,
} from '@shopify/react-native-skia';
import type { SkRSXform } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useFrameCallback, useSharedValue } from 'react-native-reanimated';

// Fence · Disintegrating Circle — at rest it's ONE continuous solid disc (a
// shader, not dots), so the break is a surprise. Holding doesn't cut a hole: the
// disc DISINTEGRATES grain by grain. At each point the local excitation is
// thresholded against static value-noise, so the solid erodes with a crumbling
// edge; each particle carries its own matching threshold, so the grains that
// lift off are exactly the material the disc is losing. Loosed grains disperse
// in place from their home (floating dust), then reassemble when you release.
//
// Perf: the sim is driven by a hand-rolled transform buffer + an ACTIVE-INDEX
// LIST, so per-frame work is O(active particles), never O(total). Sleeping
// particles aren't touched at all. Fingers wake particles through a static
// SPATIAL GRID (built from home positions), so waking never scans the whole
// disc either. The hot loop is trig-free (orbit via small-angle rotation,
// squared-distance falloff) with one shared sin/frame for the swarm's breathing.
// When nothing is active the frame callback does almost nothing and skips the
// GPU re-upload entirely.
const S = 10; // sprite source size (px) — small so tiny dots stay crisp
const R_GRAB = 90; // radius (around a home) a finger must reach to melt it
const R_GRAB2 = R_GRAB * R_GRAB;
const STIFF = 120; // spring stiffness toward the target
const DAMP = 14; // velocity damping (under-critical → lively flutter)
const MAX_FINGERS = 8;
const CELL = 45; // spatial-grid cell size (px)

// The resting body: one continuous white disc. Under a finger it doesn't take a
// clean bite — it DISSOLVES grain by grain: at each pixel the local excitation
// is compared against a static value-noise threshold, so the material erodes
// with a crumbling edge exactly like it's disintegrating. The particles use the
// same excitation with per-grain thresholds, so the bits that lift off are the
// bits the disc is losing.
const baseSource = Skia.RuntimeEffect.Make(`
uniform float2 u_resolution;
uniform float2 u_center;
uniform float u_radius;
uniform float2 u_holePos[${MAX_FINGERS}];
uniform float u_holeM[${MAX_FINGERS}];

float hash21(float2 p) {
  p = fract(p * float2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}
float vnoise(float2 p) {
  float2 i = floor(p);
  float2 f = fract(p);
  float2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + float2(1.0, 0.0));
  float c = hash21(i + float2(0.0, 1.0));
  float d = hash21(i + float2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

half4 main(float2 fc) {
  float dd = length(fc - u_center);
  float disc = smoothstep(u_radius, u_radius - 1.5, dd);
  if (disc <= 0.0) { return half4(0.0); }
  // Aggregate excitation at this pixel (max over the melt centers).
  float exc = 0.0;
  for (int i = 0; i < ${MAX_FINGERS}; i++) {
    float m = u_holeM[i];
    if (m <= 0.0) { continue; }
    float2 h = fc - u_holePos[i];
    float u = 1.0 - dot(h, h) / float(${R_GRAB2});
    if (u < 0.0) { u = 0.0; }
    float s = u * u * (3.0 - 2.0 * u);
    exc = max(exc, m * s);
  }
  // Grainy erosion: this grain is gone once excitation passes its noise
  // threshold. Solid everywhere at rest (exc = 0 → dissolved = 0).
  float n = vnoise(fc * 0.28);
  float dissolved = smoothstep(n, n + 0.18, exc);
  float a = disc * (1.0 - dissolved);
  return half4(a, a, a, a); // premultiplied white
}
`)!;

type Sim = {
  count: number;
  baseScale: number;
  hx: Float32Array; // home positions
  hy: Float32Array;
  px: Float32Array; // live positions
  py: Float32Array;
  vx: Float32Array; // velocities
  vy: Float32Array;
  ex: Float32Array; // excitation 0..1 (0 = home, 1 = fully melted here)
  thr: Float32Array; // per-grain release threshold (grainy disintegration)
  sw: Float32Array; // drift spin rate + direction
  ocx: Float32Array; // scatter offset vector (home → dispersed spot), drifts
  ocy: Float32Array;
  // active-index list (compacted each frame) + membership flags
  al: Int32Array;
  ac: Int32Array; // [0] = number of active particles
  af: Float32Array; // per-particle: 1 = in the active list
  // static spatial grid over home positions (CSR layout)
  gridW: number;
  gridH: number;
  minX: number;
  minY: number;
  cellStart: Int32Array; // length gridW*gridH + 1
  cellItems: Int32Array; // length count, particle indices grouped by cell
  // per-frame scratch
  fx: Float32Array; // finger snapshot (x)
  fy: Float32Array; // finger snapshot (y)
  gwob: Float32Array; // [0] = global orbit-radius wobble (one sin per frame)
  // disc-hole state (one slot per finger id; persists through release to fade)
  holeId: Float32Array; // bound finger id, or -1 when free
  holeX: Float32Array;
  holeY: Float32Array;
  holeM: Float32Array; // 0..1 openness (ramps up held, down on release)
  holeTgt: Float32Array; // per-frame target openness
};

function buildSim(width: number, height: number, radius: number): Sim {
  const cx = width / 2;
  const cy = height / 2;
  // Ring spacing sets both density and dot size. Small for tiny particles;
  // eased up a touch on very large screens to keep the particle count sane.
  const dr = Math.max(1.7, radius / 72);
  const hxA: number[] = [];
  const hyA: number[] = [];
  hxA.push(cx); // center point
  hyA.push(cy);
  for (let r = dr; r <= radius; r += dr) {
    const n = Math.max(6, Math.round((2 * Math.PI * r) / dr));
    const off = Math.random() * Math.PI * 2; // rotate each ring so it's not spoked
    for (let k = 0; k < n; k++) {
      const a = off + (k / n) * Math.PI * 2;
      hxA.push(cx + Math.cos(a) * r);
      hyA.push(cy + Math.sin(a) * r);
    }
  }
  const count = hxA.length;
  const hx = Float32Array.from(hxA);
  const hy = Float32Array.from(hyA);
  const thr = new Float32Array(count);
  const sw = new Float32Array(count);
  const ocx = new Float32Array(count);
  const ocy = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const mag = 12 + Math.random() * 34; // how far this grain drifts once loose
    thr[i] = Math.random(); // grain releases when local excitation exceeds this
    sw[i] = (Math.random() * 2 - 1) * 0.9; // slow drift of the scatter direction
    ocx[i] = Math.cos(a) * mag;
    ocy[i] = Math.sin(a) * mag;
  }

  // Static spatial grid over home positions (counting sort → CSR).
  const minX = cx - radius - CELL;
  const minY = cy - radius - CELL;
  const gridW = Math.ceil((2 * radius + 2 * CELL) / CELL) + 1;
  const gridH = gridW;
  const numCells = gridW * gridH;
  const cellOf = (x: number, y: number) => {
    let col = Math.floor((x - minX) / CELL);
    let row = Math.floor((y - minY) / CELL);
    if (col < 0) col = 0;
    else if (col >= gridW) col = gridW - 1;
    if (row < 0) row = 0;
    else if (row >= gridH) row = gridH - 1;
    return row * gridW + col;
  };
  const cellStart = new Int32Array(numCells + 1);
  for (let i = 0; i < count; i++) cellStart[cellOf(hx[i], hy[i]) + 1]++;
  for (let c = 1; c <= numCells; c++) cellStart[c] += cellStart[c - 1];
  const cellItems = new Int32Array(count);
  const cursor = Int32Array.from(cellStart.subarray(0, numCells));
  for (let i = 0; i < count; i++) {
    const c = cellOf(hx[i], hy[i]);
    cellItems[cursor[c]++] = i;
  }

  // Everyone starts active so frame 1 writes each particle's home transform
  // (the buffer is initialised to identity); they immediately settle to sleep.
  const al = new Int32Array(count);
  for (let i = 0; i < count; i++) al[i] = i;
  const ac = new Int32Array(1);
  ac[0] = count;

  return {
    count,
    baseScale: (dr * 1.45) / S, // dot diameter ~1.45× ring spacing → seamless fill
    hx,
    hy,
    px: hx.slice(),
    py: hy.slice(),
    vx: new Float32Array(count),
    vy: new Float32Array(count),
    ex: new Float32Array(count),
    thr,
    sw,
    ocx,
    ocy,
    al,
    ac,
    af: new Float32Array(count).fill(1),
    gridW,
    gridH,
    minX,
    minY,
    cellStart,
    cellItems,
    fx: new Float32Array(MAX_FINGERS),
    fy: new Float32Array(MAX_FINGERS),
    gwob: new Float32Array(1).fill(1),
    holeId: new Float32Array(MAX_FINGERS).fill(-1),
    holeX: new Float32Array(MAX_FINGERS),
    holeY: new Float32Array(MAX_FINGERS),
    holeM: new Float32Array(MAX_FINGERS),
    holeTgt: new Float32Array(MAX_FINGERS),
  };
}

export default function FenceDisintegrate() {
  const { width, height } = useWindowDimensions();
  const radius = Math.min(width, height) * 0.32;

  const sim = useMemo(() => buildSim(width, height, radius), [width, height, radius]);
  const simSV = useSharedValue<Sim>(sim);
  simSV.value = sim;
  const count = sim.count;

  // A soft-edged white dot sprite, baked on the UI thread (GPU context there).
  const spriteImage = useTexture(
    <Circle cx={S / 2} cy={S / 2} r={S / 2 - 1} color="white">
      <BlurMask blur={0.6} style="normal" />
    </Circle>,
    { width: S, height: S }
  );

  const sprites = useMemo(
    () => new Array(count).fill(0).map(() => Skia.XYWHRect(0, 0, S, S)),
    [count]
  );

  // Our own transform buffer (pooled RSXform host objects, mutated in place).
  // Particles start INVISIBLE (scale 0) — the base disc is the resting body;
  // particles only appear as they're excited and fly.
  const initialTransforms = useMemo<SkRSXform[]>(() => {
    const arr = new Array<SkRSXform>(count);
    for (let i = 0; i < count; i++) arr[i] = Skia.RSXform(0, 0, sim.hx[i], sim.hy[i]);
    return arr;
  }, [sim, count]);
  const transforms = useSharedValue<SkRSXform[]>(initialTransforms);
  if (transforms.value.length !== count) transforms.value = initialTransforms; // resize

  // Uniforms for the base disc (holes update from the frame callback).
  const baseInit = useMemo(
    () => ({
      u_resolution: [width, height],
      u_center: [width / 2, height / 2],
      u_radius: radius,
      u_holePos: new Array(MAX_FINGERS * 2).fill(0),
      u_holeM: new Array(MAX_FINGERS).fill(0),
    }),
    [width, height, radius]
  );
  const baseUni = useSharedValue(baseInit);
  if (baseUni.value.u_radius !== radius) baseUni.value = baseInit; // dimension change

  // Live finger positions (UI-thread shared state, keyed by touch id).
  const fingers = useSharedValue<{ id: number; x: number; y: number }[]>([]);

  useFrameCallback((info) => {
    'worklet';
    const s = simSV.value;
    const T = transforms.value;
    const half = S / 2;
    const base = s.baseScale;

    let dt = (info.timeSincePreviousFrame ?? 16) / 1000;
    if (dt <= 0 || dt > 0.05) dt = 0.016;
    s.gwob[0] = 0.85 + 0.15 * Math.sin((info.timeSinceFirstFrame / 1000) * 3.0);

    // Snapshot fingers.
    const F = fingers.value;
    const nf = F.length < MAX_FINGERS ? F.length : MAX_FINGERS;
    for (let k = 0; k < nf; k++) {
      s.fx[k] = F[k].x;
      s.fy[k] = F[k].y;
    }

    // Disc-hole slots: bind each live finger to a slot (persisting through
    // release so the hole fades out). Reset targets, then reaffirm live fingers.
    for (let j = 0; j < MAX_FINGERS; j++) s.holeTgt[j] = 0;
    for (let k = 0; k < nf; k++) {
      const id = F[k].id;
      let slot = -1;
      for (let j = 0; j < MAX_FINGERS; j++) {
        if (s.holeId[j] === id) {
          slot = j;
          break;
        }
      }
      if (slot < 0) {
        for (let j = 0; j < MAX_FINGERS; j++) {
          if (s.holeId[j] < 0) {
            slot = j;
            break;
          }
        }
      }
      if (slot >= 0) {
        s.holeId[slot] = id;
        s.holeX[slot] = F[k].x;
        s.holeY[slot] = F[k].y;
        s.holeTgt[slot] = 1;
      }
    }
    let anyHole = false;
    for (let j = 0; j < MAX_FINGERS; j++) {
      const tgt = s.holeTgt[j];
      const hrate = tgt > s.holeM[j] ? 11 : 2.4; // open fast, close slow (mirrors ex)
      s.holeM[j] += (tgt - s.holeM[j]) * Math.min(1, hrate * dt);
      if (s.holeM[j] < 0.004 && tgt === 0) {
        s.holeM[j] = 0;
        s.holeId[j] = -1;
      }
      if (s.holeM[j] > 0.001) anyHole = true;
    }

    const af = s.af;
    const al = s.al;
    let ac = s.ac[0];

    // WAKE: for each finger, walk only the grid cells overlapping its reach and
    // activate sleeping particles whose HOME is within R_GRAB.
    if (nf > 0) {
      const cellStart = s.cellStart;
      const cellItems = s.cellItems;
      const gw = s.gridW;
      const gh = s.gridH;
      const mnx = s.minX;
      const mny = s.minY;
      for (let k = 0; k < nf; k++) {
        const fxx = s.fx[k];
        const fyy = s.fy[k];
        let c0 = Math.floor((fxx - R_GRAB - mnx) / CELL);
        let c1 = Math.floor((fxx + R_GRAB - mnx) / CELL);
        let r0 = Math.floor((fyy - R_GRAB - mny) / CELL);
        let r1 = Math.floor((fyy + R_GRAB - mny) / CELL);
        if (c0 < 0) c0 = 0;
        if (c1 >= gw) c1 = gw - 1;
        if (r0 < 0) r0 = 0;
        if (r1 >= gh) r1 = gh - 1;
        for (let row = r0; row <= r1; row++) {
          const bcell = row * gw;
          for (let col = c0; col <= c1; col++) {
            const cell = bcell + col;
            const end = cellStart[cell + 1];
            for (let idx = cellStart[cell]; idx < end; idx++) {
              const p = cellItems[idx];
              if (af[p] === 0) {
                const ddx = s.hx[p] - fxx;
                const ddy = s.hy[p] - fyy;
                if (ddx * ddx + ddy * ddy < R_GRAB2) {
                  af[p] = 1;
                  al[ac] = p;
                  ac++;
                }
              }
            }
          }
        }
      }
    }

    // SIMULATE the active list, writing transforms and compacting out sleepers.
    const gwob = s.gwob[0];
    let w = 0;
    for (let r = 0; r < ac; r++) {
      const p = al[r];
      const hx = s.hx[p];
      const hy = s.hy[p];

      // Excitation from HOME→finger distance (melt strength at this grain).
      let bestD2 = 1e18;
      for (let k = 0; k < nf; k++) {
        const ddx = hx - s.fx[k];
        const ddy = hy - s.fy[k];
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 < bestD2) bestD2 = d2;
      }
      const nearHome = nf > 0 && bestD2 < R_GRAB2;
      let exT = 0;
      if (nearHome) {
        let u = 1 - bestD2 / R_GRAB2;
        if (u < 0) u = 0;
        exT = u * u * (3 - 2 * u);
      }
      let ex = s.ex[p];
      const rate = exT > ex ? 11 : 2.4; // melt fast, reform slow
      ex += (exT - ex) * Math.min(1, rate * dt);
      s.ex[p] = ex;

      // Grain release: this grain only detaches once excitation passes its own
      // threshold (smoothstep(thr, thr+0.18, ex)) — grainy, matching the disc.
      let rr = (ex - s.thr[p]) / 0.18;
      if (rr < 0) rr = 0;
      else if (rr > 1) rr = 1;
      rr = rr * rr * (3 - 2 * rr);

      let px = s.px[p];
      let py = s.py[p];
      let dx = hx;
      let dy = hy;
      if (rr > 0.001) {
        // Drift the scatter offset (slow rotation, no trig) and disperse the
        // grain from its HOME by that offset — the material breaks up in place.
        let ocx = s.ocx[p];
        let ocy = s.ocy[p];
        const th = s.sw[p] * dt;
        const cs = 1 - 0.5 * th * th;
        const nx = ocx * cs - ocy * th;
        const ny = ocx * th + ocy * cs;
        ocx = nx;
        ocy = ny;
        s.ocx[p] = ocx;
        s.ocy[p] = ocy;
        dx = hx + ocx * gwob * rr;
        dy = hy + ocy * gwob * rr;
      }

      // Spring-damper integration.
      let vx = s.vx[p];
      let vy = s.vy[p];
      vx += ((dx - px) * STIFF - vx * DAMP) * dt;
      vy += ((dy - py) * STIFF - vy * DAMP) * dt;
      px += vx * dt;
      py += vy * dt;

      const dhx = px - hx;
      const dhy = py - hy;
      if (!nearHome && ex < 0.002 && vx * vx + vy * vy < 0.25 && dhx * dhx + dhy * dhy < 0.25) {
        // Settle → sleep: snap exactly home, write once, drop from the list.
        s.px[p] = hx;
        s.py[p] = hy;
        s.vx[p] = 0;
        s.vy[p] = 0;
        s.ex[p] = 0;
        af[p] = 0;
        T[p].set(0, 0, hx, hy); // asleep → invisible (the base disc fills here)
      } else {
        s.px[p] = px;
        s.py[p] = py;
        s.vx[p] = vx;
        s.vy[p] = vy;
        const sc = base * rr; // visible only once released (grainy)
        T[p].set(sc, 0, px - half * sc, py - half * sc);
        al[w] = p;
        w++;
      }
    }
    s.ac[0] = w;

    // Only push the buffer to the GPU if something actually moved this frame.
    if (ac > 0) {
      // @ts-ignore reanimated Mutable internal — mirrors Skia's notifyChange()
      transforms._value = T;
    }
    // Update the disc's holes whenever any are open (or particles are flying).
    if (ac > 0 || anyHole) {
      const hp: number[] = [];
      const hm: number[] = [];
      for (let j = 0; j < MAX_FINGERS; j++) {
        hp.push(s.holeX[j], s.holeY[j]);
        hm.push(s.holeM[j]);
      }
      baseUni.value = {
        u_resolution: [width, height],
        u_center: [width / 2, height / 2],
        u_radius: radius,
        u_holePos: hp,
        u_holeM: hm,
      };
    }
  });

  const gesture = Gesture.Pan()
    .minDistance(0)
    .onTouchesDown((e) => {
      'worklet';
      let arr = fingers.value.slice();
      for (let k = 0; k < e.changedTouches.length; k++) {
        const t = e.changedTouches[k];
        arr = arr.filter((f) => f.id !== t.id);
        arr.push({ id: t.id, x: t.x, y: t.y });
      }
      fingers.value = arr;
    })
    .onTouchesMove((e) => {
      'worklet';
      const arr = fingers.value.slice();
      for (let k = 0; k < e.changedTouches.length; k++) {
        const t = e.changedTouches[k];
        const j = arr.findIndex((f) => f.id === t.id);
        if (j >= 0) arr[j] = { id: t.id, x: t.x, y: t.y };
      }
      fingers.value = arr;
    })
    .onTouchesUp((e) => {
      'worklet';
      let arr = fingers.value.slice();
      for (let k = 0; k < e.changedTouches.length; k++) {
        arr = arr.filter((f) => f.id !== e.changedTouches[k].id);
      }
      fingers.value = arr;
    })
    .onTouchesCancelled((e) => {
      'worklet';
      let arr = fingers.value.slice();
      for (let k = 0; k < e.changedTouches.length; k++) {
        arr = arr.filter((f) => f.id !== e.changedTouches[k].id);
      }
      fingers.value = arr;
    });

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.fill}>
        <Canvas style={StyleSheet.absoluteFill}>
          <Fill color="#000" />
          <Fill>
            <Shader source={baseSource} uniforms={baseUni} />
          </Fill>
          <Atlas image={spriteImage} sprites={sprites} transforms={transforms} />
        </Canvas>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
});
