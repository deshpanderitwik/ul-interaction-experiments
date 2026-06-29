import {
  Canvas,
  Circle,
  Path,
  Group,
  useClock,
} from '@shopify/react-native-skia';
import { useRef, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useDerivedValue, useSharedValue } from 'react-native-reanimated';
import { useExperimentActive } from '../_host';
import {
  A_MAX_S,
  D_MAX_S,
  R_MAX_S,
  DEFAULT_ENV,
  envSeconds,
  playEnvelope,
  type Envelope,
} from './shared';

// ADSR — a single sine voice whose Attack/Decay/Sustain/Release envelope you
// shape directly by dragging three handles on a time×amplitude plot:
//   • the peak handle (top of the attack ramp) sets ATTACK,
//   • the corner handle sets DECAY (←→) and SUSTAIN level (↑↓),
//   • the tail handle sets RELEASE.
// Double-tap anywhere to fire a one-shot pulse with the current envelope; a
// playhead traces the curve in real time so you can see the shape you hear.

const ACCENT = '#ff9f43';
const PAD = { left: 40, right: 40, top: 172, bottom: 156 };
const SUSTAIN_HOLD_PX = 54; // fixed-width visual for the held-sustain segment
const HANDLE_R = 13;
const HIT_R = 48; // finger-friendly grab radius

type Pt = { x: number; y: number };
type Layout = { w: number; h: number };

// Pure geometry: envelope params + canvas size → the five points of the curve.
function geom(env: Envelope, { w, h }: Layout) {
  const x0 = PAD.left;
  const topY = PAD.top;
  const baseY = h - PAD.bottom;
  const plotH = baseY - topY;
  const plotW = w - PAD.left - PAD.right;
  const maxSeg = (plotW - SUSTAIN_HOLD_PX) / 3;

  const ax = x0 + env.a * maxSeg;
  const dx = ax + env.d * maxSeg;
  const susY = baseY - env.s * plotH;
  const sx = dx + SUSTAIN_HOLD_PX;
  const rx = sx + env.r * maxSeg;

  const p0: Pt = { x: x0, y: baseY };
  const p1: Pt = { x: ax, y: topY }; // attack peak
  const p2: Pt = { x: dx, y: susY }; // decay → sustain corner
  const p3: Pt = { x: sx, y: susY }; // end of sustain hold
  const p4: Pt = { x: rx, y: baseY }; // release tail
  return { x0, topY, baseY, plotH, maxSeg, sx, ax, p0, p1, p2, p3, p4 };
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export default function ADSR() {
  const live = useExperimentActive();
  const clock = useClock();
  const [layout, setLayout] = useState<Layout>({ w: 0, h: 0 });
  const [env, setEnv] = useState<Envelope>(DEFAULT_ENV);
  const [grabbed, setGrabbed] = useState<number | null>(null);

  // Refs mirror state so gesture callbacks (which capture once) read fresh
  // values without restitching the gesture on every change.
  const envRef = useRef(env);
  envRef.current = env;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const grabbedRef = useRef<number | null>(null);

  // Playhead: a flat snapshot of the firing curve the worklet walks over time.
  // p = [x0,y0,...,x4,y4] (10), t = segment durations [atk,dec,hold,rel] ms.
  const play = useSharedValue({
    start: 0,
    total: 0,
    p: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    t: [0, 0, 0, 0],
  });

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setLayout({ w: width, h: height });
  };

  // Pick the nearest handle to the touch (peak=1, corner=2, tail=4 only).
  const pick = (x: number, y: number) => {
    if (layoutRef.current.w === 0) return;
    const g = geom(envRef.current, layoutRef.current);
    const cands: [number, Pt][] = [
      [1, g.p1],
      [2, g.p2],
      [4, g.p4],
    ];
    let best: number | null = null;
    let bestD = HIT_R * HIT_R;
    for (const [id, p] of cands) {
      const dx = p.x - x;
      const dy = p.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= bestD) {
        bestD = d2;
        best = id;
      }
    }
    grabbedRef.current = best;
    setGrabbed(best);
    if (best !== null) Haptics.selectionAsync().catch(() => {});
  };

  const move = (x: number, y: number) => {
    const id = grabbedRef.current;
    if (id === null) return;
    const lay = layoutRef.current;
    const g = geom(envRef.current, lay);
    const next = { ...envRef.current };
    if (id === 1) {
      next.a = clamp01((x - g.x0) / g.maxSeg);
    } else if (id === 2) {
      next.d = clamp01((x - g.ax) / g.maxSeg);
      next.s = clamp01((g.baseY - y) / g.plotH);
    } else if (id === 4) {
      next.r = clamp01((x - g.sx) / g.maxSeg);
    }
    envRef.current = next;
    setEnv(next);
  };

  const release = () => {
    grabbedRef.current = null;
    setGrabbed(null);
  };

  // Fire a pulse and arm the playhead from the live geometry.
  const fire = () => {
    const e = envRef.current;
    playEnvelope(e);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    if (layoutRef.current.w === 0) return;
    const g = geom(e, layoutRef.current);
    const s = envSeconds(e);
    play.value = {
      start: clock.value,
      total: (s.attack + s.decay + s.hold + s.release) * 1000,
      p: [g.p0.x, g.p0.y, g.p1.x, g.p1.y, g.p2.x, g.p2.y, g.p3.x, g.p3.y, g.p4.x, g.p4.y],
      t: [s.attack * 1000, s.decay * 1000, s.hold * 1000, s.release * 1000],
    };
  };

  const pan = Gesture.Pan()
    .maxPointers(1)
    .onStart((e) => runOnJS(pick)(e.x, e.y))
    .onChange((e) => runOnJS(move)(e.x, e.y))
    .onFinalize(() => runOnJS(release)());

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(280)
    .onEnd(() => runOnJS(fire)());

  const gesture = Gesture.Race(pan, doubleTap);

  // Playhead position along the piecewise curve, driven by the Skia clock.
  const head = useDerivedValue(() => {
    'worklet';
    const pb = play.value;
    const elapsed = clock.value - pb.start;
    if (pb.total <= 0 || elapsed < 0 || elapsed > pb.total + 260) {
      return { x: 0, y: 0, o: 0 };
    }
    const lerp = (i: number, j: number, f: number) => ({
      x: pb.p[i * 2] + (pb.p[j * 2] - pb.p[i * 2]) * f,
      y: pb.p[i * 2 + 1] + (pb.p[j * 2 + 1] - pb.p[i * 2 + 1]) * f,
    });
    const [dA, dD, dH, dR] = pb.t;
    let pos;
    if (elapsed < dA) pos = lerp(0, 1, dA > 0 ? elapsed / dA : 1);
    else if (elapsed < dA + dD) pos = lerp(1, 2, dD > 0 ? (elapsed - dA) / dD : 1);
    else if (elapsed < dA + dD + dH) pos = lerp(2, 3, dH > 0 ? (elapsed - dA - dD) / dH : 1);
    else if (elapsed < pb.total) pos = lerp(3, 4, dR > 0 ? (elapsed - dA - dD - dH) / dR : 1);
    else pos = { x: pb.p[8], y: pb.p[9] };
    // Hold full opacity through the note, then a short fade after it ends.
    const o = elapsed <= pb.total ? 1 : Math.max(0, 1 - (elapsed - pb.total) / 260);
    return { x: pos.x, y: pos.y, o };
  });
  const headX = useDerivedValue(() => head.value.x);
  const headY = useDerivedValue(() => head.value.y);
  const headO = useDerivedValue(() => head.value.o);
  const headGlowR = useDerivedValue(() => HANDLE_R + 9 * head.value.o);

  const ready = layout.w > 0 && layout.h > 0;
  const g = ready ? geom(env, layout) : null;
  const stroke = g
    ? `M ${g.p0.x} ${g.p0.y} L ${g.p1.x} ${g.p1.y} L ${g.p2.x} ${g.p2.y} L ${g.p3.x} ${g.p3.y} L ${g.p4.x} ${g.p4.y}`
    : '';
  const fillPath = g ? `${stroke} L ${g.p4.x} ${g.baseY} Z` : '';
  const handles = g
    ? [
        { id: 1, p: g.p1, label: 'A' },
        { id: 2, p: g.p2, label: 'S' },
        { id: 4, p: g.p4, label: 'R' },
      ]
    : [];

  const sec = envSeconds(env);

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.fill} onLayout={onLayout}>
        <Text style={styles.title}>ADSR</Text>

        {ready && g ? (
          <Canvas style={StyleSheet.absoluteFill}>
            {/* baseline */}
            <Path
              path={`M ${g.x0} ${g.baseY} L ${layout.w - PAD.right} ${g.baseY}`}
              style="stroke"
              color="rgba(255,255,255,0.14)"
              strokeWidth={1}
            />
            {/* area under the envelope */}
            <Path path={fillPath} color={ACCENT} opacity={0.12} />
            {/* envelope curve */}
            <Path
              path={stroke}
              style="stroke"
              color={ACCENT}
              strokeWidth={2.5}
              strokeJoin="round"
              strokeCap="round"
            />
            {/* playhead */}
            <Group>
              <Circle cx={headX} cy={headY} r={headGlowR} color={ACCENT} opacity={headO} />
            </Group>
            {/* handles */}
            {handles.map((h) => (
              <Group key={h.id}>
                <Circle
                  cx={h.p.x}
                  cy={h.p.y}
                  r={grabbed === h.id ? HANDLE_R + 4 : HANDLE_R}
                  color="#000"
                />
                <Circle
                  cx={h.p.x}
                  cy={h.p.y}
                  r={grabbed === h.id ? HANDLE_R + 4 : HANDLE_R}
                  style="stroke"
                  strokeWidth={2.5}
                  color={ACCENT}
                />
                <Circle cx={h.p.x} cy={h.p.y} r={3} color={ACCENT} />
              </Group>
            ))}
          </Canvas>
        ) : null}

        {/* readouts */}
        <View style={styles.readouts}>
          <Readout label="Attack" value={`${(sec.attack * 1000) | 0} ms`} />
          <Readout label="Decay" value={`${(sec.decay * 1000) | 0} ms`} />
          <Readout label="Sustain" value={`${Math.round(env.s * 100)}%`} />
          <Readout label="Release" value={`${(sec.release * 1000) | 0} ms`} />
        </View>

        <Text style={styles.hint}>drag handles to shape · double-tap to play</Text>
      </View>
    </GestureDetector>
  );
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.readout}>
      <Text style={styles.readoutValue}>{value}</Text>
      <Text style={styles.readoutLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  title: {
    position: 'absolute',
    top: 110,
    alignSelf: 'center',
    color: 'rgba(255,255,255,0.55)',
    fontSize: 13,
    letterSpacing: 4,
    fontWeight: '600',
  },
  readouts: {
    position: 'absolute',
    bottom: 78,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-evenly',
  },
  readout: { alignItems: 'center' },
  readoutValue: { color: '#fff', fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
  readoutLabel: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 11,
    letterSpacing: 1,
    marginTop: 3,
    textTransform: 'uppercase',
  },
  hint: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    color: 'rgba(255,255,255,0.3)',
    fontSize: 14,
    letterSpacing: 0.5,
  },
});
