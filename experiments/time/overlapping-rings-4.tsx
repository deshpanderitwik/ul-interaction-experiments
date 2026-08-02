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
import { setTempo, useTempo } from '../tempo';

// Time · Overlapping Rings IV — Overlapping Rings III with the pinch-zoom taken
// out and the isometric camera back on a swipe instead of a double-tap. Fixed at
// 32 subdivisions. Tap a slot to activate a point; every layer's points
// composite, in colour, over the top-down view. Swipe up/down to tilt into the
// isometric stack (down) and back to top-down (up); tap a coloured circle at the
// bottom to switch layers; long-press a slot to set its rotation skip. Back-swipe
// nav is disabled so gestures stay ours.

const BEATS_PER_BAR = 4;
const LOOP_BARS = 2;
const MAX_M = 32; // fixed resolution — the pattern lives on a 32-slot grid
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
const ACT_SIZE = [13, 16, 19, 22, 26, 30]; // activated dot diameter by level
const SLOT_SIZE = [9, 11, 13, 16, 19, 23]; // empty slot diameter by level
const RR = 26; // ripple base radius
const PULSE = 0.1; // pop/ripple duration as a fraction of the loop
const POP = 0.6; // extra scale at the moment the hand touches a dot
const EVERY_VALUES = [2, 4, 6, 8]; // the skip options in the editor
const ROT_CYCLE = 16; // the global rotation counter runs 0..15 then resets
const BTN = 54;
const BTN_GAP = 14;
const SWIPE_TILT = 40; // px of vertical swipe to flip the camera
const PICK_SIZE = 30; // diameter of a ring-picker circle at the bottom
const PICK_GAP = 16; // gap between ring-picker circles
const CENTER_R = 42; // radius of the centre tap-tempo target
const TAP_RESET_MS = 2000; // gap after which a new tap-tempo take starts fresh

type Fan = { idx: number; total: number } | null;

export default function OverlappingRings4() {
  const live = useExperimentActive();
  const tempo = useTempo();
  const localClock = useClock();
  const sharedClock = useSharedClock();
  const clock = sharedClock ?? localClock;
  const { width, height } = useWindowDimensions();
  const navigation = useNavigation();

  const cx = width / 2;
  const cy = height * 0.44;
  const R = Math.min(width * 0.42, height * 0.24);
  // bottom ring-picker row geometry (also used for tap hit-testing)
  const pickRowW = N * PICK_SIZE + (N - 1) * PICK_GAP;
  const pickStartX = cx - pickRowW / 2;
  const pickTop = height - 84;

  const [current, setCurrent] = useState(0);
  const subdiv = MAX_M; // fixed at 32
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
  const alignOffset = useSharedValue(0); // clock-time the tapped downbeat lands on
  const tapPulse = useSharedValue(0); // centre-target flash on each tap
  const focus = RINGS.map((_, i) => useSharedValue(i === 0 ? 1 : 0));
  useEffect(() => {
    tempoSV.value = tempo;
  }, [tempo, tempoSV]);

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
    // align to the tapped downbeat: phase 0 sits at alignOffset.
    const ph = ((((now - alignOffset.value) % loopMs) + loopMs) % loopMs) / loopMs;
    if (hitStarted.value === 1 && ph < prevPhase.value - 0.5) {
      rotation.value += 1;
      runOnJS(setRotCount)(rotation.value);
    }
    prevPhase.value = ph;
    phase.value = ph;
    const subdivW = MAX_M; // fixed 32
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

  // Tap tempo: each centre tap is a beat. Average the recent intervals into a
  // BPM, and align the clock so the tapped beat becomes the downbeat.
  const tapTimesRef = useRef<number[]>([]);
  const onTapTempo = (t: number) => {
    const times = tapTimesRef.current;
    const last = times.length ? times[times.length - 1] : 0;
    if (times.length && t - last > TAP_RESET_MS) times.length = 0; // stale → restart
    times.push(t);
    if (times.length > 6) times.shift();
    // align: this tap is the downbeat; rebaseline the step + rotation detectors.
    alignOffset.value = t;
    hitStarted.value = 0;
    rotation.value = 0;
    setRotCount(0);
    if (times.length >= 2) {
      let sum = 0;
      for (let i = 1; i < times.length; i++) sum += times[i] - times[i - 1];
      const beatMs = sum / (times.length - 1);
      if (beatMs > 0) setTempo(60000 / beatMs);
    }
    tapPulse.value = 1;
    tapPulse.value = withTiming(0, { duration: 260 });
  };

  // Vertical swipe tilts the camera — down into the isometric stack, up back to
  // top-down.
  const vDrag = Gesture.Pan()
    .maxPointers(1)
    .activeOffsetY([-14, 14])
    .failOffsetX([-28, 28])
    .onEnd((e) => {
      if (e.translationY > SWIPE_TILT) goTilt(1); // swipe down → isometric
      else if (e.translationY < -SWIPE_TILT) goTilt(0); // swipe up → top-down
    });

  const longPress = Gesture.LongPress()
    .minDuration(380)
    .maxDistance(16)
    .onStart((e) => {
      if (tilted.value !== 0) return;
      const dx = e.x - cx;
      const dy = e.y - cy;
      const r = Math.sqrt(dx * dx + dy * dy);
      if (r < R - 42 || r > R + 42) return;
      const subdivW = MAX_M;
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
      // bottom ring picker
      if (e.y >= pickTop - 10 && e.y <= pickTop + PICK_SIZE + 10) {
        for (let i = 0; i < N; i++) {
          const bx = pickStartX + i * (PICK_SIZE + PICK_GAP);
          if (e.x >= bx - 8 && e.x <= bx + PICK_SIZE + 8) {
            runOnJS(setCurrent)(i);
            return;
          }
        }
      }
      if (tilted.value === 0) {
        const dx = e.x - cx;
        const dy = e.y - cy;
        const r = Math.sqrt(dx * dx + dy * dy);
        if (r < CENTER_R) {
          runOnJS(onTapTempo)(clock.value);
          return;
        }
        if (r < R - 42 || r > R + 42) return;
        const subdivW = MAX_M;
        const a = Math.atan2(dy, dx);
        let j = Math.round(((a + Math.PI / 2) / (2 * Math.PI)) * subdivW);
        j = ((j % subdivW) + subdivW) % subdivW;
        runOnJS(toggle)(currentSV.value, j * (MAX_M / subdivW));
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

  // Centre tap-tempo target: fades out when tilted, flashes on each tap.
  const centerStyle = useAnimatedStyle(() => ({
    opacity: (1 - tilt.value) * (0.55 + 0.45 * tapPulse.value),
    transform: [{ scale: 1 + 0.16 * tapPulse.value }],
  }));

  return (
    <GestureDetector gesture={Gesture.Race(vDrag, longPress, tap)}>
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

        {/* centre tap-tempo target (hit-tested in `tap`) */}
        <Animated.View
          pointerEvents="none"
          style={[
            { position: 'absolute', left: cx - CENTER_R, top: cy - CENTER_R, width: 2 * CENTER_R, height: 2 * CENTER_R, borderRadius: CENTER_R, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.4)', backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center', zIndex: 200 },
            centerStyle,
          ]}
        >
          <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 11, fontWeight: '800', letterSpacing: 1.5 }}>TAP</Text>
        </Animated.View>

        <View style={styles.repTimer} pointerEvents="none">
          <Text style={styles.repText}>{rotCount % ROT_CYCLE}</Text>
        </View>

        {/* ring picker: tap a circle to switch to that ring (hit-tested in `tap`) */}
        <View pointerEvents="none">
          {RINGS.map((r, i) => (
            <View
              key={i}
              style={{
                position: 'absolute',
                left: pickStartX + i * (PICK_SIZE + PICK_GAP),
                top: pickTop,
                width: PICK_SIZE,
                height: PICK_SIZE,
                borderRadius: PICK_SIZE / 2,
                backgroundColor: r.color,
                opacity: i === current ? 1 : 0.32,
                borderWidth: i === current ? 3 : 0,
                borderColor: '#fff',
              }}
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
  repTimer: { position: 'absolute', bottom: 108, left: 0, right: 0, alignItems: 'center' },
  repText: { color: '#fff', fontSize: 30, fontWeight: '300', fontVariant: ['tabular-nums'] },
});
