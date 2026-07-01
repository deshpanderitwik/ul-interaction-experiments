import {
  Atlas,
  BlurMask,
  Canvas,
  Circle,
  Fill,
  Skia,
  useClock,
  useRSXformBuffer,
  useTexture,
} from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSharedValue } from 'react-native-reanimated';

// Fence · Disintegrating Circle — a solid WHITE disc made of many thousands of
// tiny particles laid out in concentric rings (uniform density + an exact round
// edge, so at rest it reads as a perfect solid circle). Hold anywhere and the
// particles at that spot DISENGAGE from their home and flutter/orbit around your
// finger; release and they spring back home, reassembling the circle.
//
// Perf: at any instant only a few hundred particles (those near a finger, or
// still flying home) are actually moving. Each particle SLEEPS once it settles
// at home — sleeping particles are skipped entirely (no math, no native
// transform write) until a finger comes within reach and wakes them. Fingers
// are snapshotted once per frame, and all per-particle state lives in flat
// Float32Arrays. The active hot loop is fully trig-free: the orbit direction is
// advanced by a small-angle rotation (a few multiplies) and the distance
// falloff uses squared distance, so the only transcendental per frame is one
// shared sin for the whole swarm's breathing. Per-frame cost tracks the number
// of *active* particles, not the total.
const S = 10; // sprite source size (px) — small so tiny dots stay crisp
const R_GRAB = 130; // how near the finger a particle must be to get captured
const R_GRAB2 = R_GRAB * R_GRAB;
const STIFF = 120; // spring stiffness toward the target
const DAMP = 14; // velocity damping (under-critical → lively flutter)
const MAX_FINGERS = 8;

type Sim = {
  count: number;
  baseScale: number;
  hx: Float32Array; // home positions
  hy: Float32Array;
  px: Float32Array; // live positions
  py: Float32Array;
  vx: Float32Array; // velocities
  vy: Float32Array;
  ex: Float32Array; // excitation 0..1 (0 = home, 1 = orbiting finger)
  active: Float32Array; // 1 = simulate this frame, 0 = sleeping at home
  sw: Float32Array; // angular speed (orbit spin rate + direction)
  sr: Float32Array; // orbit radius
  ocx: Float32Array; // orbit direction vector (unit-ish), rotated incrementally
  ocy: Float32Array;
  fx: Float32Array; // per-frame finger snapshot (x)
  fy: Float32Array; // per-frame finger snapshot (y)
  nf: Float32Array; // [0] = number of fingers this frame
  gwob: Float32Array; // [0] = global orbit-radius wobble (one sin per frame)
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
  const sw = new Float32Array(count);
  const sr = new Float32Array(count);
  const ocx = new Float32Array(count);
  const ocy = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    sw[i] = (Math.random() * 2 - 1) * 2.0; // spin direction + speed
    sr[i] = 28 + Math.random() * 80; // orbit radius around the finger
    ocx[i] = Math.cos(a); // starting orbit direction (rotated each frame, no trig)
    ocy[i] = Math.sin(a);
  }
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
    active: new Float32Array(count).fill(1), // everyone writes home on frame 1
    sw,
    sr,
    ocx,
    ocy,
    fx: new Float32Array(MAX_FINGERS),
    fy: new Float32Array(MAX_FINGERS),
    nf: new Float32Array(1),
    gwob: new Float32Array(1).fill(1),
  };
}

export default function FenceDisintegrate() {
  const { width, height } = useWindowDimensions();
  const radius = Math.min(width, height) * 0.32;
  const clock = useClock();

  const sim = useMemo(() => buildSim(width, height, radius), [width, height, radius]);
  const simSV = useSharedValue<Sim>(sim);
  simSV.value = sim;
  const count = sim.count;

  // A soft-edged white dot sprite, baked to a texture on the UI thread (where a
  // GPU context exists — MakeOffscreen returns null on the JS thread).
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

  // Live finger positions (UI-thread shared state, keyed by touch id).
  const fingers = useSharedValue<{ id: number; x: number; y: number }[]>([]);

  // Per-frame delta, computed once (at i === 0) and reused for every particle.
  const lastClock = useSharedValue(0);
  const dtSV = useSharedValue(0.016);

  const transforms = useRSXformBuffer(count, (val, i) => {
    'worklet';
    const s = simSV.value;
    const half = S / 2;

    // Once per frame: advance the clock and snapshot the fingers into flat
    // scratch arrays, so per-particle work never touches a shared value.
    if (i === 0) {
      const c = clock.value;
      let dt = (c - lastClock.value) / 1000;
      if (dt <= 0 || dt > 0.05) dt = 0.016;
      dtSV.value = dt;
      lastClock.value = c;
      s.gwob[0] = 0.85 + 0.15 * Math.sin((c / 1000) * 3.0); // one sin for the whole swarm
      const F = fingers.value;
      const n = F.length < MAX_FINGERS ? F.length : MAX_FINGERS;
      s.nf[0] = n;
      for (let k = 0; k < n; k++) {
        s.fx[k] = F[k].x;
        s.fy[k] = F[k].y;
      }
    }

    const nf = s.nf[0];
    let px = s.px[i];
    let py = s.py[i];

    // Cheap: nearest finger by *squared* distance (no sqrt).
    let bestD2 = 1e18;
    let fx = 0;
    let fy = 0;
    for (let k = 0; k < nf; k++) {
      const ddx = px - s.fx[k];
      const ddy = py - s.fy[k];
      const d2 = ddx * ddx + ddy * ddy;
      if (d2 < bestD2) {
        bestD2 = d2;
        fx = s.fx[k];
        fy = s.fy[k];
      }
    }
    const near = nf > 0 && bestD2 < R_GRAB2;

    // SLEEP CULL: a settled particle with no finger nearby is left exactly as it
    // was written last (its home transform) — skip all work for it.
    if (s.active[i] < 0.5 && !near) return;

    const hx = s.hx[i];
    const hy = s.hy[i];
    const dt = dtSV.value;

    // Excitation target from *squared* distance (no sqrt): smoothstep(1 − d²/R²).
    let exT = 0;
    if (near) {
      let u = 1 - bestD2 / R_GRAB2;
      if (u < 0) u = 0;
      exT = u * u * (3 - 2 * u);
    }
    let ex = s.ex[i];
    const rate = exT > ex ? 11 : 2.4; // grab fast, release slow
    ex += (exT - ex) * Math.min(1, rate * dt);
    s.ex[i] = ex;

    // Desired position: home ↔ orbit-around-finger, blended by excitation. The
    // orbit direction is advanced by a small-angle rotation (no trig): rotate
    // (ocx, ocy) by θ = sw·dt using cos θ ≈ 1 − θ²/2, sin θ ≈ θ.
    let dx = hx;
    let dy = hy;
    let ocx = s.ocx[i];
    let ocy = s.ocy[i];
    if (ex > 0.001 && nf > 0) {
      const th = s.sw[i] * dt;
      const cs = 1 - 0.5 * th * th;
      const nx = ocx * cs - ocy * th;
      const ny = ocx * th + ocy * cs;
      ocx = nx;
      ocy = ny;
      s.ocx[i] = ocx;
      s.ocy[i] = ocy;
      const orr = s.sr[i] * s.gwob[0];
      dx = hx + (fx + ocx * orr - hx) * ex;
      dy = hy + (fy + ocy * orr - hy) * ex;
    }

    // Spring-damper integration.
    let vx = s.vx[i];
    let vy = s.vy[i];
    vx += ((dx - px) * STIFF - vx * DAMP) * dt;
    vy += ((dy - py) * STIFF - vy * DAMP) * dt;
    px += vx * dt;
    py += vy * dt;

    // Settle test: essentially at home, still, and un-excited → go to sleep and
    // snap exactly home so the frozen transform is pixel-perfect.
    const dhx = px - hx;
    const dhy = py - hy;
    if (ex < 0.002 && vx * vx + vy * vy < 0.25 && dhx * dhx + dhy * dhy < 0.25) {
      s.px[i] = hx;
      s.py[i] = hy;
      s.vx[i] = 0;
      s.vy[i] = 0;
      s.active[i] = 0;
      const sc = s.baseScale;
      val.set(sc, 0, hx - half * sc, hy - half * sc);
      return;
    }

    s.vx[i] = vx;
    s.vy[i] = vy;
    s.px[i] = px;
    s.py[i] = py;
    s.active[i] = 1;
    const sc = s.baseScale * (1 - 0.3 * ex); // shrink while flying → flakes
    val.set(sc, 0, px - half * sc, py - half * sc);
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
          <Atlas image={spriteImage} sprites={sprites} transforms={transforms} />
        </Canvas>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
});
