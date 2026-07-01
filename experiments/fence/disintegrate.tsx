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

// Fence · Disintegrating Circle — a solid WHITE disc made of ~thousands of tiny
// particles. Hold anywhere and the particles at that spot DISENGAGE from their
// home and flutter/orbit around your finger; release and they spring back home,
// reassembling the circle. Each particle is a spring-damper pulled toward a
// target that blends between its home (at rest) and an orbit around the nearest
// held finger (while excited). Rendered with Skia's instanced Atlas so the whole
// swarm is one GPU draw. Multitouch; drag to carry the swarm along.

const S = 24; // sprite source size (px)
const R_GRAB = 130; // how near the finger a particle must be to get captured
const STIFF = 120; // spring stiffness toward the target
const DAMP = 14; // velocity damping (under-critical → lively flutter)

type Sim = {
  count: number;
  baseScale: number;
  hx: number[]; // home positions
  hy: number[];
  px: number[]; // live positions
  py: number[];
  vx: number[]; // velocities
  vy: number[];
  ex: number[]; // excitation 0..1 (0 = home, 1 = orbiting finger)
  sa: number[]; // per-particle seeds: base angle
  sw: number[]; // angular speed
  sr: number[]; // orbit radius
  sf: number[]; // flutter frequency
};

function buildSim(width: number, height: number, radius: number): Sim {
  const cx = width / 2;
  const cy = height / 2;
  const spacing = Math.max(6, radius / 26); // denser on bigger screens
  const hx: number[] = [];
  const hy: number[] = [];
  for (let y = cy - radius; y <= cy + radius; y += spacing) {
    for (let x = cx - radius; x <= cx + radius; x += spacing) {
      const jx = x + (Math.random() - 0.5) * spacing * 0.6;
      const jy = y + (Math.random() - 0.5) * spacing * 0.6;
      if (Math.hypot(jx - cx, jy - cy) <= radius - 1) {
        hx.push(jx);
        hy.push(jy);
      }
    }
  }
  const count = hx.length;
  const sa: number[] = [];
  const sw: number[] = [];
  const sr: number[] = [];
  const sf: number[] = [];
  for (let i = 0; i < count; i++) {
    sa.push(Math.random() * Math.PI * 2);
    sw.push((Math.random() * 2 - 1) * 2.0); // spin direction + speed
    sr.push(28 + Math.random() * 80); // orbit radius around the finger
    sf.push(0.6 + Math.random() * 2.2); // flutter frequency
  }
  return {
    count,
    baseScale: (spacing * 1.8) / S, // dot diameter ~1.8× spacing → reads solid
    hx,
    hy,
    px: hx.slice(),
    py: hy.slice(),
    vx: new Array(count).fill(0),
    vy: new Array(count).fill(0),
    ex: new Array(count).fill(0),
    sa,
    sw,
    sr,
    sf,
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
    <Circle cx={S / 2} cy={S / 2} r={S / 2 - 3} color="white">
      <BlurMask blur={1.6} style="normal" />
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
  const tSV = useSharedValue(0);

  // The simulation + transform build, fused into the Atlas transform buffer so
  // it's a single pass per frame.
  const transforms = useRSXformBuffer(count, (val, i) => {
    'worklet';
    const s = simSV.value;
    if (i === 0) {
      const c = clock.value;
      let dt = (c - lastClock.value) / 1000;
      if (dt <= 0 || dt > 0.05) dt = 0.016;
      dtSV.value = dt;
      lastClock.value = c;
      tSV.value = c / 1000;
    }
    const dt = dtSV.value;
    const t = tSV.value;

    const hx = s.hx[i];
    const hy = s.hy[i];
    let px = s.px[i];
    let py = s.py[i];

    // Nearest active finger to this particle's current position.
    const F = fingers.value;
    let bestD = 1e9;
    let fx = 0;
    let fy = 0;
    let hasF = false;
    for (let k = 0; k < F.length; k++) {
      const d = Math.hypot(px - F[k].x, py - F[k].y);
      if (d < bestD) {
        bestD = d;
        fx = F[k].x;
        fy = F[k].y;
        hasF = true;
      }
    }

    // Excitation target: 1 when a finger is right here, 0 beyond R_GRAB.
    let exT = 0;
    if (hasF) {
      let u = (R_GRAB - bestD) / R_GRAB;
      if (u < 0) u = 0;
      if (u > 1) u = 1;
      exT = u * u * (3 - 2 * u);
    }
    // Rise fast when grabbed, fall slowly when let go (so it flutters, then heals).
    let ex = s.ex[i];
    const rate = exT > ex ? 11 : 2.4;
    ex += (exT - ex) * Math.min(1, rate * dt);
    s.ex[i] = ex;

    // Desired position: blend home ↔ orbit-around-finger by excitation.
    let dx = hx;
    let dy = hy;
    if (ex > 0.001 && hasF) {
      const ang = s.sa[i] + t * s.sw[i];
      const orr = s.sr[i] * (0.72 + 0.28 * Math.sin(t * s.sf[i] + s.sa[i]));
      const ox = fx + Math.cos(ang) * orr;
      const oy = fy + Math.sin(ang) * orr;
      dx = hx + (ox - hx) * ex;
      dy = hy + (oy - hy) * ex;
      // Flutter jitter, only while excited.
      dx += Math.sin(t * 4.0 + s.sa[i] * 13.0) * 5.0 * ex;
      dy += Math.cos(t * 3.3 + s.sa[i] * 7.0) * 5.0 * ex;
    }

    // Spring-damper integration.
    const ax = (dx - px) * STIFF - s.vx[i] * DAMP;
    const ay = (dy - py) * STIFF - s.vy[i] * DAMP;
    const vx = s.vx[i] + ax * dt;
    const vy = s.vy[i] + ay * dt;
    px += vx * dt;
    py += vy * dt;
    s.vx[i] = vx;
    s.vy[i] = vy;
    s.px[i] = px;
    s.py[i] = py;

    // Shrink a touch while flying → looks like flakes breaking off.
    const sc = s.baseScale * (1 - 0.3 * ex);
    const half = S / 2;
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
