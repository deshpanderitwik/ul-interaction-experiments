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

// Time · Overlapping Rings III — Overlapping Rings II reworked around a live
// resolution. Tap a slot to activate a point; every layer's points composite, in
// colour, over the top-down view. Drag up/down to change the ring's subdivisions
// (4 → 32), double-tap to tilt into the isometric stack, swipe left/right to
// change the layer, tap a ring in the stack to land on it. Back-swipe nav is
// disabled so gestures stay ours.

const BEATS_PER_BAR = 4;
const LOOP_BARS = 2;
const MAX_M = 32; // pattern is stored at this resolution; subdivisions are a subset
const SUBDIVS = [4, 8, 16, 32]; // drag up/down cycles these
const FLATTEN = 0.3;
const GAP = 78; // vertical separation between layers when tilted

const RINGS = [
  { color: '#7ad0ff' },
  { color: '#a0b4ff' },
  { color: '#c9a0ff' },
  { color: '#ff9db0' },
  { color: '#ffd166' },
];
const N = RINGS.length;
const SPREAD = 28; // radial px between co-located dots straddling the beat point

// Metric weight of a slot (0 weakest … strongest) = how many times 2 divides it;
// the downbeat (0) is strongest. Computed on the 32-grid so a beat stays "big"
// at any display resolution.
const LEVELS = 6;
function metricLevel(s: number) {
  if (s === 0) return LEVELS - 1;
  let lvl = 0;
  let v = s;
  while (v % 2 === 0) {
    v /= 2;
    lvl++;
  }
  return Math.min(lvl, LEVELS - 1);
}
const ACT_SIZE = [10, 12, 14, 17, 20, 24]; // activated dot diameter by level
const SLOT_SIZE = [6, 8, 10, 12, 15, 19]; // empty slot diameter by level
const RR = 26; // ripple base radius
const PULSE = 0.1; // pop/ripple duration as a fraction of the loop
const POP = 0.6; // extra scale at the moment the hand touches a dot
const EVERY_VALUES = [2, 4, 6, 8]; // the skip options in the editor
const ROT_CYCLE = 16; // the global rotation counter runs 0..15 then resets
const BTN = 54;
const BTN_GAP = 14;
const DRAG_PER_STEP = 70; // px of vertical drag per subdivision step
const MAXZOOM = 4; // pinch-zoom ceiling

type Fan = { idx: number; total: number } | null;

export default function OverlappingRings3() {
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
  const scx = width / 2; // zoom wrapper (full screen) center
  const scy = height / 2;

  const [current, setCurrent] = useState(0);
  const [subdivIdx, setSubdivIdx] = useState(SUBDIVS.length - 1); // start at 32
  const subdiv = SUBDIVS[subdivIdx];
  const [active, setActive] = useState<boolean[][]>(() => RINGS.map(() => new Array(MAX_M).fill(false)));
  const [every, setEvery] = useState<number[][]>(() => RINGS.map(() => new Array(MAX_M).fill(1)));
  const [editing, setEditing] = useState<{ ring: number; step: number } | null>(null);
  const [rotCount, setRotCount] = useState(0);
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
  const subdivIdxSV = useSharedValue(SUBDIVS.length - 1);
  const dragStartIdx = useSharedValue(SUBDIVS.length - 1);
  // pinch-zoom transform (applied to the ring wrapper) + gesture bookkeeping
  const zoomScale = useSharedValue(1);
  const zoomTX = useSharedValue(0);
  const zoomTY = useSharedValue(0);
  const pStartScale = useSharedValue(1);
  const pStartTX = useSharedValue(0);
  const pStartTY = useSharedValue(0);
  const pOriginX = useSharedValue(0);
  const pOriginY = useSharedValue(0);
  const bandStart = useSharedValue(0); // 1 if a horizontal drag began on the dot band
  const panStartTX = useSharedValue(0); // camera translateX at the start of an interior drag
  const focus = RINGS.map((_, i) => useSharedValue(i === 0 ? 1 : 0));
  useEffect(() => {
    tempoSV.value = tempo;
  }, [tempo, tempoSV]);
  useEffect(() => {
    subdivIdxSV.value = subdivIdx;
    hitStarted.value = 0; // re-baseline the step detector on a resolution change
  }, [subdivIdx, subdivIdxSV, hitStarted]);

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
  const subdivRef = useRef(subdiv);
  subdivRef.current = subdiv;
  const fireStep = (j: number) => {
    const a = activeRef.current;
    const ev = everyRef.current;
    const f = freqsRef.current;
    const pos = rotation.value % ROT_CYCLE;
    const p = j * (MAX_M / subdivRef.current); // display index → data slot
    for (let i = 0; i < N; i++) {
      if (!a[i][p]) continue;
      const e = ev[i][p] || 1;
      if (pos % e === 0) NoteSynth?.pluck(f[i], 0.16, 0.5).catch(() => {});
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
    const ph = (now % loopMs) / loopMs;
    if (hitStarted.value === 1 && ph < prevPhase.value - 0.5) {
      rotation.value += 1;
      runOnJS(setRotCount)(rotation.value);
    }
    prevPhase.value = ph;
    phase.value = ph;
    const subdivW = 4 << subdivIdxSV.value; // 4,8,16,32
    const step = Math.floor(ph * subdivW) % subdivW;
    if (hitStarted.value === 0) {
      lastHit.value = step;
      hitStarted.value = 1;
    } else if (step !== lastHit.value) {
      lastHit.value = step;
      runOnJS(fireStep)(step);
    }
  }, false);

  useEffect(() => {
    hitStarted.value = 0;
    frame.setActive(live);
    return () => frame.setActive(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, frame]);

  const fan = useMemo(() => {
    const perStep: number[][] = Array.from({ length: MAX_M }, () => []);
    for (let i = 0; i < N; i++) for (let s = 0; s < MAX_M; s++) if (active[i][s]) perStep[s].push(i);
    const map: Fan[][] = RINGS.map(() => new Array<Fan>(MAX_M).fill(null));
    for (let s = 0; s < MAX_M; s++) perStep[s].forEach((li, idx) => (map[li][s] = { idx, total: perStep[s].length }));
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
      if (activeRef.current[ring][step]) next[ring][step] = 1;
      return next;
    });
  };
  const setEveryAt = (ring: number, step: number, n: number) =>
    setEvery((prev) => prev.map((row, i) => (i === ring ? row.map((v, s) => (s === step ? n : v)) : row)));
  const openEdit = (ring: number, step: number) => setEditing({ ring, step });
  const closeEdit = () => setEditing(null);
  const applyEvery = (n: number) => {
    if (editing) {
      const { ring, step } = editing;
      setEveryAt(ring, step, n);
      setActive((prev) => {
        if (prev[ring][step]) return prev;
        const next = prev.map((row) => row.slice());
        next[ring][step] = true;
        return next;
      });
    }
    setEditing(null);
  };
  const goTilt = (v: number) => {
    'worklet';
    tilted.value = v;
    tilt.value = withTiming(v, { duration: 550 });
  };

  // Pinch to zoom into a part of the circle (focal-point aware) so finer
  // subdivisions are easier to edit; pinch back out to 1x to reset.
  const pinch = Gesture.Pinch()
    .onStart((e) => {
      pOriginX.value = e.focalX;
      pOriginY.value = e.focalY;
      pStartScale.value = zoomScale.value;
      pStartTX.value = zoomTX.value;
      pStartTY.value = zoomTY.value;
    })
    .onUpdate((e) => {
      let s = pStartScale.value * e.scale;
      if (s < 1) s = 1;
      else if (s > MAXZOOM) s = MAXZOOM;
      zoomScale.value = s;
      if (s <= 1.0001) {
        zoomTX.value = 0;
        zoomTY.value = 0;
      } else {
        const k = s / pStartScale.value;
        zoomTX.value = e.focalX - scx - k * (pOriginX.value - scx - pStartTX.value);
        zoomTY.value = e.focalY - scy - k * (pOriginY.value - scy - pStartTY.value);
      }
    });

  // Drag up/down = change subdivisions (4 → 32). Vertical-only.
  const vDrag = Gesture.Pan()
    .activeOffsetY([-14, 14])
    .failOffsetX([-28, 28])
    .onBegin(() => {
      dragStartIdx.value = subdivIdxSV.value;
    })
    .onUpdate((e) => {
      let idx = dragStartIdx.value + Math.round(-e.translationY / DRAG_PER_STEP);
      if (idx < 0) idx = 0;
      else if (idx > SUBDIVS.length - 1) idx = SUBDIVS.length - 1;
      if (idx !== subdivIdxSV.value) {
        subdivIdxSV.value = idx;
        runOnJS(setSubdivIdx)(idx);
      }
    });

  // Horizontal drag. Over the dot band (or in the isometric stack) it swipes to
  // change the layer; over the circle's empty interior it pans the zoomed camera
  // instead, so you can move around a close-up without flipping rings.
  const hPan = Gesture.Pan()
    .activeOffsetX([-14, 14])
    .failOffsetY([-28, 28])
    .onBegin((e) => {
      const Lx = scx + (e.x - scx - zoomTX.value) / zoomScale.value;
      const Ly = scy + (e.y - scy - zoomTY.value) / zoomScale.value;
      const dx = Lx - cx;
      const dy = Ly - cy;
      const r = Math.sqrt(dx * dx + dy * dy);
      bandStart.value = tilted.value !== 0 || (r > R - 42 && r < R + 42) ? 1 : 0;
      panStartTX.value = zoomTX.value;
    })
    .onUpdate((e) => {
      if (bandStart.value === 1) return; // dot band → ring change (handled onEnd)
      if (zoomScale.value <= 1.0001) return; // nothing to pan at 1x
      const maxTX = (zoomScale.value - 1) * scx;
      let tx = panStartTX.value + e.translationX;
      if (tx > maxTX) tx = maxTX;
      else if (tx < -maxTX) tx = -maxTX;
      zoomTX.value = tx;
    })
    .onEnd((e) => {
      if (bandStart.value === 1 && Math.abs(e.translationX) > 40) runOnJS(cycle)(e.translationX < 0 ? 1 : -1);
    });

  // Double-tap = toggle the isometric camera.
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDistance(28)
    .onEnd(() => {
      'worklet';
      goTilt(tilted.value === 0 ? 1 : 0);
    });

  const longPress = Gesture.LongPress()
    .minDuration(380)
    .maxDistance(16)
    .onStart((e) => {
      if (tilted.value !== 0) return;
      const dx = scx + (e.x - scx - zoomTX.value) / zoomScale.value - cx;
      const dy = scy + (e.y - scy - zoomTY.value) / zoomScale.value - cy;
      const r = Math.sqrt(dx * dx + dy * dy);
      if (r < R - 42 || r > R + 42) return;
      const subdivW = 4 << subdivIdxSV.value;
      const a = Math.atan2(dy, dx);
      let j = Math.round(((a + Math.PI / 2) / (2 * Math.PI)) * subdivW);
      j = ((j % subdivW) + subdivW) % subdivW;
      runOnJS(openEdit)(currentSV.value, j * (MAX_M / subdivW));
    });

  const tap = Gesture.Tap()
    .numberOfTaps(1)
    .maxDistance(16)
    .onEnd((e) => {
      if (editingSV.value === 1) {
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
      // undo the zoom transform so hit-testing is in ring space
      const Lx = scx + (e.x - scx - zoomTX.value) / zoomScale.value;
      const Ly = scy + (e.y - scy - zoomTY.value) / zoomScale.value;
      if (tilted.value === 0) {
        const dx = Lx - cx;
        const dy = Ly - cy;
        const r = Math.sqrt(dx * dx + dy * dy);
        if (r < R - 42 || r > R + 42) return;
        const subdivW = 4 << subdivIdxSV.value;
        const a = Math.atan2(dy, dx);
        let j = Math.round(((a + Math.PI / 2) / (2 * Math.PI)) * subdivW);
        j = ((j % subdivW) + subdivW) % subdivW;
        runOnJS(toggle)(currentSV.value, j * (MAX_M / subdivW));
      } else {
        let best = 0;
        let bestD = 1e9;
        for (let i = 0; i < N; i++) {
          const yi = cy + (i - (N - 1) / 2) * GAP;
          const d = Math.abs(Ly - yi);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
        runOnJS(setCurrent)(best);
        goTilt(0);
      }
    });

  const zoomStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: zoomTX.value }, { translateY: zoomTY.value }, { scale: zoomScale.value }],
  }));

  return (
    <GestureDetector gesture={Gesture.Race(pinch, vDrag, hPan, longPress, Gesture.Exclusive(doubleTap, tap))}>
      <View style={styles.fill}>
        <Text style={styles.subdivLabel} pointerEvents="none">
          {subdiv} subdivisions
        </Text>
        {/* rings live in the zoom wrapper; UI (counter, pager, editor) stays fixed */}
        <Animated.View style={[StyleSheet.absoluteFill, zoomStyle]} pointerEvents="none">
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
              subdiv={subdiv}
              phase={phase}
              rotation={rotation}
              tilt={tilt}
              focus={focus[i]}
              isCurrent={i === current}
              offset={(i - (N - 1) / 2) * GAP}
              zIndex={i === current ? 100 : i}
            />
          ))}
        </Animated.View>
        <View style={styles.repTimer} pointerEvents="none">
          <Text style={styles.repText}>{rotCount % ROT_CYCLE}</Text>
        </View>

        <View style={styles.pager} pointerEvents="none">
          {RINGS.map((r, i) => (
            <View
              key={i}
              style={{ width: i === current ? 9 : 6, height: i === current ? 9 : 6, borderRadius: 5, marginHorizontal: 4, backgroundColor: i === current ? r.color : 'rgba(255,255,255,0.25)' }}
            />
          ))}
        </View>

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
  subdiv,
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
  subdiv: number;
  phase: SharedValue<number>;
  rotation: SharedValue<number>;
  tilt: SharedValue<number>;
  focus: SharedValue<number>;
  isCurrent: boolean;
  offset: number;
  zIndex: number;
}) {
  // Display positions on the current grid; each maps to a data slot p on the
  // fixed 32-slot pattern.
  const slots = useMemo(() => {
    const stride = MAX_M / subdiv;
    return Array.from({ length: subdiv }, (_, j) => {
      const p = j * stride;
      const a = (j / subdiv) * 2 * Math.PI - Math.PI / 2;
      return { p, frac: j / subdiv, x: R + R * Math.cos(a), y: R + R * Math.sin(a) };
    });
  }, [R, subdiv]);

  const boxStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: tilt.value * offset }, { scaleY: 1 - tilt.value * (1 - FLATTEN) }],
  }));
  const frameStyle = useAnimatedStyle(() => ({ opacity: Math.max(focus.value, tilt.value * 0.7) }));
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
        {slots.map((slot) => {
          const sz = SLOT_SIZE[metricLevel(slot.p)];
          return <View key={slot.p} style={{ position: 'absolute', left: slot.x - sz / 2, top: slot.y - sz / 2, width: sz, height: sz, borderRadius: sz / 2, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.7)', backgroundColor: 'rgba(255,255,255,0.1)' }} />;
        })}
      </Animated.View>

      {slots.map((slot) => {
        const p = slot.p;
        if (!active[p]) return null;
        const info = fan[p];
        const total = info ? info.total : 1;
        const idx = info ? info.idx : 0;
        let dx = slot.x;
        let dy = slot.y;
        let extras = null;
        if (total > 1) {
          const a = slot.frac * 2 * Math.PI - Math.PI / 2;
          const kc = idx - (total - 1) / 2;
          dx = slot.x + kc * SPREAD * Math.cos(a);
          dy = slot.y + kc * SPREAD * Math.sin(a);
          if (idx === 0) {
            const L = (total - 1) * SPREAD;
            const angDeg = (a * 180) / Math.PI;
            extras = (
              <>
                <View pointerEvents="none" style={{ position: 'absolute', left: slot.x - L / 2, top: slot.y - 0.75, width: L, height: 1.5, backgroundColor: 'rgba(255,255,255,0.5)', transform: [{ rotate: `${angDeg}deg` }] }} />
                <View pointerEvents="none" style={{ position: 'absolute', left: slot.x - 3, top: slot.y - 3, width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' }} />
              </>
            );
          }
        }
        const sz = ACT_SIZE[metricLevel(p)];
        return (
          <View key={p} pointerEvents="none">
            {extras}
            <ActiveDot phase={phase} rotation={rotation} frac={slot.frac} every={every[p] || 1} x={dx} y={dy} size={sz} color={color} isCurrent={isCurrent} />
          </View>
        );
      })}
    </Animated.View>
  );
}

function ActiveDot({
  phase,
  rotation,
  frac,
  every,
  x,
  y,
  size,
  color,
  isCurrent,
}: {
  phase: SharedValue<number>;
  rotation: SharedValue<number>;
  frac: number;
  every: number;
  x: number;
  y: number;
  size: number;
  color: string;
  isCurrent: boolean;
}) {
  const dotStyle = useAnimatedStyle(() => {
    const plays = every <= 1 || (rotation.value % ROT_CYCLE) % every === 0;
    let g = phase.value - frac;
    g = g - Math.floor(g);
    const w = plays && g < PULSE ? 1 - g / PULSE : 0;
    return { transform: [{ scale: 1 + POP * w }] };
  });
  const rippleStyle = useAnimatedStyle(() => {
    const plays = every <= 1 || (rotation.value % ROT_CYCLE) % every === 0;
    let g = phase.value - frac;
    g = g - Math.floor(g);
    if (!plays || g >= PULSE) return { opacity: 0, transform: [{ scale: 0.3 }] };
    const t = g / PULSE;
    return { opacity: (1 - t) * 0.5, transform: [{ scale: 0.3 + t * 1.4 }] };
  });
  return (
    <>
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: x - RR, top: y - RR, width: 2 * RR, height: 2 * RR, borderRadius: RR, borderWidth: 2, borderColor: color }, rippleStyle]} />
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: x - size / 2, top: y - size / 2, width: size, height: size, borderRadius: size / 2, backgroundColor: color, borderWidth: isCurrent ? 2 : 0, borderColor: '#fff' }, dotStyle]} />
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
  repTimer: { position: 'absolute', bottom: 88, left: 0, right: 0, alignItems: 'center' },
  repText: { color: '#fff', fontSize: 30, fontWeight: '300', fontVariant: ['tabular-nums'] },
  subdivLabel: { position: 'absolute', top: 56, left: 0, right: 0, textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
});
