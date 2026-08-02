import { useClock } from '@shopify/react-native-skia';
import { useNavigation } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useFrameCallback, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { useExperimentActive } from '../_host';
import { useSharedClock } from '../combinations/clock';
import { useTempo } from '../tempo';

// Time · Overlapping Rings II — each ring is a layer you build on. Tap a slot to
// activate a point on the current ring; every ring's activated points show, in
// its colour, over the top-down view — a composite of all the layers. Slide DOWN
// to tilt into the isometric stack (each layer with its own points), slide UP to
// return to the top-down composite. Swipe left/right to change the layer you're
// editing; tap a ring in the stack to land on it. Back-swipe nav is disabled so
// gestures stay ours.

const BEATS_PER_BAR = 4;
const LOOP_BARS = 2;
const M = 16; // slots per ring
const FLATTEN = 0.3;
const GAP = 50;

const RINGS = [
  { color: '#7ad0ff' },
  { color: '#a0b4ff' },
  { color: '#c9a0ff' },
  { color: '#ff9db0' },
  { color: '#ffd166' },
];
const N = RINGS.length;
const SPREAD = 28; // radial px between co-located dots straddling the beat point

function stepPos(s: number, R: number) {
  const a = (s / M) * 2 * Math.PI - Math.PI / 2;
  return { x: R + R * Math.cos(a), y: R + R * Math.sin(a) };
}

// Metric weight of a 16th position (0 weakest … 4 strongest) → dot size.
function metricLevel(s: number) {
  if (s % 16 === 0) return 4; // downbeat
  if (s % 8 === 0) return 3; // beat 3
  if (s % 4 === 0) return 2; // beats 2 & 4
  if (s % 2 === 0) return 1; // 8th "ands"
  return 0; // weak 16ths
}
const ACT_SIZE = [15, 18, 22, 26, 30]; // activated dot diameter by level
const SLOT_SIZE = [12, 15, 18, 22, 26]; // empty slot diameter by level

type Fan = { idx: number; total: number } | null;

export default function OverlappingRings2() {
  const live = useExperimentActive();
  const tempo = useTempo();
  const localClock = useClock();
  const sharedClock = useSharedClock();
  const clock = sharedClock ?? localClock;
  const { width, height } = useWindowDimensions();
  const navigation = useNavigation();

  const cx = width / 2;
  const cy = height * 0.44;
  const R = Math.min(width * 0.36, height * 0.2);

  const [current, setCurrent] = useState(0);
  const [active, setActive] = useState<boolean[][]>(() => RINGS.map(() => new Array(M).fill(false)));
  const currentSV = useSharedValue(0);
  const tilt = useSharedValue(0);
  const tilted = useSharedValue(0);
  const tempoSV = useSharedValue(tempo);
  const phase = useSharedValue(0);
  const focus = RINGS.map((_, i) => useSharedValue(i === 0 ? 1 : 0));
  useEffect(() => {
    tempoSV.value = tempo;
  }, [tempo, tempoSV]);
  useEffect(() => {
    currentSV.value = current;
  }, [current, currentSV]);

  useEffect(() => {
    navigation.setOptions({ gestureEnabled: false });
    return () => navigation.setOptions({ gestureEnabled: true });
  }, [navigation]);

  useEffect(() => {
    for (let i = 0; i < N; i++) focus[i].value = withTiming(i === current ? 1 : 0, { duration: 220 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  const frame = useFrameCallback(() => {
    'worklet';
    const now = clock.value;
    const beatMs = 60000 / tempoSV.value;
    const loopMs = LOOP_BARS * BEATS_PER_BAR * beatMs;
    phase.value = (now % loopMs) / loopMs;
  }, false);

  useEffect(() => {
    frame.setActive(live);
    return () => frame.setActive(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, frame]);

  // For each step, how many layers have it active and this layer's slot among
  // them — so co-located dots can fan out next to each other instead of stacking.
  const fan = useMemo(() => {
    const perStep: number[][] = Array.from({ length: M }, () => []);
    for (let i = 0; i < N; i++) for (let s = 0; s < M; s++) if (active[i][s]) perStep[s].push(i);
    const map: Fan[][] = RINGS.map(() => new Array<Fan>(M).fill(null));
    for (let s = 0; s < M; s++) perStep[s].forEach((li, idx) => (map[li][s] = { idx, total: perStep[s].length }));
    return map;
  }, [active]);

  const cycle = (dir: number) => setCurrent((c) => (c + dir + N) % N);
  const toggle = (ring: number, step: number) =>
    setActive((prev) => {
      const next = prev.map((row) => row.slice());
      next[ring][step] = !next[ring][step];
      return next;
    });
  const goTilt = (v: number) => {
    'worklet';
    tilted.value = v;
    tilt.value = withTiming(v, { duration: 550 });
  };

  // Vertical swipe drives the camera; horizontal swipe changes the layer.
  const pan = Gesture.Pan().onEnd((e) => {
    const ax = Math.abs(e.translationX);
    const ay = Math.abs(e.translationY);
    if (ax > ay && ax > 40) {
      runOnJS(cycle)(e.translationX < 0 ? 1 : -1);
    } else if (ay > ax && ay > 40) {
      goTilt(e.translationY > 0 ? 1 : 0); // down → isometric, up → top-down
    }
  });

  // Tap activates a point (top-down) or lands on a ring (isometric).
  const tap = Gesture.Tap()
    .maxDistance(16)
    .onEnd((e) => {
      if (tilted.value === 0) {
        const dx = e.x - cx;
        const dy = e.y - cy;
        const r = Math.sqrt(dx * dx + dy * dy);
        if (r < R - 42 || r > R + 42) return;
        const a = Math.atan2(dy, dx);
        let s = Math.round(((a + Math.PI / 2) / (2 * Math.PI)) * M);
        s = ((s % M) + M) % M;
        runOnJS(toggle)(currentSV.value, s);
      } else {
        let best = 0;
        let bestD = 1e9;
        for (let i = 0; i < N; i++) {
          const yi = cy + (i - (N - 1) / 2) * GAP;
          const d = Math.abs(e.y - yi);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
        runOnJS(setCurrent)(best);
        goTilt(0);
      }
    });

  return (
    <GestureDetector gesture={Gesture.Race(tap, pan)}>
      <View style={styles.fill}>
        {RINGS.map((r, i) => (
          <RingLayer
            key={i}
            cx={cx}
            cy={cy}
            R={R}
            color={r.color}
            active={active[i]}
            fan={fan[i]}
            phase={phase}
            tilt={tilt}
            focus={focus[i]}
            isCurrent={i === current}
            offset={(i - (N - 1) / 2) * GAP}
            zIndex={i === current ? 100 : i}
          />
        ))}
        <View style={styles.pager} pointerEvents="none">
          {RINGS.map((r, i) => (
            <View
              key={i}
              style={{ width: i === current ? 9 : 6, height: i === current ? 9 : 6, borderRadius: 5, marginHorizontal: 4, backgroundColor: i === current ? r.color : 'rgba(255,255,255,0.25)' }}
            />
          ))}
        </View>
      </View>
    </GestureDetector>
  );
}

function RingLayer({
  cx,
  cy,
  R,
  color,
  active,
  fan,
  phase,
  tilt,
  focus,
  isCurrent,
  offset,
  zIndex,
}: {
  cx: number;
  cy: number;
  R: number;
  color: string;
  active: boolean[];
  fan: Fan[];
  phase: SharedValue<number>;
  tilt: SharedValue<number>;
  focus: SharedValue<number>;
  isCurrent: boolean;
  offset: number;
  zIndex: number;
}) {
  const slots = useMemo(() => Array.from({ length: M }, (_, s) => stepPos(s, R)), [R]);

  const boxStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: tilt.value * offset }, { scaleY: 1 - tilt.value * (1 - FLATTEN) }],
  }));
  // Outline + hand: the current ring in top-down, every ring when tilted.
  const frameStyle = useAnimatedStyle(() => ({ opacity: Math.max(focus.value, tilt.value * 0.7) }));
  // Faint tappable slots: only the current ring, only top-down.
  const slotStyle = useAnimatedStyle(() => ({ opacity: focus.value * (1 - tilt.value) }));
  const handStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${phase.value * 360}deg` }] }));

  return (
    <Animated.View style={[{ position: 'absolute', left: cx - R, top: cy - R, width: 2 * R, height: 2 * R, zIndex }, boxStyle]} pointerEvents="none">
      <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: 2 * R, height: 2 * R }, frameStyle]}>
        <View style={{ position: 'absolute', left: 0, top: 0, width: 2 * R, height: 2 * R, borderRadius: R, borderWidth: 1.5, borderColor: color }} />
        <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: 2 * R, height: 2 * R }, handStyle]}>
          <View style={{ position: 'absolute', left: R - 1.5, top: 0, width: 3, height: R, borderRadius: 1.5, backgroundColor: '#fff' }} />
        </Animated.View>
      </Animated.View>

      <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: 2 * R, height: 2 * R }, slotStyle]}>
        {slots.map((p, s) => {
          const sz = SLOT_SIZE[metricLevel(s)];
          return <View key={s} style={{ position: 'absolute', left: p.x - sz / 2, top: p.y - sz / 2, width: sz, height: sz, borderRadius: sz / 2, borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' }} />;
        })}
      </Animated.View>

      {/* activated points — always shown, so all layers composite in top-down.
          Co-located dots straddle the beat point along the radius (one to each
          side of the circumference), with a connector through the landing spot. */}
      {slots.map((p, s) => {
        if (!active[s]) return null;
        const info = fan[s];
        const total = info ? info.total : 1;
        const idx = info ? info.idx : 0;
        let dx = p.x;
        let dy = p.y;
        let extras = null;
        if (total > 1) {
          const a = (s / M) * 2 * Math.PI - Math.PI / 2;
          const kc = idx - (total - 1) / 2; // centered rank
          dx = p.x + kc * SPREAD * Math.cos(a); // radial: either side of the point
          dy = p.y + kc * SPREAD * Math.sin(a);
          if (idx === 0) {
            const L = (total - 1) * SPREAD;
            const angDeg = (a * 180) / Math.PI;
            extras = (
              <>
                <View
                  pointerEvents="none"
                  style={{ position: 'absolute', left: p.x - L / 2, top: p.y - 0.75, width: L, height: 1.5, backgroundColor: 'rgba(255,255,255,0.5)', transform: [{ rotate: `${angDeg}deg` }] }}
                />
                <View pointerEvents="none" style={{ position: 'absolute', left: p.x - 3, top: p.y - 3, width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' }} />
              </>
            );
          }
        }
        const sz = ACT_SIZE[metricLevel(s)];
        return (
          <View key={s} pointerEvents="none">
            {extras}
            <View
              style={{ position: 'absolute', left: dx - sz / 2, top: dy - sz / 2, width: sz, height: sz, borderRadius: sz / 2, backgroundColor: color, borderWidth: isCurrent ? 2 : 0, borderColor: '#fff' }}
            />
          </View>
        );
      })}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  pager: { position: 'absolute', bottom: 60, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
});
