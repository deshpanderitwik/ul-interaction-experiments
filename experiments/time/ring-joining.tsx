import { useClock } from '@shopify/react-native-skia';
import { useNavigation } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useFrameCallback, useSharedValue, withDelay, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { NoteSynth } from '../../modules/note-synth';
import { useExperimentActive } from '../_host';
import { useSharedClock } from '../combinations/clock';
import { scaleFrequencies, useScale } from '../scale';
import { setTempo, useTempo } from '../tempo';
import {
  BEATS_PER_BAR,
  CENTER_R,
  EDIT_BOT,
  EDIT_TOP,
  EVERY_VALUES,
  GAP,
  GAP_BW,
  LOOP_BARS,
  MAX_M,
  N,
  NUM_CHIP,
  metricLevel,
  NUM_GAP,
  NUMBERS_H,
  PICK_GAP,
  PICK_SIZE,
  RINGS,
  ROT_CYCLE,
  RingLayer,
  SWIPE_TILT,
  StackData,
  TAP_RESET_MS,
  VBAR_H,
  VBAR_W,
  VEL_DEFAULT,
  VEL_GAIN_MAX,
  VEL_GAIN_MIN,
  VelocityBar,
  computeFan,
  emptyStack,
} from './ring-stack';

// Time · Ring Joining — combine several Overlapping Rings IV stacks. The surface
// shows every stack top-down as a small live token, all phase-locked on one
// clock. A `+` adds a stack (up to four); drag a token sideways off-screen to
// remove it. Pinch open on a token to zoom into it — the full Rings IV editor —
// and pinch closed to pop back out to the surface.

const MAX_STACKS = 4;
// Staged add/remove: rings land, then the new ring grows, then the connector draws.
const LAND_MS = 260; // existing rings spring to their new slots
const GROW_MS = 220; // new ring grows in from zero
const DRAW_MS = 180; // connector draws in

type Stack = { id: number; data: StackData };

export default function RingJoining() {
  const live = useExperimentActive();
  const tempo = useTempo();
  const localClock = useClock();
  const sharedClock = useSharedClock();
  const clock = sharedClock ?? localClock;
  const { width, height } = useWindowDimensions();
  const navigation = useNavigation();

  const nextId = useRef(1);
  const [stacks, setStacks] = useState<Stack[]>(() => [{ id: 0, data: emptyStack() }]);
  const [zoom, setZoom] = useState<number | null>(null);
  const [rotCount, setRotCount] = useState(0);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [lastAddedId, setLastAddedId] = useState<number | null>(null); // token to delay-grow on add
  const [activeId, setActiveId] = useState(0); // id of the stack currently playing (user-selected)

  const phase = useSharedValue(0);
  const rotation = useSharedValue(0);
  const prevPhase = useSharedValue(0);
  const hitStarted = useSharedValue(0);
  const lastHit = useSharedValue(-1);
  const tempoSV = useSharedValue(tempo);
  const alignOffset = useSharedValue(0);
  const tapPulse = useSharedValue(0);
  const zoomP = useSharedValue(0);
  const dragX = useSharedValue(0);
  const dragAbsY = useSharedValue(0); // finger y for the dragged token
  const connDraw = useSharedValue(1); // connector draw progress (0 hidden … 1 drawn)

  useEffect(() => {
    tempoSV.value = tempo;
  }, [tempo, tempoSV]);
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: false });
    return () => navigation.setOptions({ gestureEnabled: true });
  }, [navigation]);

  const scale = useScale();
  const freqs = useMemo(() => {
    const pool = scaleFrequencies(scale, 48, 76);
    return RINGS.map((_, i) => pool[Math.round((i / (N - 1)) * (pool.length - 1))]);
  }, [scale]);
  const stacksRef = useRef(stacks);
  stacksRef.current = stacks;
  const freqsRef = useRef(freqs);
  freqsRef.current = freqs;
  const draggingIdRef = useRef<number | null>(null);
  const zoomRef = useRef<number | null>(null);
  zoomRef.current = zoom;
  const activeIdRef = useRef(0);
  activeIdRef.current = activeId;

  // Only the active stack plays (user-selects it by tapping a token). While a
  // stack is zoomed in (being edited) it solos so you can hear your edits.
  const fireAll = (step: number) => {
    const list = stacksRef.current;
    if (!list.length) return;
    const pos = rotation.value % ROT_CYCLE;
    const z = zoomRef.current;
    const st = (z != null && z >= 0 && z < list.length ? list[z] : list.find((s) => s.id === activeIdRef.current) ?? list[0]).data;
    const f = freqsRef.current;
    for (let i = 0; i < N; i++) {
      if (!st.active[i][step] || st.velocity[i][step] <= 0) continue;
      const e = st.every[i][step] || 1;
      if (pos % e === 0) {
        const gain = VEL_GAIN_MIN + st.velocity[i][step] * (VEL_GAIN_MAX - VEL_GAIN_MIN);
        NoteSynth?.pluck(f[i], gain, 0.5).catch(() => {});
      }
    }
  };

  const frame = useFrameCallback(() => {
    'worklet';
    const now = clock.value;
    const beatMs = 60000 / tempoSV.value;
    const loopMs = LOOP_BARS * BEATS_PER_BAR * beatMs;
    const ph = ((((now - alignOffset.value) % loopMs) + loopMs) % loopMs) / loopMs;
    if (hitStarted.value === 1 && ph < prevPhase.value - 0.5) {
      rotation.value += 1;
      runOnJS(setRotCount)(rotation.value);
    }
    prevPhase.value = ph;
    phase.value = ph;
    const step = Math.floor(ph * MAX_M) % MAX_M;
    if (hitStarted.value === 0) {
      lastHit.value = step;
      hitStarted.value = 1;
    } else if (step !== lastHit.value) {
      lastHit.value = step;
      runOnJS(fireAll)(step);
    }
  }, false);

  useEffect(() => {
    hitStarted.value = 0;
    frame.setActive(live);
    return () => frame.setActive(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, frame]);

  // Surface layout: a centred vertical column of same-size stacks, joined by
  // connectors. Fixed token size so add/remove only moves positions (which the
  // tokens animate toward).
  const surface = useMemo(() => {
    const n = stacks.length;
    const top = 104;
    const bottom = 150;
    const areaH = height - top - bottom;
    const centerY = top + areaH / 2;
    const tokenR = Math.min(width * 0.26, (areaH / MAX_STACKS) * 0.4);
    const pitch = 2 * tokenR + 34;
    const firstY = centerY - ((n - 1) * pitch) / 2;
    return stacks.map((_, i) => ({ x: width / 2, y: firstY + i * pitch, R: tokenR }));
  }, [stacks.length, width, height]);
  const surfaceRef = useRef(surface);
  surfaceRef.current = surface;

  const plusX = width / 2;
  const plusY = height - 78;
  const plusR = 27;
  const canAdd = stacks.length < MAX_STACKS;

  const setStackData = (i: number, updater: (s: StackData) => StackData) => setStacks((prev) => prev.map((s, idx) => (idx === i ? { ...s, data: updater(s.data) } : s)));
  const addStack = () => {
    if (stacks.length >= MAX_STACKS) return;
    const id = nextId.current++;
    setLastAddedId(id); // this token delay-grows after the others land
    setStacks((prev) => [...prev, { id, data: emptyStack() }]); // existing tokens spring to new slots
    // undraw instantly (so the new connector never flashes in), then draw it
    // after the rings land and the new one grows.
    connDraw.value = 0;
    connDraw.value = withDelay(LAND_MS + GROW_MS, withTiming(1, { duration: DRAW_MS }));
  };

  const enterZoom = (i: number) => {
    setZoom(i);
    zoomP.value = 0;
    zoomP.value = withTiming(1, { duration: 280 });
  };
  const clearZoom = () => setZoom(null);
  const exitZoom = () => {
    zoomP.value = withTiming(0, { duration: 260 }, (fin) => {
      'worklet';
      if (fin) runOnJS(clearZoom)();
    });
  };

  // Tap tempo (from the zoomed editor's centre): align the shared clock + set BPM.
  const tapTimesRef = useRef<number[]>([]);
  const onTapTempo = (t: number) => {
    const times = tapTimesRef.current;
    const last = times.length ? times[times.length - 1] : 0;
    if (times.length && t - last > TAP_RESET_MS) times.length = 0;
    times.push(t);
    if (times.length > 6) times.shift();
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

  // Surface gestures ------------------------------------------------------------
  const tryEnter = (fx: number, fy: number) => {
    const s = surfaceRef.current;
    if (!s.length) return;
    let best = 0;
    let bd = 1e9;
    s.forEach((t, i) => {
      const d = Math.hypot(fx - t.x, fy - t.y);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    enterZoom(best);
  };
  const beginDrag = (x: number, y: number) => {
    const s = surfaceRef.current;
    let best = -1;
    let bd = 1e9;
    s.forEach((t, i) => {
      const d = Math.hypot(x - t.x, y - t.y);
      if (d < t.R + 20 && d < bd) {
        bd = d;
        best = i;
      }
    });
    if (best < 0) {
      draggingIdRef.current = null;
      return;
    }
    const id = stacksRef.current[best].id;
    draggingIdRef.current = id;
    setDraggingId(id);
    connDraw.value = withTiming(0, { duration: 120 }); // undraw connectors while dragging
  };
  // Live reorder: as the dragged token crosses a slot centre, move it there so
  // the others snap around it into the vertical column.
  const maybeReorder = (absY: number) => {
    const id = draggingIdRef.current;
    if (id == null) return;
    const list = stacksRef.current;
    const from = list.findIndex((s) => s.id === id);
    if (from < 0) return;
    const s = surfaceRef.current;
    let to = 0;
    let bd = 1e9;
    s.forEach((p, i) => {
      const d = Math.abs(absY - p.y);
      if (d < bd) {
        bd = d;
        to = i;
      }
    });
    if (to !== from) setStacks((prev) => {
      const arr = prev.slice();
      const [item] = arr.splice(from, 1);
      arr.splice(to, 0, item);
      return arr;
    });
  };
  const clearDragging = () => {
    draggingIdRef.current = null;
    setDraggingId(null);
  };
  const dropDrag = () => {
    const id = draggingIdRef.current;
    const list = stacksRef.current;
    const idx = list.findIndex((s) => s.id === id);
    const s = surfaceRef.current;
    const targetY = idx >= 0 && s[idx] ? s[idx].y : dragAbsY.value;
    dragX.value = withSpring(0, { damping: 22, stiffness: 340, mass: 0.7 });
    dragAbsY.value = withSpring(targetY, { damping: 22, stiffness: 340, mass: 0.7 }, (fin) => {
      'worklet';
      if (fin) runOnJS(clearDragging)();
    });
    connDraw.value = withTiming(1, { duration: 140 }); // displaced (not removed) → connectors come straight back
  };
  const finishRemove = () => {
    // reverse of add: connectors already undrawn (during drag), the ring is gone
    // (dragged off), the rest land back, then the connectors redraw.
    const id = draggingIdRef.current;
    if (id != null) {
      const remaining = stacksRef.current.filter((s) => s.id !== id);
      if (remaining.length) {
        setStacks(remaining);
        if (id === activeIdRef.current) setActiveId(remaining[0].id); // active removed → pick another
      }
    }
    dragX.value = 0;
    clearDragging();
    connDraw.value = withDelay(LAND_MS, withTiming(1, { duration: DRAW_MS }));
  };

  const pinch = Gesture.Pinch().onEnd((e) => {
    if (e.scale >= 1.3) runOnJS(tryEnter)(e.focalX, e.focalY);
  });
  const drag = Gesture.Pan()
    .maxPointers(1)
    .onStart((e) => {
      dragX.value = 0;
      dragAbsY.value = e.y;
      runOnJS(beginDrag)(e.x, e.y);
    })
    .onUpdate((e) => {
      dragX.value = e.translationX;
      dragAbsY.value = e.y;
      runOnJS(maybeReorder)(e.y);
    })
    .onEnd((e) => {
      if (Math.abs(e.translationX) > 0.32 * width) runOnJS(finishRemove)();
      else runOnJS(dropDrag)();
    });
  // Tap the + to add, or tap a token to make it the active (playing) stack.
  const surfaceHit = (x: number, y: number) => {
    if (Math.hypot(x - plusX, y - plusY) <= plusR + 12) {
      addStack();
      return;
    }
    const s = surfaceRef.current;
    let best = -1;
    let bd = 1e9;
    s.forEach((t, i) => {
      const d = Math.hypot(x - t.x, y - t.y);
      if (d < t.R + 14 && d < bd) {
        bd = d;
        best = i;
      }
    });
    if (best >= 0) setActiveId(stacksRef.current[best].id);
  };
  const surfaceTap = Gesture.Tap()
    .maxDistance(16)
    .onEnd((e) => {
      runOnJS(surfaceHit)(e.x, e.y);
    });
  const surfaceGesture = Gesture.Simultaneous(pinch, Gesture.Race(drag, surfaceTap));

  const surfaceStyle = useAnimatedStyle(() => ({ opacity: 1 - zoomP.value, transform: [{ scale: 1 + 0.12 * zoomP.value }] }));
  const editorStyle = useAnimatedStyle(() => ({ opacity: zoomP.value, transform: [{ scale: 0.9 + 0.1 * zoomP.value }] }));

  return (
    <View style={styles.fill}>
      <GestureDetector gesture={surfaceGesture}>
        <Animated.View style={[StyleSheet.absoluteFill, surfaceStyle]} pointerEvents={zoom == null ? 'auto' : 'none'}>
          {/* connectors joining consecutive stacks; drawn/undrawn via connDraw */}
          {surface.slice(0, -1).map((s, i) => {
            const next = surface[i + 1];
            const y1 = s.y + s.R;
            const y2 = next.y - next.R;
            if (y2 <= y1) return null;
            return <Connector key={`c${i}`} x={width / 2} y1={y1} y2={y2} connDraw={connDraw} />;
          })}
          {stacks.map((st, i) => (
            <StackMini key={st.id} data={st.data} pos={surface[i]} phase={phase} playing={st.id === activeId} dragging={draggingId === st.id} enterDelay={st.id === lastAddedId ? LAND_MS : 0} dragX={dragX} dragAbsY={dragAbsY} />
          ))}

          {/* add-stack button */}
          <View pointerEvents="none" style={{ position: 'absolute', left: plusX - plusR, top: plusY - plusR, width: 2 * plusR, height: 2 * plusR, borderRadius: plusR, borderWidth: 2, borderColor: canAdd ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: canAdd ? '#fff' : 'rgba(255,255,255,0.25)', fontSize: 30, fontWeight: '300', marginTop: -3 }}>+</Text>
          </View>
        </Animated.View>
      </GestureDetector>

      {zoom != null && stacks[zoom] && (
        <Animated.View style={[StyleSheet.absoluteFill, editorStyle]}>
          <StackEditor
            data={stacks[zoom].data}
            setData={(u) => setStackData(zoom, u)}
            phase={phase}
            rotation={rotation}
            rotCount={rotCount}
            tempo={tempo}
            tapPulse={tapPulse}
            clock={clock}
            onTapTempo={onTapTempo}
            onExit={exitZoom}
          />
        </Animated.View>
      )}
    </View>
  );
}

// A live top-down token: one faint ring, the composite of active dots (colour +
// opacity = velocity), and a sweeping hand. Purpose-built for the small scale so
// strokes stay crisp. When dragged it follows the finger and fades toward the edge.
// The connector between two stacks; draws in/out from the top via connDraw.
function Connector({ x, y1, y2, connDraw }: { x: number; y1: number; y2: number; connDraw: SharedValue<number> }) {
  const full = y2 - y1;
  const style = useAnimatedStyle(() => ({ opacity: Math.min(1, connDraw.value * 1.4), height: full * connDraw.value }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: x - 1.5, top: y1, width: 3, backgroundColor: 'rgba(255,255,255,0.28)' }, style]}>
      <View style={{ position: 'absolute', left: -3, top: -4, width: 9, height: 9, borderRadius: 4.5, backgroundColor: 'rgba(255,255,255,0.5)' }} />
      <View style={{ position: 'absolute', left: -3, bottom: -4, width: 9, height: 9, borderRadius: 4.5, backgroundColor: 'rgba(255,255,255,0.5)' }} />
    </Animated.View>
  );
}

function StackMini({
  data,
  pos,
  phase,
  playing,
  dragging,
  enterDelay,
  dragX,
  dragAbsY,
}: {
  data: StackData;
  pos: { x: number; y: number; R: number };
  phase: SharedValue<number>;
  playing: boolean;
  dragging: boolean;
  enterDelay: number;
  dragX: SharedValue<number>;
  dragAbsY: SharedValue<number>;
}) {
  const { x, y, R } = pos;
  const dots = useMemo(() => {
    const out: { x: number; y: number; color: string; vel: number; size: number }[] = [];
    for (let i = 0; i < N; i++) {
      for (let p = 0; p < MAX_M; p++) {
        if (!data.active[i][p] || data.velocity[i][p] <= 0) continue;
        const a = (p / MAX_M) * 2 * Math.PI - Math.PI / 2;
        const size = R * (0.11 + 0.03 * metricLevel(p));
        out.push({ x: R + R * Math.cos(a), y: R + R * Math.sin(a), color: RINGS[i].color, vel: data.velocity[i][p], size });
      }
    }
    return out;
  }, [data, R]);
  // Position springs toward its slot so add/remove reflow smoothly; a fresh token
  // grows in from scale 0.
  const animY = useSharedValue(y);
  useEffect(() => {
    animY.value = withSpring(y, { damping: 20, stiffness: 220 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [y]);
  const mountScale = useSharedValue(0);
  useEffect(() => {
    // A freshly added ring waits for the others to land, then grows in.
    mountScale.value = withDelay(enterDelay, withSpring(1, { damping: 15, stiffness: 190, mass: 0.7 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const boxStyle = useAnimatedStyle(() => {
    if (dragging) return { left: x - R + dragX.value, top: dragAbsY.value - R, opacity: Math.max(0.15, 1 - Math.abs(dragX.value) / 280), transform: [{ scale: 1 }] };
    return { left: x - R, top: animY.value - R, opacity: (playing ? 1 : 0.42) * Math.min(1, mountScale.value * 1.6), transform: [{ scale: mountScale.value }] };
  });
  const handStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${phase.value * 360}deg` }] }));
  const lit = playing || dragging;
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: 2 * R, height: 2 * R }, boxStyle]}>
      {playing && <View style={{ position: 'absolute', left: -7, top: -7, width: 2 * R + 14, height: 2 * R + 14, borderRadius: R + 7, borderWidth: 2, borderColor: 'rgba(255,255,255,0.28)' }} />}
      <View style={{ position: 'absolute', left: 0, top: 0, width: 2 * R, height: 2 * R, borderRadius: R, borderWidth: lit ? 2 : 1.5, borderColor: lit ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.24)' }} />
      {playing && (
        <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: 2 * R, height: 2 * R }, handStyle]}>
          <View style={{ position: 'absolute', left: R - 1, top: 4, width: 2, height: R - 4, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.9)' }} />
        </Animated.View>
      )}
      {dots.map((d, k) => (
        <View key={k} style={{ position: 'absolute', left: d.x - d.size / 2, top: d.y - d.size / 2, width: d.size, height: d.size, borderRadius: d.size / 2, backgroundColor: d.color, opacity: Math.max(0.2, d.vel) }} />
      ))}
    </Animated.View>
  );
}

// The zoomed-in editor for one stack — the Overlapping Rings IV experience,
// operating on `data`/`setData` from the host. Pinch closed to exit.
function StackEditor({
  data,
  setData,
  phase,
  rotation,
  rotCount,
  tempo,
  tapPulse,
  clock,
  onTapTempo,
  onExit,
}: {
  data: StackData;
  setData: (u: (s: StackData) => StackData) => void;
  phase: SharedValue<number>;
  rotation: SharedValue<number>;
  rotCount: number;
  tempo: number;
  tapPulse: SharedValue<number>;
  clock: SharedValue<number>;
  onTapTempo: (t: number) => void;
  onExit: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const cx = width / 2;
  const cy = height * 0.44;
  const R = Math.min(width * 0.42, height * 0.24);
  const pickRowW = N * PICK_SIZE + (N - 1) * PICK_GAP;
  const pickStartX = cx - pickRowW / 2;
  const pickTop = height - 84;

  const [current, setCurrent] = useState(0);
  const [editing, setEditing] = useState<{ ring: number; step: number } | null>(null);
  const currentSV = useSharedValue(0);
  const editingSV = useSharedValue(0);
  const tilt = useSharedValue(0);
  const tilted = useSharedValue(0);
  const editVel = useSharedValue(VEL_DEFAULT);
  const editP = useSharedValue(0);
  const editBarLeft = useSharedValue(0);
  const editBarTop = useSharedValue(0);
  const editNumX = useSharedValue(0);
  const editNumTop = useSharedValue(0);
  const focus = RINGS.map((_, i) => useSharedValue(i === 0 ? 1 : 0));

  const dataRef = useRef(data);
  dataRef.current = data;

  useEffect(() => {
    currentSV.value = current;
  }, [current, currentSV]);
  useEffect(() => {
    for (let i = 0; i < N; i++) focus[i].value = withTiming(i === current ? 1 : 0, { duration: 220 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  const fan = useMemo(() => computeFan(data.active, data.velocity), [data]);

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
    return { x, y, barLeft, barTop, numX, numTop };
  }, [editing, cx, cy, R, width, height]);

  useEffect(() => {
    if (editing && editAnchor) {
      editingSV.value = 1;
      editBarLeft.value = editAnchor.barLeft;
      editBarTop.value = editAnchor.barTop;
      editNumX.value = editAnchor.numX;
      editNumTop.value = editAnchor.numTop;
      editVel.value = dataRef.current.velocity[editing.ring][editing.step];
      editP.value = 0;
      editP.value = withSpring(1, { damping: 15, stiffness: 200, mass: 0.6 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, editAnchor]);

  const toggle = (ring: number, step: number) =>
    setData((prev) => {
      const wasActive = prev.active[ring][step];
      const active = prev.active.map((r) => r.slice());
      active[ring][step] = !wasActive;
      const every = prev.every.map((r) => r.slice());
      if (wasActive) every[ring][step] = 1;
      const velocity = prev.velocity.map((r) => r.slice());
      velocity[ring][step] = wasActive ? 0 : VEL_DEFAULT;
      return { active, every, velocity };
    });
  const commitVel = (v: number) => {
    if (!editing) return;
    const { ring, step } = editing;
    setData((prev) => {
      const velocity = prev.velocity.map((r) => r.slice());
      velocity[ring][step] = v;
      const active = prev.active.map((r) => r.slice());
      active[ring][step] = v > 0.02;
      return { active, every: prev.every, velocity };
    });
  };
  const applyEvery = (n: number) => {
    if (!editing) return;
    const { ring, step } = editing;
    const wasActive = dataRef.current.active[ring][step];
    setData((prev) => {
      const every = prev.every.map((r) => r.slice());
      every[ring][step] = n;
      const active = prev.active.map((r) => r.slice());
      active[ring][step] = true;
      const velocity = prev.velocity.map((r) => r.slice());
      if (!wasActive) velocity[ring][step] = VEL_DEFAULT;
      return { active, every, velocity };
    });
    if (!wasActive) editVel.value = withTiming(VEL_DEFAULT, { duration: 220 });
  };
  const openEdit = (ring: number, step: number) => setEditing({ ring, step });
  const onClosed = () => setEditing(null);
  const closeEdit = () => {
    editingSV.value = 0;
    editP.value = withTiming(0, { duration: 190 }, (fin) => {
      'worklet';
      if (fin) runOnJS(onClosed)();
    });
  };
  const goTilt = (v: number) => {
    'worklet';
    tilted.value = v;
    tilt.value = withTiming(v, { duration: 550 });
  };

  const pinchExit = Gesture.Pinch().onEnd((e) => {
    if (e.scale <= 0.78) runOnJS(onExit)();
  });
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
      if (e.translationY > SWIPE_TILT) goTilt(1);
      else if (e.translationY < -SWIPE_TILT) goTilt(0);
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
      const a = Math.atan2(dy, dx);
      let j = Math.round(((a + Math.PI / 2) / (2 * Math.PI)) * MAX_M);
      j = ((j % MAX_M) + MAX_M) % MAX_M;
      runOnJS(openEdit)(currentSV.value, j);
    });
  const tap = Gesture.Tap()
    .numberOfTaps(1)
    .maxDistance(16)
    .onEnd((e) => {
      if (editingSV.value === 1) {
        const nx = editNumX.value;
        const ntop = editNumTop.value;
        for (let i = 0; i < EVERY_VALUES.length; i++) {
          const ny = ntop + i * (NUM_CHIP + NUM_GAP);
          if (e.x >= nx && e.x <= nx + NUM_CHIP && e.y >= ny && e.y <= ny + NUM_CHIP) {
            runOnJS(applyEvery)(EVERY_VALUES[i]);
            return;
          }
        }
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
        const a = Math.atan2(dy, dx);
        let j = Math.round(((a + Math.PI / 2) / (2 * Math.PI)) * MAX_M);
        j = ((j % MAX_M) + MAX_M) % MAX_M;
        runOnJS(toggle)(currentSV.value, j);
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

  const centerStyle = useAnimatedStyle(() => ({ opacity: 1 - tilt.value, transform: [{ scale: 1 + 0.16 * tapPulse.value }] }));
  const numbersStyle = useAnimatedStyle(() => ({ opacity: editP.value, transform: [{ scale: 0.8 + 0.2 * editP.value }] }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: editP.value }));

  return (
    <GestureDetector gesture={Gesture.Simultaneous(pinchExit, Gesture.Race(vDrag, longPress, tap))}>
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
            active={data.active[i]}
            every={data.every[i]}
            velocity={data.velocity[i]}
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

        <View pointerEvents="none">
          {RINGS.map((r, i) => (
            <View
              key={i}
              style={{ position: 'absolute', left: pickStartX + i * (PICK_SIZE + PICK_GAP), top: pickTop, width: PICK_SIZE, height: PICK_SIZE, borderRadius: PICK_SIZE / 2, backgroundColor: r.color, opacity: i === current ? 1 : 0.32, borderWidth: i === current ? 3 : 0, borderColor: '#fff' }}
            />
          ))}
        </View>

        {editing && editAnchor && (
          <View style={[StyleSheet.absoluteFill, { zIndex: 1000 }]} pointerEvents="none">
            <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)' }, scrimStyle]} />
            <VelocityBar color={RINGS[editing.ring].color} editVel={editVel} editP={editP} left={editAnchor.barLeft} top={editAnchor.barTop} originX={editAnchor.x} originY={editAnchor.y} />
            <Animated.View style={[StyleSheet.absoluteFill, numbersStyle]}>
              {EVERY_VALUES.map((v, i) => {
                const ny = editAnchor.numTop + i * (NUM_CHIP + NUM_GAP);
                const on = data.every[editing.ring][editing.step] === v;
                return (
                  <View key={v} style={{ position: 'absolute', left: editAnchor.numX, top: ny, width: NUM_CHIP, height: NUM_CHIP, borderRadius: NUM_CHIP / 2, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, backgroundColor: on ? '#fff' : 'rgba(14,14,16,0.96)', borderColor: on ? '#fff' : 'rgba(255,255,255,0.5)' }}>
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

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  repTimer: { position: 'absolute', bottom: 108, left: 0, right: 0, alignItems: 'center' },
  repText: { color: '#fff', fontSize: 30, fontWeight: '300', fontVariant: ['tabular-nums'] },
});
