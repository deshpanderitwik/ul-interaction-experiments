import { useClock } from '@shopify/react-native-skia';
import { useNavigation } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useFrameCallback, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
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
function withAlpha(hex: string, a: number) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

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
const SWIPE_TILT = 40; // px of vertical swipe to flip the camera
// Long-press editor: the dot becomes a velocity bar with the every-N numbers
// stacked beside it.
const VBAR_W = 24; // velocity bar width
const VBAR_H = 156; // velocity bar height (full = max velocity)
const NUM_CHIP = 34; // every-N chip size in the vertical stack
const NUM_GAP = 8; // gap between stacked numbers
const GAP_BW = 18; // gap between the bar and the number stack
const EDIT_TOP = 84; // top margin for the editor box
const EDIT_BOT = 128; // bottom margin (timer + picker) for the editor box
const NUMBERS_H = EVERY_VALUES.length * NUM_CHIP + (EVERY_VALUES.length - 1) * NUM_GAP;
const VEL_GAIN_MIN = 0.04; // pluck gain at velocity 0
const VEL_GAIN_MAX = 0.3; // pluck gain at velocity 1
const VEL_DEFAULT = 0.8; // velocity a fresh hit starts at
const PICK_SIZE = 30; // diameter of a ring-picker circle at the bottom
const PICK_GAP = 16; // gap between ring-picker circles
const CENTER_R = 42; // radius of the centre tap-tempo target
const TAP_RESET_MS = 2000; // gap after which a new tap-tempo take starts fresh
const CLIP_M = 4; // screen-edge margin before a co-located stack grows inward
const CLIP_TOP = 72; // extra top margin (nav) for the clip test

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
  const [velocity, setVelocity] = useState<number[][]>(() => RINGS.map(() => new Array(MAX_M).fill(0)));
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
  const editVel = useSharedValue(VEL_DEFAULT); // live velocity for the editor bar
  const editP = useSharedValue(0); // editor morph: 0 = dot, 1 = full bar
  const editBarLeft = useSharedValue(0);
  const editBarTop = useSharedValue(0);
  const editNumX = useSharedValue(0);
  const editNumTop = useSharedValue(0);
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
  const velocityRef = useRef(velocity);
  velocityRef.current = velocity;
  const freqsRef = useRef(freqs);
  freqsRef.current = freqs;
  const subdivRef = useRef(subdiv);
  subdivRef.current = subdiv;
  const fireStep = (j: number) => {
    const a = activeRef.current;
    const ev = everyRef.current;
    const vl = velocityRef.current;
    const f = freqsRef.current;
    const pos = rotation.value % ROT_CYCLE;
    const p = j * (MAX_M / subdivRef.current); // display index → data slot
    for (let i = 0; i < N; i++) {
      if (!a[i][p] || vl[i][p] <= 0) continue; // velocity 0 = off
      const e = ev[i][p] || 1;
      if (pos % e === 0) {
        const gain = VEL_GAIN_MIN + vl[i][p] * (VEL_GAIN_MAX - VEL_GAIN_MIN);
        NoteSynth?.pluck(f[i], gain, 0.5).catch(() => {});
      }
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
    for (let i = 0; i < N; i++) for (let s = 0; s < MAX_M; s++) if (active[i][s] && velocity[i][s] > 0) perStep[s].push(i);
    const map: Fan[][] = RINGS.map(() => new Array<Fan>(MAX_M).fill(null));
    for (let s = 0; s < MAX_M; s++) perStep[s].forEach((li, idx) => (map[li][s] = { idx, total: perStep[s].length }));
    return map;
  }, [active, velocity]);

  // The selected dot's circumference point, plus the on-screen layout of the
  // velocity bar (centred on the dot) and the every-N number stack beside it.
  const editAnchor = useMemo(() => {
    if (!editing) return null;
    const a = (editing.step / MAX_M) * 2 * Math.PI - Math.PI / 2;
    const x = cx + R * Math.cos(a);
    const y = cy + R * Math.sin(a);
    const half = Math.max(VBAR_H, NUMBERS_H) / 2;
    const minCX = 16 + VBAR_W / 2;
    const maxCX = width - 16 - NUM_CHIP - GAP_BW - VBAR_W / 2;
    const barCX = Math.max(minCX, Math.min(maxCX, x));
    const barCY = Math.max(EDIT_TOP + half, Math.min(height - EDIT_BOT - half, y));
    const barLeft = barCX - VBAR_W / 2;
    const barTop = barCY - VBAR_H / 2;
    const numX = barLeft + VBAR_W + GAP_BW;
    const numTop = barCY - NUMBERS_H / 2;
    return { x, y, barLeft, barTop, barCX, barCY, numX, numTop };
  }, [editing, cx, cy, R, width, height]);

  useEffect(() => {
    if (editing && editAnchor) {
      editingSV.value = 1;
      editBarLeft.value = editAnchor.barLeft;
      editBarTop.value = editAnchor.barTop;
      editNumX.value = editAnchor.numX;
      editNumTop.value = editAnchor.numTop;
      // Show the stored velocity — 0 for an inactive dot (stays empty until the
      // user fills it), its current value for an active one.
      editVel.value = velocityRef.current[editing.ring][editing.step];
      editP.value = 0;
      editP.value = withSpring(1, { damping: 15, stiffness: 200, mass: 0.6 }); // dot → bar
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, editAnchor]);

  const toggle = (ring: number, step: number) => {
    const wasActive = activeRef.current[ring][step];
    setActive((prev) => {
      const next = prev.map((row) => row.slice());
      next[ring][step] = !next[ring][step];
      return next;
    });
    setEvery((prev) => {
      const next = prev.map((row) => row.slice());
      if (wasActive) next[ring][step] = 1;
      return next;
    });
    // Activating seeds the default velocity; deactivating clears it.
    setVelocity((prev) => prev.map((row, i) => (i === ring ? row.map((v, s) => (s === step ? (wasActive ? 0 : VEL_DEFAULT) : v)) : row)));
  };
  const setEveryAt = (ring: number, step: number, n: number) =>
    setEvery((prev) => prev.map((row, i) => (i === ring ? row.map((v, s) => (s === step ? n : v)) : row)));
  const commitVel = (v: number) => {
    if (!editing) return;
    const { ring, step } = editing;
    setVelocity((prev) => prev.map((row, i) => (i === ring ? row.map((val, s) => (s === step ? v : val)) : row)));
    // Velocity 0 = off: empty it out; any velocity turns the dot on.
    setActive((prev) => {
      const on = v > 0.02;
      if (prev[ring][step] === on) return prev;
      const next = prev.map((row) => row.slice());
      next[ring][step] = on;
      return next;
    });
  };
  const openEdit = (ring: number, step: number) => setEditing({ ring, step });
  const onClosed = () => setEditing(null);
  const closeEdit = () => {
    editingSV.value = 0; // stop intercepting immediately
    editP.value = withTiming(0, { duration: 190 }, (fin) => {
      'worklet';
      if (fin) runOnJS(onClosed)(); // bar → dot, then unmount
    });
  };
  const applyEvery = (n: number) => {
    // Keep the editor open so velocity and every-N can both be set; tap-outside
    // (closeEdit) dismisses it.
    if (!editing) return;
    const { ring, step } = editing;
    setEveryAt(ring, step, n);
    const wasActive = activeRef.current[ring][step];
    setActive((prev) => {
      if (prev[ring][step]) return prev;
      const next = prev.map((row) => row.slice());
      next[ring][step] = true;
      return next;
    });
    // Picking a number on a fresh dot activates it at the default velocity, and
    // the bar fills up to show it.
    if (!wasActive) {
      setVelocity((prev) => prev.map((row, i) => (i === ring ? row.map((v, s) => (s === step ? VEL_DEFAULT : v)) : row)));
      editVel.value = withTiming(VEL_DEFAULT, { duration: 220 });
    }
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

  // Vertical drag. While the editor is open it drags the velocity bar; otherwise
  // it's a swipe that tilts the camera (down → isometric, up → top-down).
  const vDrag = Gesture.Pan()
    .maxPointers(1)
    .activeOffsetY([-14, 14])
    .failOffsetX([-28, 28])
    .onUpdate((e) => {
      if (editingSV.value !== 1) return;
      let v = (editBarTop.value + VBAR_H - e.y) / VBAR_H;
      if (v < 0) v = 0;
      else if (v > 1) v = 1;
      editVel.value = v;
    })
    .onEnd((e) => {
      if (editingSV.value === 1) {
        runOnJS(commitVel)(editVel.value);
        return;
      }
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
        // number stack beside the bar: pick an every-N value.
        const nx = editNumX.value;
        const ntop = editNumTop.value;
        for (let i = 0; i < EVERY_VALUES.length; i++) {
          const ny = ntop + i * (NUM_CHIP + NUM_GAP);
          if (e.x >= nx && e.x <= nx + NUM_CHIP && e.y >= ny && e.y <= ny + NUM_CHIP) {
            runOnJS(applyEvery)(EVERY_VALUES[i]);
            return;
          }
        }
        // tapping on/near the bar sets velocity at that height.
        const bl = editBarLeft.value;
        const bt = editBarTop.value;
        if (e.x >= bl - 14 && e.x <= bl + VBAR_W + 14 && e.y >= bt - 10 && e.y <= bt + VBAR_H + 10) {
          let v = (bt + VBAR_H - e.y) / VBAR_H;
          if (v < 0) v = 0;
          else if (v > 1) v = 1;
          editVel.value = v;
          runOnJS(commitVel)(v);
          return;
        }
        runOnJS(closeEdit)();
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

  // Centre tap-tempo target: solid (opaque) so the clock hand runs under it and
  // emerges at its edge; fades out when tilted, gives a little scale pop per tap.
  const centerStyle = useAnimatedStyle(() => ({
    opacity: 1 - tilt.value,
    transform: [{ scale: 1 + 0.16 * tapPulse.value }],
  }));
  // Numbers fade/scale in with the same morph progress as the bar.
  const numbersStyle = useAnimatedStyle(() => ({ opacity: editP.value, transform: [{ scale: 0.8 + 0.2 * editP.value }] }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: editP.value }));

  return (
    <GestureDetector gesture={Gesture.Race(vDrag, longPress, tap)}>
      <View style={styles.fill}>
        {RINGS.map((r, i) => (
          <RingLayer
            key={i}
            cx={cx}
            cy={cy}
            R={R}
            width={width}
            height={height}
            color={r.color}
            active={active[i]}
            every={every[i]}
            velocity={velocity[i]}
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

        {/* centre tap-tempo target (hit-tested in `tap`) — solid disc over the
            hands, showing the live BPM */}
        <Animated.View
          pointerEvents="none"
          style={[
            { position: 'absolute', left: cx - CENTER_R, top: cy - CENTER_R, width: 2 * CENTER_R, height: 2 * CENTER_R, borderRadius: CENTER_R, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.4)', backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', zIndex: 200 },
            centerStyle,
          ]}
        >
          <Text style={{ color: '#fff', fontSize: 24, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{tempo}</Text>
          <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, fontWeight: '800', letterSpacing: 1.5, marginTop: -1 }}>BPM</Text>
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

        {editing && editAnchor && (
          <View style={[StyleSheet.absoluteFill, { zIndex: 1000 }]} pointerEvents="none">
            <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)' }, scrimStyle]} />
            {/* the dot morphed into a velocity bar */}
            <VelocityBar color={RINGS[editing.ring].color} editVel={editVel} editP={editP} left={editAnchor.barLeft} top={editAnchor.barTop} originX={editAnchor.x} originY={editAnchor.y} />
            {/* every-N numbers stacked beside the bar (2 top → 8 bottom) */}
            <Animated.View style={[StyleSheet.absoluteFill, numbersStyle]}>
              {EVERY_VALUES.map((v, i) => {
                const ny = editAnchor.numTop + i * (NUM_CHIP + NUM_GAP);
                const on = every[editing.ring][editing.step] === v;
                return (
                  <View
                    key={v}
                    style={{ position: 'absolute', left: editAnchor.numX, top: ny, width: NUM_CHIP, height: NUM_CHIP, borderRadius: NUM_CHIP / 2, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, backgroundColor: on ? '#fff' : 'rgba(14,14,16,0.96)', borderColor: on ? '#fff' : 'rgba(255,255,255,0.5)' }}
                  >
                    <Text style={{ color: on ? '#0a0a0a' : '#fff', fontSize: 16, fontWeight: '700' }}>{v}</Text>
                  </View>
                );
              })}
            </Animated.View>
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
  width,
  height,
  color,
  active,
  every,
  velocity,
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
  width: number;
  height: number;
  color: string;
  active: boolean[];
  every: number[];
  velocity: number[];
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
  const ringStrokeStyle = useAnimatedStyle(() => ({ borderWidth: 1.5 + tilt.value * 1.5 })); // thicker in the isometric stack
  const slotStyle = useAnimatedStyle(() => ({ opacity: focus.value * (1 - tilt.value) }));
  const handStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${phase.value * 360}deg` }] }));

  return (
    <Animated.View style={[{ position: 'absolute', left: cx - R, top: cy - R, width: 2 * R, height: 2 * R, zIndex }, boxStyle]} pointerEvents="none">
      <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: 2 * R, height: 2 * R }, frameStyle]}>
        <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: 2 * R, height: 2 * R, borderRadius: R, borderColor: color }, ringStrokeStyle]} />
        <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: 2 * R, height: 2 * R }, handStyle]}>
          <View style={{ position: 'absolute', left: R - 1.5, top: 0, width: 3, height: R, borderRadius: 1.5, backgroundColor: '#fff' }} />
        </Animated.View>
      </Animated.View>

      <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: 2 * R, height: 2 * R }, slotStyle]}>
        {slots.map((slot) => {
          const sz = SLOT_SIZE[metricLevel(slot.p)];
          // An empty socket: a ring-colour rim centred on the stroke with a
          // background-matching fill, so it reads as a node in the line that
          // fills in solid when activated.
          return <View key={slot.p} style={{ position: 'absolute', left: slot.x - sz / 2, top: slot.y - sz / 2, width: sz, height: sz, borderRadius: sz / 2, borderWidth: 1.5, borderColor: withAlpha(color, 0.9), backgroundColor: '#000' }} />;
        })}
      </Animated.View>

      {slots.map((slot) => {
        const p = slot.p;
        if (!active[p] || velocity[p] <= 0) return null; // velocity 0 = off
        const info = fan[p];
        const total = info ? info.total : 1;
        const idx = info ? info.idx : 0;
        let dx = slot.x;
        let dy = slot.y;
        let extras = null;
        if (total > 1) {
          const a = slot.frac * 2 * Math.PI - Math.PI / 2;
          const ca = Math.cos(a);
          const sa = Math.sin(a);
          const dotR = ACT_SIZE[metricLevel(p)] / 2;
          // Would the outward end of a centred fan clip off-screen (top-down)? If
          // so, grow the stack inward from the circumference point instead, so no
          // dot is cut off.
          const tipR = R + ((total - 1) / 2) * SPREAD + dotR;
          const tipX = cx + tipR * ca;
          const tipY = cy + tipR * sa;
          const inward = tipX < CLIP_M || tipX > width - CLIP_M || tipY < CLIP_TOP || tipY > height - CLIP_M;
          const kc = inward ? -idx : idx - (total - 1) / 2;
          dx = slot.x + kc * SPREAD * ca;
          dy = slot.y + kc * SPREAD * sa;
          if (idx === 0) {
            const L = (total - 1) * SPREAD;
            const angDeg = (a * 180) / Math.PI;
            // connector runs along the fan: centred on the point, or shifted
            // inward when the stack grows inward.
            const midKc = inward ? -(total - 1) / 2 : 0;
            const lcx = slot.x + midKc * SPREAD * ca;
            const lcy = slot.y + midKc * SPREAD * sa;
            extras = (
              <>
                <View pointerEvents="none" style={{ position: 'absolute', left: lcx - L / 2, top: lcy - 0.75, width: L, height: 1.5, backgroundColor: 'rgba(255,255,255,0.5)', transform: [{ rotate: `${angDeg}deg` }] }} />
                <View pointerEvents="none" style={{ position: 'absolute', left: slot.x - 3, top: slot.y - 3, width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' }} />
              </>
            );
          }
        }
        const sz = ACT_SIZE[metricLevel(p)];
        return (
          <View key={p} pointerEvents="none">
            {extras}
            <ActiveDot phase={phase} rotation={rotation} frac={slot.frac} every={every[p] || 1} vel={velocity[p]} x={dx} y={dy} size={sz} color={color} isCurrent={isCurrent} />
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
  vel,
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
  vel: number;
  x: number;
  y: number;
  size: number;
  color: string;
  isCurrent: boolean;
}) {
  // Louder hits read more solid: opacity tracks velocity (with a faint floor).
  const dotOpacity = Math.max(0.12, Math.min(1, vel));
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
      {/* filled socket: solid fill in the ring's colour, opacity = velocity */}
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: x - size / 2, top: y - size / 2, width: size, height: size, borderRadius: size / 2, backgroundColor: color, opacity: dotOpacity, borderWidth: isCurrent ? 2 : 0, borderColor: '#fff' }, dotStyle]} />
      {every > 1 && (
        <View pointerEvents="none" style={{ position: 'absolute', left: x + size / 2 - 2, top: y - size / 2 - 10, minWidth: 14, paddingHorizontal: 3, height: 14, borderRadius: 7, backgroundColor: '#000', borderWidth: 1, borderColor: color, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color, fontSize: 9, fontWeight: '800' }}>{every}</Text>
        </View>
      )}
    </>
  );
}

// The selected dot morphed into a velocity bar: on open it grows out of the dot,
// on close it shrinks back into it (driven by editP). Filled from the bottom to
// the hit's velocity (drag/tap to change).
function VelocityBar({ color, editVel, editP, left, top, originX, originY }: { color: string; editVel: SharedValue<number>; editP: SharedValue<number>; left: number; top: number; originX: number; originY: number }) {
  // Interpolate position/height from the dot point (editP 0) to the bar (editP 1).
  const barCX = left + VBAR_W / 2;
  const containerStyle = useAnimatedStyle(() => {
    const g = editP.value;
    const inv = 1 - g;
    return {
      opacity: Math.min(1, g * 1.6),
      left: barCX - VBAR_W / 2,
      top: originY * inv + top * g,
      width: VBAR_W,
      height: VBAR_H * g,
      transform: [{ translateX: (originX - barCX) * inv }],
    };
  });
  // Fill is always the velocity fraction of the CURRENT (morphing) bar height, so
  // it reads correctly throughout the open/close instead of clipping to full.
  const fillStyle = useAnimatedStyle(() => ({ height: editVel.value * VBAR_H * editP.value }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', borderRadius: VBAR_W / 2, backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', overflow: 'hidden', justifyContent: 'flex-end' }, containerStyle]}>
      <Animated.View style={[{ width: '100%', backgroundColor: color, borderRadius: VBAR_W / 2 }, fillStyle]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  repTimer: { position: 'absolute', bottom: 108, left: 0, right: 0, alignItems: 'center' },
  repText: { color: '#fff', fontSize: 30, fontWeight: '300', fontVariant: ['tabular-nums'] },
});
