import { useClock } from '@shopify/react-native-skia';
import { useNavigation } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useFrameCallback, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { NoteSynth } from '../../modules/note-synth';
import { useExperimentActive } from '../_host';
import { useSharedClock } from '../combinations/clock';
import { scaleFrequencies, useScale } from '../scale';
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
const RR = 26; // ripple base radius
const PULSE = 0.1; // pop/ripple duration as a fraction of the loop
const POP = 0.6; // extra scale at the moment the hand touches a dot
const EVERY_VALUES = [2, 4, 6, 8]; // the skip options in the editor
const BTN = 54; // editor button diameter
const BTN_GAP = 14;

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
  const [every, setEvery] = useState<number[][]>(() => RINGS.map(() => new Array(M).fill(1))); // play once per N rotations
  const [editing, setEditing] = useState<{ ring: number; step: number } | null>(null);
  const currentSV = useSharedValue(0);
  const editingSV = useSharedValue(0);
  const rotation = useSharedValue(0);
  const prevPhase = useSharedValue(0);
  const tilt = useSharedValue(0);
  const tilted = useSharedValue(0);
  const tempoSV = useSharedValue(tempo);
  const phase = useSharedValue(0);
  const lastHit = useSharedValue(-1);
  const hitStarted = useSharedValue(0);
  const focus = RINGS.map((_, i) => useSharedValue(i === 0 ? 1 : 0));
  useEffect(() => {
    tempoSV.value = tempo;
  }, [tempo, tempoSV]);

  // One scale pitch per ring (inner low → outer high) for the note each hit sounds.
  const scale = useScale();
  const freqs = useMemo(() => {
    const pool = scaleFrequencies(scale, 48, 76);
    return RINGS.map((_, i) => pool[Math.round((i / (N - 1)) * (pool.length - 1))]);
  }, [scale]);
  const activeRef = useRef(active);
  activeRef.current = active;
  const everyRef = useRef(every);
  everyRef.current = every;
  const freqsRef = useRef(freqs);
  freqsRef.current = freqs;
  const fireStep = (s: number) => {
    const a = activeRef.current;
    const ev = everyRef.current;
    const f = freqsRef.current;
    const rot = rotation.value;
    for (let i = 0; i < N; i++) {
      if (!a[i][s]) continue;
      const e = ev[i][s] || 1;
      if (rot % e === 0) NoteSynth?.pluck(f[i], 0.16, 0.5).catch(() => {}); // once per e rotations
    }
  };
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
    const p = (now % loopMs) / loopMs;
    if (hitStarted.value === 1 && p < prevPhase.value - 0.5) rotation.value += 1; // a full spin elapsed
    prevPhase.value = p;
    phase.value = p;
    // The hand reaches dot s when floor(phase*M) becomes s → fire that step.
    const step = Math.floor(p * M) % M;
    if (hitStarted.value === 0) {
      lastHit.value = step;
      hitStarted.value = 1;
    } else if (step !== lastHit.value) {
      lastHit.value = step;
      runOnJS(fireStep)(step);
    }
  }, false);

  useEffect(() => {
    hitStarted.value = 0; // re-baseline so it doesn't fire on (re)entry
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

  useEffect(() => {
    editingSV.value = editing ? 1 : 0;
  }, [editing, editingSV]);

  const cycle = (dir: number) => setCurrent((c) => (c + dir + N) % N);
  const toggle = (ring: number, step: number) => {
    setActive((prev) => {
      const next = prev.map((row) => row.slice());
      next[ring][step] = !next[ring][step];
      return next;
    });
    setEvery((prev) => {
      const next = prev.map((row) => row.slice());
      if (activeRef.current[ring][step]) next[ring][step] = 1; // was on → turning off, reset
      return next;
    });
  };
  const setEveryAt = (ring: number, step: number, n: number) =>
    setEvery((prev) => prev.map((row, i) => (i === ring ? row.map((v, s) => (s === step ? n : v)) : row)));
  const openEdit = (ring: number, step: number) => {
    if (!activeRef.current[ring][step]) return;
    setEditing({ ring, step });
  };
  const closeEdit = () => setEditing(null);
  const applyEvery = (n: number) => {
    if (editing) setEveryAt(editing.ring, editing.step, n);
    setEditing(null);
  };
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

  // Long-press an active dot (top-down) to edit how many rotations it skips.
  const longPress = Gesture.LongPress()
    .minDuration(380)
    .maxDistance(16)
    .onStart((e) => {
      if (tilted.value !== 0) return;
      const dx = e.x - cx;
      const dy = e.y - cy;
      const r = Math.sqrt(dx * dx + dy * dy);
      if (r < R - 42 || r > R + 42) return;
      const a = Math.atan2(dy, dx);
      let s = Math.round(((a + Math.PI / 2) / (2 * Math.PI)) * M);
      s = ((s % M) + M) % M;
      runOnJS(openEdit)(currentSV.value, s);
    });

  // Tap activates a point (top-down) or lands on a ring (isometric).
  const tap = Gesture.Tap()
    .maxDistance(16)
    .onEnd((e) => {
      if (editingSV.value === 1) {
        // hit-test the 2/4/6/8 buttons; a tap elsewhere dismisses
        const rowW = EVERY_VALUES.length * BTN + (EVERY_VALUES.length - 1) * BTN_GAP;
        const startX = cx - rowW / 2;
        const by = cy - BTN / 2;
        let picked = 0;
        for (let i = 0; i < EVERY_VALUES.length; i++) {
          const bx = startX + i * (BTN + BTN_GAP);
          if (e.x >= bx && e.x <= bx + BTN && e.y >= by && e.y <= by + BTN) {
            picked = EVERY_VALUES[i];
            break;
          }
        }
        if (picked > 0) runOnJS(applyEvery)(picked);
        else runOnJS(closeEdit)();
        return;
      }
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
    <GestureDetector gesture={Gesture.Race(longPress, tap, pan)}>
      <View style={styles.fill}>
        {RINGS.map((r, i) => (
          <RingLayer
            key={i}
            cx={cx}
            cy={cy}
            R={R}
            color={r.color}
            active={active[i]}
            every={every[i]}
            fan={fan[i]}
            phase={phase}
            rotation={rotation}
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

        {/* center overlay: pick how many rotations this dot skips. Purely visual —
            the tap gesture hit-tests the buttons, so no gesture conflict. */}
        {editing && (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.4)' }]} />
            {EVERY_VALUES.map((v, i) => {
              const rowW = EVERY_VALUES.length * BTN + (EVERY_VALUES.length - 1) * BTN_GAP;
              const bx = cx - rowW / 2 + i * (BTN + BTN_GAP);
              const isCur = editing && every[editing.ring][editing.step] === v;
              return (
                <View
                  key={v}
                  style={{ position: 'absolute', left: bx, top: cy - BTN / 2, width: BTN, height: BTN, borderRadius: BTN / 2, borderWidth: 2, borderColor: isCur ? '#fff' : 'rgba(255,255,255,0.4)', backgroundColor: isCur ? 'rgba(255,255,255,0.16)' : 'transparent', alignItems: 'center', justifyContent: 'center' }}
                >
                  <Text style={{ color: '#fff', fontSize: 22, fontWeight: '600' }}>{v}</Text>
                </View>
              );
            })}
          </View>
        )}
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
  every,
  fan,
  phase,
  rotation,
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
  every: number[];
  fan: Fan[];
  phase: SharedValue<number>;
  rotation: SharedValue<number>;
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
            <ActiveDot phase={phase} rotation={rotation} step={s} every={every[s] || 1} x={dx} y={dy} size={sz} color={color} isCurrent={isCurrent} />
          </View>
        );
      })}
    </Animated.View>
  );
}

// A placed hit: pops and radiates a ripple each time the clock hand touches it —
// keyed off the loop phase, so it re-fires every pass without any per-dot state.
function ActiveDot({
  phase,
  rotation,
  step,
  every,
  x,
  y,
  size,
  color,
  isCurrent,
}: {
  phase: SharedValue<number>;
  rotation: SharedValue<number>;
  step: number;
  every: number;
  x: number;
  y: number;
  size: number;
  color: string;
  isCurrent: boolean;
}) {
  // Only pop/ripple on a rotation this dot actually plays (rotation % every === 0).
  const dotStyle = useAnimatedStyle(() => {
    const plays = every <= 1 || rotation.value % every === 0;
    let g = phase.value - step / M;
    g = g - Math.floor(g); // time since this dot was last touched (0..1 of a loop)
    const w = plays && g < PULSE ? 1 - g / PULSE : 0;
    return { transform: [{ scale: 1 + POP * w }] };
  });
  const rippleStyle = useAnimatedStyle(() => {
    const plays = every <= 1 || rotation.value % every === 0;
    let g = phase.value - step / M;
    g = g - Math.floor(g);
    if (!plays || g >= PULSE) return { opacity: 0, transform: [{ scale: 0.3 }] };
    const t = g / PULSE;
    return { opacity: (1 - t) * 0.5, transform: [{ scale: 0.3 + t * 1.4 }] };
  });
  return (
    <>
      <Animated.View
        pointerEvents="none"
        style={[{ position: 'absolute', left: x - RR, top: y - RR, width: 2 * RR, height: 2 * RR, borderRadius: RR, borderWidth: 2, borderColor: color }, rippleStyle]}
      />
      <Animated.View
        pointerEvents="none"
        style={[{ position: 'absolute', left: x - size / 2, top: y - size / 2, width: size, height: size, borderRadius: size / 2, backgroundColor: color, borderWidth: isCurrent ? 2 : 0, borderColor: '#fff' }, dotStyle]}
      />
      {every > 1 && (
        <View pointerEvents="none" style={{ position: 'absolute', left: x + size / 2 - 2, top: y - size / 2 - 10, minWidth: 14, paddingHorizontal: 3, height: 14, borderRadius: 7, backgroundColor: '#000', borderWidth: 1, borderColor: color, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color, fontSize: 9, fontWeight: '800' }}>{every}</Text>
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  pager: { position: 'absolute', bottom: 60, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
});
