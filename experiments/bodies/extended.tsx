import { Blur, Canvas, Circle, Fill, Group, Line, Shader, Skia, useClock, vec } from '@shopify/react-native-skia';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  Easing,
  runOnJS,
  useDerivedValue,
  useSharedValue,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useExperimentActive } from '../_host';
import { getScale, midiToFreq, noteName, useScale } from '../scale';
import { useTempo } from '../tempo';
import { BODY_R, HIT_R, MAX_BODIES, SUBDIVISIONS, periodMs, scaleMidiLadder } from './shared';
import {
  PITCH_BOTTOM_INSET,
  PITCH_TOP,
  RULER_WIDTH,
  computeGridYs,
  midiFromY,
  noteEnabled,
  toggleNote,
  useDisabledNotes,
} from './field';
import { playSine } from './voice';

// Bodies · Extended Grid — the same instrument as Bodies, but the pitch grid runs
// the full C0–C5 and only a window (as many notes as Bodies shows) is visible at
// once. Press and DRAG the note-label column on the left to scroll the window up
// and down. Bodies store their absolute pitch, so scrolling moves them vertically
// without changing what they play; a body scrolled out of the window is hidden
// but keeps sounding.

const PULSES = 24;
const LIFE = 1.6;
const RING_ALPHA = 0.24;
const SCHED_MS = 15;
const MAX_DRIFT_FRAC = 0.18;
const EXT_MIN = 24; // C0 (Ableton labeling)
const EXT_MAX = 84; // C5

function driftMs(x: number, period: number, width: number): number {
  const frac = Math.max(-1, Math.min(1, (x - width / 2) / (width / 2)));
  return frac * MAX_DRIFT_FRAC * period;
}

// y of a note at window-position `pos` (0 = lowest/bottom … visible-1 = top).
function yOfPos(pos: number, visible: number, height: number): number {
  const bottom = height - PITCH_BOTTOM_INSET;
  return visible > 1 ? bottom - (pos / (visible - 1)) * (bottom - PITCH_TOP) : (PITCH_TOP + bottom) / 2;
}
// y for an absolute midi given the current window, or null if scrolled off-screen.
function yForMidi(
  midi: number,
  full: number[],
  scroll: number,
  visible: number,
  height: number
): number | null {
  const idx = full.indexOf(midi);
  if (idx < 0) return null;
  const pos = idx - scroll;
  if (pos < 0 || pos > visible - 1) return null;
  return yOfPos(pos, visible, height);
}
function nearestLadder(full: number[], midi: number): number {
  let best = full[0] ?? midi;
  let bd = Infinity;
  for (const m of full) {
    const d = Math.abs(m - midi);
    if (d < bd) {
      bd = d;
      best = m;
    }
  }
  return best;
}

const source = Skia.RuntimeEffect.Make(`
uniform float2 u_resolution;
uniform float u_time;
uniform float2 u_pulses[${PULSES}];
uniform float u_pulseTimes[${PULSES}];
uniform float u_pulseSeed[${PULSES}];

float2 flow(float2 p, float time) {
  return float2(
    0.7 * sin(p.y * 1.5 + time * 0.35) + 0.22 * sin(p.y * 3.0 - time * 0.5),
    0.7 * sin(p.x * 1.3 + time * 0.3) + 0.22 * sin(p.x * 2.6 + time * 0.45)
  );
}

half4 main(float2 fragcoord) {
  float light = 0.0;
  for (int i = 0; i < ${PULSES}; i++) {
    float age = u_time - u_pulseTimes[i];
    if (age < 0.0 || age > ${LIFE}) { continue; }
    float seed = u_pulseSeed[i];
    float2 d = fragcoord - u_pulses[i];
    float len = length(d);
    float bump = flow(d * 0.012 + float2(seed * 21.0, seed * 13.0), u_time * 0.15).x;
    float dist = len * (1.0 + 0.06 * bump);
    float speed = 200.0 + seed * 70.0;
    float width = 1.2;
    float r = age * speed;
    float band = (dist - r) / width;
    float env = exp(-band * band);
    float decay = max(0.0, 1.0 - age / ${LIFE});
    light += env * decay * ${RING_ALPHA};
  }
  light = clamp(light, 0.0, 1.0);
  half3 col = half3(light);
  float dither = fract(sin(dot(fragcoord, float2(12.9898, 78.233))) * 43758.5453);
  col += half3((dither - 0.5) / 255.0);
  return half4(col, 1.0);
}
`)!;

type Body = { id: number; x: number; midi: number; subdivision: number; playing: boolean };
type Fx = { pulse: SharedValue<number> };
type Pulse = { x: number; y: number; t: number; seed: number };

export default function ExtendedGrid() {
  const live = useExperimentActive();
  const scale = useScale();
  const tempo = useTempo();
  const { width, height } = useWindowDimensions();
  const clock = useClock();
  const disabled = useDisabledNotes();

  const fullLadder = useMemo(() => scaleMidiLadder(scale, EXT_MIN, EXT_MAX), [scale]);
  const visibleCount = useMemo(() => Math.max(1, scaleMidiLadder(scale, 48, 72).length), [scale]);
  const maxScroll = Math.max(0, fullLadder.length - visibleCount);

  const [scrollIndex, setScrollIndex] = useState(() => {
    const fl = scaleMidiLadder(getScale(), EXT_MIN, EXT_MAX);
    const i = fl.indexOf(48); // start showing from ~C2 up
    return i < 0 ? 0 : i;
  });
  const scroll = Math.max(0, Math.min(maxScroll, scrollIndex));
  const windowLadder = useMemo(
    () => fullLadder.slice(scroll, scroll + visibleCount),
    [fullLadder, scroll, visibleCount]
  );
  const gridYs = useMemo(() => computeGridYs(windowLadder, height), [windowLadder, height]);

  const [bodies, setBodies] = useState<Body[]>([]);
  const [editing, setEditing] = useState<number | null>(null);

  const bodiesRef = useRef(bodies);
  bodiesRef.current = bodies;
  const tempoRef = useRef(tempo);
  tempoRef.current = tempo;
  const widthRef = useRef(width);
  widthRef.current = width;
  const heightRef = useRef(height);
  heightRef.current = height;
  const fullRef = useRef(fullLadder);
  fullRef.current = fullLadder;
  const scrollRef = useRef(scroll);
  scrollRef.current = scroll;
  const visibleRef = useRef(visibleCount);
  visibleRef.current = visibleCount;
  const maxScrollRef = useRef(maxScroll);
  maxScrollRef.current = maxScroll;
  const idRef = useRef(0);
  const draggingRef = useRef<number | null>(null);

  const pulses = useSharedValue<Pulse[]>([]);
  const pulseBufRef = useRef<Pulse[]>([]);
  const fxRef = useRef<Map<number, Fx>>(new Map());
  const registerFx = useCallback((id: number, fx: Fx) => {
    fxRef.current.set(id, fx);
  }, []);
  const unregisterFx = useCallback((id: number) => {
    fxRef.current.delete(id);
  }, []);

  // Keep bodies on the current scale (snap to nearest note) when the scale changes.
  useEffect(() => {
    setBodies((prev) => prev.map((b) => ({ ...b, midi: nearestLadder(fullLadder, b.midi) })));
  }, [fullLadder]);

  useEffect(() => {
    if (editing != null && !bodies.some((b) => b.id === editing)) setEditing(null);
  }, [editing, bodies]);

  const fire = useCallback(
    (b: Body) => {
      if (!noteEnabled(b.midi)) return;
      playSine(midiToFreq(b.midi));
      const fx = fxRef.current.get(b.id);
      if (fx) {
        fx.pulse.value = 0;
        fx.pulse.value = withSequence(
          withTiming(1, { duration: 70, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 320, easing: Easing.out(Easing.quad) })
        );
      }
      const y = yForMidi(b.midi, fullRef.current, scrollRef.current, visibleRef.current, heightRef.current);
      if (y != null) pulseBufRef.current.push({ x: b.x, y, t: clock.value / 1000, seed: Math.random() });
    },
    [clock]
  );

  // Shared-grid scheduler with drift (identical to Bodies), publishing the ripple
  // buffer once per tick so simultaneous bodies all show.
  const schedRef = useRef<Map<number, { k: number; sig: string }>>(new Map());
  const t0Ref = useRef(0);
  useEffect(() => {
    if (t0Ref.current === 0) t0Ref.current = clock.value;
    if (!live) return;
    const sched = schedRef.current;
    const handle = setInterval(() => {
      const now = clock.value;
      const nowSec = now / 1000;
      const bpm = tempoRef.current;
      const w = widthRef.current;
      const present = new Set<number>();
      for (const b of bodiesRef.current) {
        present.add(b.id);
        if (!b.playing) {
          sched.delete(b.id);
          continue;
        }
        const P = periodMs(b.subdivision, bpm);
        const k = Math.floor((now - t0Ref.current - driftMs(b.x, P, w)) / P);
        const sig = `${b.subdivision}:${bpm}`;
        // (No mute while dragging — a body keeps sounding as you move it.)
        const entry = sched.get(b.id);
        if (entry === undefined || entry.sig !== sig) sched.set(b.id, { k, sig });
        else if (k > entry.k) {
          sched.set(b.id, { k, sig });
          fire(b);
        }
      }
      for (const id of sched.keys()) if (!present.has(id)) sched.delete(id);

      let buf = pulseBufRef.current.filter((p) => nowSec - p.t <= LIFE);
      if (buf.length > PULSES) buf = buf.slice(buf.length - PULSES);
      pulseBufRef.current = buf;
      pulses.value = buf;
    }, SCHED_MS);
    return () => {
      clearInterval(handle);
      sched.clear();
      pulseBufRef.current = [];
      pulses.value = [];
    };
  }, [live, fire, clock, pulses]);

  const midiAtY = (y: number) => midiFromY(y, windowLadder, height);
  const hitId = (x: number, y: number): number | null => {
    const bs = bodiesRef.current;
    for (let i = bs.length - 1; i >= 0; i--) {
      const by = yForMidi(bs[i].midi, fullRef.current, scrollRef.current, visibleRef.current, heightRef.current);
      if (by == null) continue;
      if (Math.hypot(x - bs[i].x, y - by) <= HIT_R) return bs[i].id;
    }
    return null;
  };

  const addBody = (x: number, y: number) => {
    if (x < RULER_WIDTH) return;
    setBodies((prev) =>
      prev.length >= MAX_BODIES
        ? prev
        : [...prev, { id: idRef.current++, x, midi: midiAtY(y), subdivision: 4, playing: true }]
    );
  };
  const toggleAt = (x: number, y: number) => {
    const id = hitId(x, y);
    if (id == null) return;
    setBodies((prev) => prev.map((b) => (b.id === id ? { ...b, playing: !b.playing } : b)));
  };
  const openPropsAt = (x: number, y: number) => {
    const id = hitId(x, y);
    if (id != null) setEditing(id);
  };
  // A drag that lands on a body moves it; a drag on empty grid scrolls the window.
  const dragModeRef = useRef<'body' | 'scroll' | null>(null);
  const onDragBegin = (x: number, y: number) => {
    const id = hitId(x, y);
    if (id != null) {
      draggingRef.current = id;
      dragModeRef.current = 'body';
    } else {
      draggingRef.current = null;
      dragModeRef.current = 'scroll';
      scrollStartRef.current = scrollRef.current;
      scrollY0Ref.current = y;
    }
  };
  const onDragMove = (x: number, y: number) => {
    if (dragModeRef.current === 'scroll') {
      onScrollMove(y);
      return;
    }
    const id = draggingRef.current;
    if (id == null) return;
    const cx = Math.max(RULER_WIDTH, x);
    const midi = midiAtY(y);
    setBodies((prev) => prev.map((b) => (b.id === id ? { ...b, x: cx, midi } : b)));
  };
  const onDragEnd = () => {
    draggingRef.current = null;
    dragModeRef.current = null;
  };

  const singleTap = Gesture.Tap()
    .maxDuration(250)
    .onStart((e) => {
      if (!live) return;
      runOnJS(toggleAt)(e.x, e.y);
    });
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(280)
    .onStart((e) => {
      if (!live) return;
      runOnJS(addBody)(e.x, e.y);
    });
  const longPress = Gesture.LongPress()
    .minDuration(380)
    .onStart((e) => {
      if (!live) return;
      runOnJS(openPropsAt)(e.x, e.y);
    });
  const pan = Gesture.Pan()
    .minDistance(8)
    .onStart((e) => runOnJS(onDragBegin)(e.x, e.y))
    .onUpdate((e) => runOnJS(onDragMove)(e.x, e.y))
    .onFinalize(() => runOnJS(onDragEnd)());
  const gesture = Gesture.Race(pan, longPress, Gesture.Exclusive(doubleTap, singleTap));

  // Scroll gesture on the ruler column (drag up = higher notes).
  const scrollStartRef = useRef(0);
  const scrollY0Ref = useRef(0);
  const onScrollBegin = (y: number) => {
    scrollStartRef.current = scrollRef.current;
    scrollY0Ref.current = y;
  };
  const onScrollMove = (y: number) => {
    const bottom = heightRef.current - PITCH_BOTTOM_INSET;
    const spacing = (bottom - PITCH_TOP) / Math.max(1, visibleRef.current - 1);
    const dNotes = Math.round((scrollY0Ref.current - y) / spacing);
    setScrollIndex(Math.max(0, Math.min(maxScrollRef.current, scrollStartRef.current + dNotes)));
  };
  const scrollPan = Gesture.Pan()
    .minDistance(6)
    .onBegin((e) => runOnJS(onScrollBegin)(e.y))
    .onUpdate((e) => runOnJS(onScrollMove)(e.y));

  const editingBody = editing != null ? bodies.find((b) => b.id === editing) : undefined;
  const setSubdivision = (d: number) =>
    setBodies((prev) => prev.map((b) => (b.id === editing ? { ...b, subdivision: d } : b)));
  const deleteEditing = () => {
    setBodies((prev) => prev.filter((b) => b.id !== editing));
    setEditing(null);
  };

  const uniforms = useDerivedValue(() => {
    const pos: number[] = [];
    const times: number[] = [];
    const seeds: number[] = [];
    const ps = pulses.value;
    for (let i = 0; i < PULSES; i++) {
      const p = ps[i];
      if (p) {
        pos.push(p.x, p.y);
        times.push(p.t);
        seeds.push(p.seed);
      } else {
        pos.push(0, 0);
        times.push(-100);
        seeds.push(0);
      }
    }
    return {
      u_resolution: [width, height],
      u_time: clock.value / 1000,
      u_pulses: pos,
      u_pulseTimes: times,
      u_pulseSeed: seeds,
    };
  });

  // Bodies with a visible y (skip those scrolled off-window).
  const visibleBodies = bodies
    .map((b) => ({ b, y: yForMidi(b.midi, fullLadder, scroll, visibleCount, height) }))
    .filter((v): v is { b: Body; y: number } => v.y != null);

  return (
    <View style={styles.fill}>
      <GestureDetector gesture={gesture}>
        <View style={styles.fill}>
          <Canvas style={StyleSheet.absoluteFill}>
            <Fill>
              <Shader source={source} uniforms={uniforms} />
            </Fill>
            {gridYs.map((y, i) => (
              <Line key={i} p1={vec(0, y)} p2={vec(width, y)} color="rgba(255,255,255,0.09)" strokeWidth={1} />
            ))}
            {visibleBodies.map(({ b, y }) => (
              <BodyView key={b.id} body={b} y={y} register={registerFx} unregister={unregisterFx} />
            ))}
          </Canvas>
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            {visibleBodies.map(({ b, y }) => (
              <Text
                key={b.id}
                style={[styles.label, { left: b.x - 40, top: y - 7, color: b.playing ? '#0a0a0a' : '#fff' }]}
              >
                {noteName(b.midi)}
              </Text>
            ))}
          </View>
          <View style={styles.centerGuide} pointerEvents="none" />
          <DriftRuler />
        </View>
      </GestureDetector>

      {/* scrollable, tappable pitch ruler */}
      <GestureDetector gesture={scrollPan}>
        <View style={styles.ruler} pointerEvents="box-none">
          <View
            style={[styles.rulerSpine, { top: PITCH_TOP, height: Math.max(0, height - PITCH_BOTTOM_INSET - PITCH_TOP) }]}
            pointerEvents="none"
          />
          {windowLadder.map((midi, i) => {
            const y = yOfPos(i, visibleCount, height);
            const isOff = disabled.has(midi);
            return (
              <Pressable
                key={midi}
                onPress={() => toggleNote(midi)}
                hitSlop={{ top: 4, bottom: 4, left: 6, right: 14 }}
                style={[styles.rulerRow, { top: y - 11 }]}
              >
                <Text style={[styles.rulerLabel, isOff && styles.rulerLabelOff]}>{noteName(midi)}</Text>
                <View style={[styles.rulerTick, isOff && styles.rulerTickOff]} />
              </Pressable>
            );
          })}
        </View>
      </GestureDetector>

      {editingBody ? (
        <PropertiesPanel
          body={editingBody}
          onSubdivision={setSubdivision}
          onDelete={deleteEditing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </View>
  );
}

function BodyView({
  body,
  y,
  register,
  unregister,
}: {
  body: Body;
  y: number;
  register: (id: number, fx: Fx) => void;
  unregister: (id: number) => void;
}) {
  const pulse = useSharedValue(0);
  useEffect(() => {
    register(body.id, { pulse });
    return () => unregister(body.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body.id]);

  const transform = useDerivedValue(() => [{ scale: 1 + 0.14 * pulse.value }]);
  const glowOpacity = useDerivedValue(() => (body.playing ? 0.2 : 0.0) + 0.45 * pulse.value, [body.playing]);

  return (
    <Group transform={transform} origin={{ x: body.x, y }}>
      <Circle cx={body.x} cy={y} r={BODY_R * 1.1} color="white" opacity={glowOpacity}>
        <Blur blur={BODY_R * 0.5} />
      </Circle>
      {body.playing ? (
        <Circle cx={body.x} cy={y} r={BODY_R} color="white" />
      ) : (
        <Circle cx={body.x} cy={y} r={BODY_R} style="stroke" strokeWidth={2} color="white" opacity={0.5} />
      )}
    </Group>
  );
}

// Horizontal drift ruler along the bottom (center = quantized), same as Bodies.
function DriftRuler() {
  return (
    <View style={styles.driftRuler} pointerEvents="none">
      <View style={styles.driftLine} />
      <View style={styles.driftCenterTick} />
      <View style={styles.driftLabels}>
        <Text style={styles.driftText}>early</Text>
        <Text style={styles.driftText}>grid</Text>
        <Text style={styles.driftText}>late</Text>
      </View>
    </View>
  );
}

function PropertiesPanel({
  body,
  onSubdivision,
  onDelete,
  onClose,
}: {
  body: Body;
  onSubdivision: (d: number) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.panel} pointerEvents="box-none">
        <Text style={styles.panelTitle}>{noteName(body.midi)}</Text>
        <Text style={styles.panelLabel}>subdivision</Text>
        <View style={styles.row}>
          {SUBDIVISIONS.map((s) => {
            const on = s.d === body.subdivision;
            return (
              <Pressable
                key={s.d}
                onPress={() => onSubdivision(s.d)}
                style={[
                  styles.subBtn,
                  on ? { backgroundColor: '#fff', borderColor: '#fff' } : { borderColor: 'rgba(255,255,255,0.28)' },
                ]}
              >
                <Text style={[styles.subBtnText, on ? styles.subBtnTextOn : null]}>{s.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable style={styles.deleteBtn} onPress={onDelete}>
          <Text style={styles.deleteText}>Delete</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  label: {
    position: 'absolute',
    width: 80,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
    fontVariant: ['tabular-nums'],
  },
  ruler: { position: 'absolute', left: 0, top: 0, bottom: 0, width: RULER_WIDTH },
  rulerSpine: {
    position: 'absolute',
    left: 50,
    width: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  rulerRow: { position: 'absolute', left: 10, height: 22, flexDirection: 'row', alignItems: 'center', gap: 6 },
  rulerLabel: {
    width: 26,
    textAlign: 'right',
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  rulerLabelOff: { color: 'rgba(255,255,255,0.22)', textDecorationLine: 'line-through' },
  rulerTick: { width: 8, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.3)' },
  rulerTickOff: { backgroundColor: 'rgba(255,255,255,0.12)' },
  centerGuide: {
    position: 'absolute',
    left: '50%',
    marginLeft: -0.5,
    top: PITCH_TOP,
    bottom: PITCH_BOTTOM_INSET,
    width: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  driftRuler: { position: 'absolute', left: 20, right: 20, bottom: 46, height: 26 },
  driftLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 4,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  driftCenterTick: {
    position: 'absolute',
    left: '50%',
    marginLeft: -0.5,
    top: 0,
    width: StyleSheet.hairlineWidth,
    height: 10,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  driftLabels: { position: 'absolute', left: 0, right: 0, top: 10, flexDirection: 'row', justifyContent: 'space-between' },
  driftText: { color: 'rgba(255,255,255,0.4)', fontSize: 10, letterSpacing: 1 },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)' },
  panel: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 60,
    alignItems: 'center',
    paddingVertical: 22,
    paddingHorizontal: 20,
    borderRadius: 20,
    backgroundColor: 'rgba(14,14,16,0.96)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  panelTitle: { color: '#fff', fontSize: 20, fontWeight: '700', letterSpacing: 0.5, marginBottom: 16 },
  panelLabel: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 10,
    alignSelf: 'center',
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, marginBottom: 18 },
  subBtn: {
    minWidth: 50,
    paddingHorizontal: 12,
    height: 46,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  subBtnText: { color: 'rgba(255,255,255,0.85)', fontSize: 16, fontWeight: '600' },
  subBtnTextOn: { color: '#0a0a0a' },
  deleteBtn: {
    marginTop: 4,
    paddingVertical: 11,
    paddingHorizontal: 28,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(255,90,90,0.7)',
  },
  deleteText: { color: '#ff5a5a', fontSize: 15, fontWeight: '700', letterSpacing: 0.5 },
});
