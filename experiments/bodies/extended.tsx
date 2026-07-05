import { Blur, Canvas, Circle, Fill, Group, Line, Path, Shader, Skia, useClock, vec } from '@shopify/react-native-skia';
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
import { BODY_R, MAX_BODIES, SUBDIVISIONS, periodMs, scaleMidiLadder } from './shared';
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
const GRAB_R = 48; // forgiving touch radius for grabbing a body (drag/tap/hold)
const HANDLE_R = 8; // drawn radius of a path waypoint handle
const HANDLE_HIT = 34; // touch radius to grab a waypoint handle

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
// Like yForMidi but never null: a note outside the window extrapolates linearly to
// a y beyond the screen edge, so a path's geometry and the body gliding it keep a
// continuous position as you scroll (rather than snapping off to infinity).
function yForMidiExt(
  midi: number,
  full: number[],
  scroll: number,
  visible: number,
  height: number
): number {
  const idx = full.indexOf(midi);
  const pos = (idx < 0 ? 0 : idx) - scroll;
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

type Waypoint = { x: number; midi: number };
type Body = {
  id: number;
  x: number;
  midi: number;
  subdivision: number;
  playing: boolean;
  path?: Waypoint[]; // if set (>=2), the body travels through these, playing each
  pathT0?: number; // clock ms when traversal started
};
type Fx = { pulse: SharedValue<number>; px: SharedValue<number>; py: SharedValue<number> };
type Pulse = { x: number; y: number; t: number; seed: number }; // published to the shader
type BufPulse = { x: number; midi: number; t: number; seed: number }; // anchored to its note

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
  const [laying, setLaying] = useState<Waypoint[] | null>(null); // path being laid for `editing`
  const layingRef = useRef<Waypoint[] | null>(null);
  layingRef.current = laying;

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
  const pulseBufRef = useRef<BufPulse[]>([]);
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

  // Sound a note: play, pop the body, and shed a ripple anchored to the note.
  const emitNote = useCallback(
    (bodyId: number, midi: number, x: number) => {
      if (!noteEnabled(midi)) return;
      playSine(midiToFreq(midi));
      const fx = fxRef.current.get(bodyId);
      if (fx) {
        fx.pulse.value = 0;
        fx.pulse.value = withSequence(
          withTiming(1, { duration: 70, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 320, easing: Easing.out(Easing.quad) })
        );
      }
      pulseBufRef.current.push({ x, midi, t: clock.value / 1000, seed: Math.random() });
    },
    [clock]
  );
  const fire = useCallback((b: Body) => emitNote(b.id, b.midi, b.x), [emitNote]);

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
        // Path body: glide through its waypoints (one per subdivision), playing
        // each note as it arrives. Its rendered position rides px/py.
        if (b.path && b.path.length >= 2 && b.pathT0 != null) {
          const N = b.path.length;
          const P = periodMs(b.subdivision, bpm);
          const stepF = (now - b.pathT0) / P;
          const step = Math.floor(stepF);
          const frac = stepF - step;
          const i0 = ((step % N) + N) % N;
          const i1 = (i0 + 1) % N;
          const fx = fxRef.current.get(b.id);
          if (fx) {
            const y0 = yForMidiExt(b.path[i0].midi, fullRef.current, scrollRef.current, visibleRef.current, heightRef.current);
            const y1 = yForMidiExt(b.path[i1].midi, fullRef.current, scrollRef.current, visibleRef.current, heightRef.current);
            fx.px.value = b.path[i0].x + (b.path[i1].x - b.path[i0].x) * frac;
            fx.py.value = y0 + (y1 - y0) * frac;
          }
          const sig = `path:${b.subdivision}:${bpm}`;
          const entry = sched.get(b.id);
          if (entry === undefined || entry.sig !== sig) sched.set(b.id, { k: step, sig });
          else if (step > entry.k) {
            sched.set(b.id, { k: step, sig });
            emitNote(b.id, b.path[i0].midi, b.path[i0].x);
          }
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
      // Recompute each ripple's screen y from the current scroll so it tracks its
      // note; off-window ripples are parked off-screen.
      pulses.value = buf.map((p) => {
        const py = yForMidiExt(p.midi, fullRef.current, scrollRef.current, visibleRef.current, heightRef.current);
        return { x: p.x, y: py, t: p.t, seed: p.seed };
      });
    }, SCHED_MS);
    return () => {
      clearInterval(handle);
      sched.clear();
      pulseBufRef.current = [];
      pulses.value = [];
    };
  }, [live, fire, emitNote, clock, pulses]);

  const midiAtY = (y: number) => midiFromY(y, windowLadder, height);
  const wpY = (midi: number) =>
    yForMidi(midi, fullRef.current, scrollRef.current, visibleRef.current, heightRef.current);
  // Tap/hold hit-test: a path body is hit at its gliding dot OR at any waypoint;
  // a static body at its note position. Topmost first.
  const hitId = (x: number, y: number): number | null => {
    const bs = bodiesRef.current;
    for (let i = bs.length - 1; i >= 0; i--) {
      const b = bs[i];
      if (b.path && b.path.length >= 2) {
        const fx = fxRef.current.get(b.id);
        if (fx && Math.hypot(x - fx.px.value, y - fx.py.value) <= GRAB_R) return b.id;
        for (const wp of b.path) {
          const wy = wpY(wp.midi);
          if (wy != null && Math.hypot(x - wp.x, y - wy) <= GRAB_R) return b.id;
        }
      } else {
        const by = wpY(b.midi);
        if (by != null && Math.hypot(x - b.x, y - by) <= GRAB_R) return b.id;
      }
    }
    return null;
  };
  // Static bodies only — path bodies aren't dragged as a whole (they ride rails);
  // you move them by dragging their waypoints instead.
  const hitStaticBody = (x: number, y: number): number | null => {
    const bs = bodiesRef.current;
    for (let i = bs.length - 1; i >= 0; i--) {
      const b = bs[i];
      if (b.path && b.path.length >= 2) continue;
      const by = wpY(b.midi);
      if (by != null && Math.hypot(x - b.x, y - by) <= GRAB_R) return b.id;
    }
    return null;
  };
  // A waypoint handle under the finger (for reshaping a laid path). Topmost first.
  const hitWaypoint = (x: number, y: number): { bodyId: number; index: number } | null => {
    const bs = bodiesRef.current;
    for (let i = bs.length - 1; i >= 0; i--) {
      const b = bs[i];
      if (!(b.path && b.path.length >= 2)) continue;
      for (let j = 0; j < b.path.length; j++) {
        const wy = wpY(b.path[j].midi);
        if (wy != null && Math.hypot(x - b.path[j].x, y - wy) <= HANDLE_HIT) return { bodyId: b.id, index: j };
      }
    }
    return null;
  };

  // While laying a path, a tap on the grid adds a waypoint.
  const addPathPoint = (x: number, y: number) => {
    const midi = midiAtY(y);
    const cx = Math.max(RULER_WIDTH, x);
    setLaying((prev) => (prev ? [...prev, { x: cx, midi }] : [{ x: cx, midi }]));
  };
  const addBody = (x: number, y: number) => {
    if (layingRef.current || x < RULER_WIDTH) return;
    setBodies((prev) =>
      prev.length >= MAX_BODIES
        ? prev
        : [...prev, { id: idRef.current++, x, midi: midiAtY(y), subdivision: 4, playing: true }]
    );
  };
  const toggleAt = (x: number, y: number) => {
    if (layingRef.current) {
      addPathPoint(x, y);
      return;
    }
    const id = hitId(x, y);
    if (id == null) return;
    setBodies((prev) => prev.map((b) => (b.id === id ? { ...b, playing: !b.playing } : b)));
  };
  const openPropsAt = (x: number, y: number) => {
    if (layingRef.current) return;
    const id = hitId(x, y);
    if (id != null) setEditing(id);
  };
  // A drag grabs (in priority order) a path waypoint, then a static body, else it
  // scrolls the window.
  const dragModeRef = useRef<'body' | 'waypoint' | 'scroll' | null>(null);
  const waypointDragRef = useRef<{ bodyId: number; index: number } | null>(null);
  const onDragBegin = (x: number, y: number) => {
    if (layingRef.current) {
      dragModeRef.current = null;
      return;
    }
    const wp = hitWaypoint(x, y);
    if (wp) {
      waypointDragRef.current = wp;
      dragModeRef.current = 'waypoint';
      return;
    }
    const id = hitStaticBody(x, y);
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
    if (dragModeRef.current === 'waypoint') {
      const wp = waypointDragRef.current;
      if (!wp) return;
      const cx = Math.max(RULER_WIDTH, x);
      const midi = midiAtY(y);
      setBodies((prev) =>
        prev.map((b) =>
          b.id === wp.bodyId && b.path
            ? { ...b, path: b.path.map((p, idx) => (idx === wp.index ? { x: cx, midi } : p)) }
            : b
        )
      );
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
    waypointDragRef.current = null;
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
    const dNotes = Math.round((y - scrollY0Ref.current) / spacing); // swipe down → higher notes
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
  // The path always begins where the body currently sits; the user taps the rest.
  const startLaying = () => {
    const b = bodiesRef.current.find((bb) => bb.id === editing);
    setLaying(b ? [{ x: b.x, midi: b.midi }] : []);
  };
  const cancelLaying = () => setLaying(null);
  const clearPath = () =>
    setBodies((prev) => prev.map((b) => (b.id === editing ? { ...b, path: undefined, pathT0: undefined } : b)));
  const confirmLaying = () => {
    const pts = laying;
    setLaying(null);
    setEditing(null);
    if (!pts || pts.length < 2) return;
    setBodies((prev) => prev.map((b) => (b.id === editing ? { ...b, path: pts, pathT0: clock.value } : b)));
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

  // One render entry per body. Path bodies always render (position via px/py);
  // static bodies render only when their note is in the window.
  const bodyViews = bodies.map((b) => {
    const isPath = !!(b.path && b.path.length >= 2);
    const y0 = isPath
      ? yForMidiExt(b.path![0].midi, fullLadder, scroll, visibleCount, height)
      : yForMidi(b.midi, fullLadder, scroll, visibleCount, height);
    return { b, isPath, y0 };
  });

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
            {bodyViews.map(({ b, isPath }) =>
              isPath ? (
                <PathLine
                  key={`p${b.id}`}
                  points={b.path!}
                  full={fullLadder}
                  scroll={scroll}
                  visible={visibleCount}
                  height={height}
                  handles
                />
              ) : null
            )}
            {laying && laying.length > 0 ? (
              <PathLine points={laying} full={fullLadder} scroll={scroll} visible={visibleCount} height={height} dots />
            ) : null}
            {bodyViews.map(({ b, isPath, y0 }) =>
              isPath || y0 != null ? (
                <BodyView
                  key={b.id}
                  body={b}
                  y0={y0 ?? -9999}
                  isPath={isPath}
                  register={registerFx}
                  unregister={unregisterFx}
                />
              ) : null
            )}
          </Canvas>
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

      {/* While laying a path, a dedicated full-screen catcher takes every tap and
          drops a waypoint. It sits above the gesture layer (so taps don't need to
          pass through the panel overlay) but below the panel's buttons. */}
      {laying != null ? (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={(e) => addPathPoint(e.nativeEvent.locationX, e.nativeEvent.locationY)}
        />
      ) : null}

      {editingBody ? (
        <PropertiesPanel
          body={editingBody}
          laying={laying}
          onSubdivision={setSubdivision}
          onMove={startLaying}
          onClearPath={clearPath}
          onConfirm={confirmLaying}
          onCancel={cancelLaying}
          onDelete={deleteEditing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </View>
  );
}

// The faint line a path body travels. `dots` marks the waypoints (used while
// laying); `handles` draws grabbable rings at each waypoint (a committed path you
// can drag to reshape).
function PathLine({
  points,
  full,
  scroll,
  visible,
  height,
  dots,
  handles,
}: {
  points: Waypoint[];
  full: number[];
  scroll: number;
  visible: number;
  height: number;
  dots?: boolean;
  handles?: boolean;
}) {
  // Extrapolate every waypoint's y (never null) so the stroke stays a single
  // continuous polyline as points scroll past the screen edge; Skia clips the
  // off-screen portion.
  const skPath = useMemo(() => {
    const p = Skia.Path.Make();
    points.forEach((wp, i) => {
      const y = yForMidiExt(wp.midi, full, scroll, visible, height);
      if (i === 0) p.moveTo(wp.x, y);
      else p.lineTo(wp.x, y);
    });
    return p;
  }, [points, full, scroll, visible, height]);

  return (
    <Group>
      <Path path={skPath} style="stroke" strokeWidth={1.5} strokeJoin="round" color="rgba(255,255,255,0.32)" />
      {dots
        ? points.map((wp, i) => (
            <Circle
              key={i}
              cx={wp.x}
              cy={yForMidiExt(wp.midi, full, scroll, visible, height)}
              r={4.5}
              color="rgba(255,255,255,0.7)"
            />
          ))
        : null}
      {handles
        ? points.map((wp, i) => (
            <Circle
              key={i}
              cx={wp.x}
              cy={yForMidiExt(wp.midi, full, scroll, visible, height)}
              r={HANDLE_R}
              style="stroke"
              strokeWidth={2}
              color="rgba(255,255,255,0.6)"
            />
          ))
        : null}
    </Group>
  );
}

function BodyView({
  body,
  y0,
  isPath,
  register,
  unregister,
}: {
  body: Body;
  y0: number;
  isPath: boolean;
  register: (id: number, fx: Fx) => void;
  unregister: (id: number) => void;
}) {
  const pulse = useSharedValue(0);
  const px = useSharedValue(isPath && body.path ? body.path[0].x : body.x);
  const py = useSharedValue(y0);
  useEffect(() => {
    register(body.id, { pulse, px, py });
    return () => unregister(body.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body.id]);

  const center = useDerivedValue(
    () => (isPath ? { x: px.value, y: py.value } : { x: body.x, y: y0 }),
    [isPath, body.x, y0]
  );
  const r = useDerivedValue(() => BODY_R * (1 + 0.14 * pulse.value));
  const glowOpacity = useDerivedValue(() => (body.playing ? 0.2 : 0.0) + 0.45 * pulse.value, [body.playing]);

  return (
    <Group>
      <Circle c={center} r={BODY_R * 1.1} color="white" opacity={glowOpacity}>
        <Blur blur={BODY_R * 0.5} />
      </Circle>
      {body.playing ? (
        <Circle c={center} r={r} color="white" />
      ) : (
        <Circle c={center} r={r} style="stroke" strokeWidth={2} color="white" opacity={0.5} />
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
  laying,
  onSubdivision,
  onMove,
  onClearPath,
  onConfirm,
  onCancel,
  onDelete,
  onClose,
}: {
  body: Body;
  laying: Waypoint[] | null;
  onSubdivision: (d: number) => void;
  onMove: () => void;
  onClearPath: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  // While laying, the rest of the screen must stay tappable (to add points), so
  // there's no backdrop.
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {laying == null ? <Pressable style={styles.backdrop} onPress={onClose} /> : null}
      <View style={styles.panel} pointerEvents="box-none">
        {laying != null ? (
          <>
            <Text style={styles.panelTitle}>Lay a path</Text>
            <Text style={styles.panelHint}>
              starts at the body · tap the grid to add stops · {Math.max(0, laying.length - 1)} added
            </Text>
            <View style={styles.confirmRow}>
              <Pressable style={styles.cancelBtn} onPress={onCancel}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.confirmBtn, laying.length < 2 && styles.confirmDisabled]}
                onPress={laying.length >= 2 ? onConfirm : undefined}
              >
                <Text style={styles.confirmText}>Confirm</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.panelTitle}>{noteName(body.midi)}</Text>
            <View style={styles.actionRow}>
              <Pressable style={styles.moveBtn} onPress={onMove}>
                <Text style={styles.moveText}>{body.path ? 'Re-path' : 'Move'}</Text>
              </Pressable>
              {body.path ? (
                <Pressable style={styles.moveBtn} onPress={onClearPath}>
                  <Text style={styles.moveText}>Clear path</Text>
                </Pressable>
              ) : null}
            </View>
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
          </>
        )}
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
  actionRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  moveBtn: {
    paddingVertical: 10,
    paddingHorizontal: 22,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  moveText: { color: '#fff', fontSize: 15, fontWeight: '700', letterSpacing: 0.5 },
  panelHint: { color: 'rgba(255,255,255,0.6)', fontSize: 13, marginBottom: 18, textAlign: 'center' },
  confirmRow: { flexDirection: 'row', gap: 12 },
  cancelBtn: {
    paddingVertical: 11,
    paddingHorizontal: 26,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  cancelText: { color: '#ddd', fontSize: 15, fontWeight: '700', letterSpacing: 0.5 },
  confirmBtn: {
    paddingVertical: 11,
    paddingHorizontal: 30,
    borderRadius: 12,
    backgroundColor: '#54f2b0',
  },
  confirmDisabled: { backgroundColor: 'rgba(84,242,176,0.3)' },
  confirmText: { color: '#0a0a0a', fontSize: 15, fontWeight: '700', letterSpacing: 0.5 },
});
