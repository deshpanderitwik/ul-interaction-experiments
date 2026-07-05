import {
  Blur,
  Canvas,
  Circle,
  Fill,
  Group,
  Line,
  Path,
  Shader,
  Skia,
  useClock,
  vec,
} from '@shopify/react-native-skia';
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
import { midiToFreq, useScale } from '../scale';
import { useTempo } from '../tempo';
import { periodMs, SUBDIVISIONS } from './shared';
import { PITCH_TOP, computeGridYs, fieldLadder, midiFromY, PitchRuler } from './field';
import { useSettingsActions } from '../settings';
import { playSine } from './voice';

// Bodies · Paths — trace a stroke across the same pitch field and a runner
// travels down it, plucking an arp: at each grid step it plays the note at its
// current height. Draw as many paths as you like; a Clear wipes them. Everything
// rides one clock, so all runners stay phase-locked to a common grid.

const PULSES = 24;
const LIFE = 1.6;
const RING_ALPHA = 0.24;
const SCHED_MS = 15;
const STEP_PX = 46; // arc-length between successive arp steps along a path
const MIN_STEPS = 3;
const MAX_STEPS = 24;
const MIN_PATH_LEN = 60; // ignore taps / tiny scribbles shorter than this
const MIN_SEG = 6; // min spacing between recorded draw points
const DEFAULT_SUB = 8; // 1/8-note steps
const RUNNER_R = 9;
const HANDLE_R = 11; // endpoint handle radius
const HANDLE_HIT = 28; // touch radius to grab an endpoint handle
const SUB_R = 4.5; // per-note sub-point radius
const SUB_HIT = 20; // touch radius to grab a sub-point

// Monochrome ripple shader (a hairline white ring per note on black), the same
// port used by Bodies. Fed a ring buffer of recent note-fires.
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

type Pt = { x: number; y: number };
type PathItem = {
  id: number;
  pts: Pt[]; // note points, one per arp step — the editable path geometry
  notes: number[]; // midi per point
  enabled: boolean[]; // per-step on/off — a disabled step is silent (runner still passes)
  subdivision: number;
  t0: number; // clock ms at creation — the runner starts at the stroke's beginning
};
type Fx = { pulse: SharedValue<number> };
type Pulse = { x: number; y: number; t: number; seed: number };
// A grab target under the finger: an endpoint (warps the whole stroke) or an
// interior note point (moves just that note).
type Grab =
  | { id: number; kind: 'warp'; end: 'a' | 'b' }
  | { id: number; kind: 'sub'; index: number };

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function pathLength(pts: Pt[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
  return L;
}
// Resample a polyline into `count` points evenly spaced by arc length, sampled at
// 0, 1/count, … (count-1)/count so the loop wraps cleanly from last back to first.
function resample(pts: Pt[], count: number): Pt[] {
  if (pts.length === 0) return [];
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  const total = cum[cum.length - 1];
  if (total === 0) return [pts[0]];
  const out: Pt[] = [];
  for (let j = 0; j < count; j++) {
    const target = (j / count) * total;
    let seg = 1;
    while (seg < pts.length && cum[seg] < target) seg++;
    if (seg >= pts.length) {
      out.push(pts[pts.length - 1]);
      continue;
    }
    const t = (target - cum[seg - 1]) / (cum[seg] - cum[seg - 1] || 1);
    out.push({
      x: pts[seg - 1].x + (pts[seg].x - pts[seg - 1].x) * t,
      y: pts[seg - 1].y + (pts[seg].y - pts[seg - 1].y) * t,
    });
  }
  return out;
}

// A smooth (Catmull-Rom) stroke through the note points, so a sparse polyline
// still reads as a curve.
function buildPath(pts: Pt[]) {
  const p = Skia.Path.Make();
  if (pts.length === 0) return p;
  p.moveTo(pts[0].x, pts[0].y);
  if (pts.length < 3) {
    for (let i = 1; i < pts.length; i++) p.lineTo(pts[i].x, pts[i].y);
    return p;
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    p.cubicTo(
      p1.x + (p2.x - p0.x) / 6,
      p1.y + (p2.y - p0.y) / 6,
      p2.x - (p3.x - p1.x) / 6,
      p2.y - (p3.y - p1.y) / 6,
      p2.x,
      p2.y
    );
  }
  return p;
}

export default function Paths() {
  const live = useExperimentActive();
  const scale = useScale();
  const tempo = useTempo();
  const { width, height } = useWindowDimensions();
  const clock = useClock();

  const ladder = useMemo(() => fieldLadder(scale), [scale]);
  const ladderRef = useRef(ladder);
  ladderRef.current = ladder;
  const gridYs = useMemo(() => computeGridYs(ladder, height), [ladder, height]);

  const [paths, setPaths] = useState<PathItem[]>([]);
  const [draft, setDraft] = useState<Pt[]>([]);
  // The path whose options sheet is open (long-pressed).
  const [editing, setEditing] = useState<number | null>(null);
  const pathsRef = useRef(paths);
  pathsRef.current = paths;
  const draftRef = useRef<Pt[]>([]);
  // Active point drag. Warp: snapshot of the note points + the grabbed endpoint,
  // for the lever bend. Sub: the interior note index being moved.
  const dragRef = useRef<
    | { id: number; kind: 'warp'; end: 'a' | 'b'; base: Pt[]; anchor: Pt }
    | { id: number; kind: 'sub'; index: number }
    | null
  >(null);
  const tempoRef = useRef(tempo);
  tempoRef.current = tempo;
  const heightRef = useRef(height);
  heightRef.current = height;
  const idRef = useRef(0);

  // "Clear paths" lives in the gear settings sheet (not a bottom button).
  useSettingsActions(
    useMemo(
      () => [{ id: 'clear', label: 'Clear paths', danger: true, onPress: () => setPaths([]) }],
      []
    )
  );

  const pulses = useSharedValue<Pulse[]>([]);
  const fxRef = useRef<Map<number, Fx>>(new Map());
  const registerFx = useCallback((id: number, fx: Fx) => {
    fxRef.current.set(id, fx);
  }, []);
  const unregisterFx = useCallback((id: number) => {
    fxRef.current.delete(id);
  }, []);

  // Fire one arp step of a path: sound the note, ripple at the step's point, pop
  // the runner.
  const fire = useCallback(
    (p: PathItem, stepIndex: number) => {
      const midi = p.notes[stepIndex];
      const pt = p.pts[stepIndex];
      if (midi == null || pt == null) return;
      playSine(midiToFreq(midi));
      const list = pulses.value.slice(-(PULSES - 1));
      list.push({ x: pt.x, y: pt.y, t: clock.value / 1000, seed: Math.random() });
      pulses.value = list;
      const fx = fxRef.current.get(p.id);
      if (fx) {
        fx.pulse.value = 0;
        fx.pulse.value = withSequence(
          withTiming(1, { duration: 70, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 320, easing: Easing.out(Easing.quad) })
        );
      }
    },
    [pulses, clock]
  );

  // Shared-grid scheduler: every runner steps off the same clock, so all the
  // paths stay phase-locked. A path advances one step per subdivision.
  const schedRef = useRef<Map<number, { k: number; sig: string }>>(new Map()); // id → last fired slot + its rhythm signature
  useEffect(() => {
    if (!live) return;
    const sched = schedRef.current;
    const handle = setInterval(() => {
      const now = clock.value;
      const bpm = tempoRef.current;
      const present = new Set<number>();
      for (const p of pathsRef.current) {
        present.add(p.id);
        const S = p.pts.length;
        if (S < 1) continue;
        const P = periodMs(p.subdivision, bpm);
        const k = Math.floor(now / P);
        const sig = `${p.subdivision}:${bpm}`;
        const entry = sched.get(p.id);
        if (entry === undefined || entry.sig !== sig) {
          sched.set(p.id, { k, sig }); // (re)align when subdivision/tempo changes — no fire
        } else if (k > entry.k) {
          sched.set(p.id, { k, sig });
          const step = k - Math.floor(p.t0 / P); // steps since the path was drawn
          const idx = ((step % S) + S) % S;
          if (p.enabled[idx]) fire(p, idx); // disabled steps stay silent; runner still passes
        }
      }
      for (const id of sched.keys()) if (!present.has(id)) sched.delete(id);
    }, SCHED_MS);
    return () => {
      clearInterval(handle);
      sched.clear();
    };
  }, [live, fire]);

  // Re-pitch every path's notes when the scale (or field height) changes.
  useEffect(() => {
    setPaths((prev) =>
      prev.map((p) => ({ ...p, notes: p.pts.map((s) => midiFromY(s.y, ladder, height)) }))
    );
  }, [ladder, height]);

  // Close the sheet if its path is gone.
  useEffect(() => {
    if (editing != null && !paths.some((p) => p.id === editing)) setEditing(null);
  }, [paths, editing]);

  // Long-press: on an endpoint handle → open the subdivision sheet; on an interior
  // step → toggle that note on/off.
  const onLongPress = (x: number, y: number) => {
    const g = hitGrab(x, y);
    if (!g) return;
    if (g.kind === 'warp') {
      setEditing(g.id);
    } else {
      setPaths((prev) =>
        prev.map((p) =>
          p.id === g.id
            ? { ...p, enabled: p.enabled.map((e, i) => (i === g.index ? !e : e)) }
            : p
        )
      );
    }
  };
  const setSubdivision = (d: number) =>
    setPaths((prev) => prev.map((p) => (p.id === editing ? { ...p, subdivision: d } : p)));
  const deleteEditing = () => {
    setPaths((prev) => prev.filter((p) => p.id !== editing));
    setEditing(null);
  };

  const notesFor = (pts: Pt[]) => pts.map((p) => midiFromY(p.y, ladderRef.current, heightRef.current));

  // What's under the finger: an endpoint (priority, larger target) or an interior
  // note point. Topmost path first.
  const hitGrab = (x: number, y: number): Grab | null => {
    const ps = pathsRef.current;
    for (let i = ps.length - 1; i >= 0; i--) {
      const pts = ps[i].pts;
      const a = pts[0];
      const b = pts[pts.length - 1];
      if (a && Math.hypot(x - a.x, y - a.y) <= HANDLE_HIT) return { id: ps[i].id, kind: 'warp', end: 'a' };
      if (b && Math.hypot(x - b.x, y - b.y) <= HANDLE_HIT) return { id: ps[i].id, kind: 'warp', end: 'b' };
    }
    for (let i = ps.length - 1; i >= 0; i--) {
      const pts = ps[i].pts;
      for (let j = 1; j < pts.length - 1; j++) {
        if (Math.hypot(x - pts[j].x, y - pts[j].y) <= SUB_HIT) return { id: ps[i].id, kind: 'sub', index: j };
      }
    }
    return null;
  };

  // Endpoint warp: far end pinned, grabbed end fully follows, points between move
  // proportionally (a lever bend). Re-pitches live so the runner varies as you drag.
  const warpPath = (x: number, y: number) => {
    const drag = dragRef.current;
    if (!drag || drag.kind !== 'warp') return;
    const dx = x - drag.anchor.x;
    const dy = y - drag.anchor.y;
    const n = drag.base.length;
    const pts = drag.base.map((pt, i) => {
      const t = n > 1 ? i / (n - 1) : 0;
      const w = drag.end === 'b' ? t : 1 - t;
      return { x: pt.x + w * dx, y: pt.y + w * dy };
    });
    setPaths((prev) => prev.map((p) => (p.id === drag.id ? { ...p, pts, notes: notesFor(pts) } : p)));
  };

  // Sub-point move: drag one note point to a new spot (fine, per-note editing).
  const subMove = (x: number, y: number) => {
    const drag = dragRef.current;
    if (!drag || drag.kind !== 'sub') return;
    setPaths((prev) =>
      prev.map((p) => {
        if (p.id !== drag.id) return p;
        const pts = p.pts.map((pt, idx) => (idx === drag.index ? { x, y } : pt));
        const notes = p.notes.map((n, idx) =>
          idx === drag.index ? midiFromY(y, ladderRef.current, heightRef.current) : n
        );
        return { ...p, pts, notes };
      })
    );
  };

  // Pan: grab a point to reshape a path, otherwise draw a new stroke.
  const onDrawBegin = (x: number, y: number) => {
    const g = hitGrab(x, y);
    if (g) {
      const p = pathsRef.current.find((pp) => pp.id === g.id);
      if (p) {
        if (g.kind === 'warp') {
          dragRef.current = {
            id: g.id,
            kind: 'warp',
            end: g.end,
            base: p.pts.map((q) => ({ ...q })),
            anchor: { ...(g.end === 'a' ? p.pts[0] : p.pts[p.pts.length - 1]) },
          };
        } else {
          dragRef.current = { id: g.id, kind: 'sub', index: g.index };
        }
      }
      return; // grabbing a point — don't start a new stroke
    }
    dragRef.current = null;
    draftRef.current = [{ x, y }];
    setDraft(draftRef.current.slice());
  };
  const onDrawMove = (x: number, y: number) => {
    const drag = dragRef.current;
    if (drag) {
      if (drag.kind === 'warp') warpPath(x, y);
      else subMove(x, y);
      return;
    }
    const d = draftRef.current;
    const last = d[d.length - 1];
    if (last && dist(last, { x, y }) < MIN_SEG) return;
    d.push({ x, y });
    setDraft(d.slice());
  };
  const onDrawEnd = () => {
    if (dragRef.current) {
      dragRef.current = null; // finished reshaping
      return;
    }
    const drawn = draftRef.current;
    draftRef.current = [];
    setDraft([]);
    if (drawn.length < 2 || pathLength(drawn) < MIN_PATH_LEN) return;
    const steps = Math.max(MIN_STEPS, Math.min(MAX_STEPS, Math.round(pathLength(drawn) / STEP_PX)));
    const pts = resample(drawn, steps);
    setPaths((prev) => [
      ...prev,
      {
        id: idRef.current++,
        pts,
        notes: notesFor(pts),
        enabled: pts.map(() => true),
        subdivision: DEFAULT_SUB,
        t0: clock.value,
      },
    ]);
  };

  // Drag draws a path (needs a little movement, so a hold stays a hold); a hold on
  // a path opens its options sheet.
  const draw = Gesture.Pan()
    .minDistance(6)
    .onBegin((e) => {
      if (!live) return;
      runOnJS(onDrawBegin)(e.x, e.y);
    })
    .onUpdate((e) => {
      if (!live) return;
      runOnJS(onDrawMove)(e.x, e.y);
    })
    .onFinalize(() => {
      if (!live) return;
      runOnJS(onDrawEnd)();
    });
  const longPress = Gesture.LongPress()
    .minDuration(350)
    .onStart((e) => {
      if (!live) return;
      runOnJS(onLongPress)(e.x, e.y);
    });
  const gesture = Gesture.Race(draw, longPress);

  const editingPath = editing != null ? paths.find((p) => p.id === editing) : undefined;

  const draftPath = useMemo(() => {
    const p = Skia.Path.Make();
    if (draft.length) {
      p.moveTo(draft[0].x, draft[0].y);
      for (let i = 1; i < draft.length; i++) p.lineTo(draft[i].x, draft[i].y);
    }
    return p;
  }, [draft]);

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

  return (
    <View style={styles.fill}>
      <GestureDetector gesture={gesture}>
        <View style={styles.fill}>
          <Canvas style={StyleSheet.absoluteFill}>
            <Fill>
              <Shader source={source} uniforms={uniforms} />
            </Fill>
            {gridYs.map((y, i) => (
              <Line
                key={i}
                p1={vec(0, y)}
                p2={vec(width, y)}
                color="rgba(255,255,255,0.09)"
                strokeWidth={1}
              />
            ))}
            {draft.length > 1 ? (
              <Path
                path={draftPath}
                style="stroke"
                strokeWidth={1.5}
                strokeJoin="round"
                strokeCap="round"
                color="rgba(255,255,255,0.35)"
              />
            ) : null}
            {paths.map((p) => (
              <PathView
                key={p.id}
                path={p}
                tempo={tempo}
                clock={clock}
                selected={editing === p.id}
                register={registerFx}
                unregister={unregisterFx}
              />
            ))}
          </Canvas>
          <PitchRuler ladder={ladder} height={height} />
        </View>
      </GestureDetector>

      {editingPath ? (
        <PathSheet
          path={editingPath}
          onSubdivision={setSubdivision}
          onDelete={deleteEditing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </View>
  );
}

// One path: its faint stroke plus a white runner that glides along it in time,
// blooming on each step. The runner position is derived from the clock so it
// never re-renders React.
function PathView({
  path,
  tempo,
  clock,
  selected,
  register,
  unregister,
}: {
  path: PathItem;
  tempo: number;
  clock: SharedValue<number>;
  selected: boolean;
  register: (id: number, fx: Fx) => void;
  unregister: (id: number) => void;
}) {
  const pulse = useSharedValue(0);
  useEffect(() => {
    register(path.id, { pulse });
    return () => unregister(path.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path.id]);

  const pts = path.pts;
  const skPath = useMemo(() => buildPath(pts), [pts]);

  const sub = path.subdivision;
  const t0 = path.t0;
  const pos = useDerivedValue(() => {
    const S = pts.length;
    if (S < 1) return { x: -100, y: -100 };
    const P = 240000 / (tempo * sub);
    const loopMs = S * P;
    let ph = (((clock.value - t0) % loopMs) + loopMs) % loopMs / loopMs;
    if (ph < 0) ph += 1;
    const fstep = ph * S;
    const i0 = Math.floor(fstep) % S;
    const i1 = (i0 + 1) % S;
    const frac = fstep - Math.floor(fstep);
    const a = pts[i0];
    const b = pts[i1];
    return { x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac };
  }, [pts, sub, tempo, t0]);

  const bloomOpacity = useDerivedValue(() => 0.12 + 0.5 * pulse.value);
  const runnerR = useDerivedValue(() => RUNNER_R * (1 + 0.5 * pulse.value));

  const a = pts[0];
  const b = pts[pts.length - 1];
  const handleColor = selected ? 'rgba(255,120,120,0.9)' : 'rgba(255,255,255,0.85)';
  const subColor = selected ? 'rgba(255,120,120,0.8)' : 'rgba(255,255,255,0.55)';

  return (
    <Group>
      <Path
        path={skPath}
        style="stroke"
        strokeWidth={selected ? 2 : 1.5}
        strokeJoin="round"
        strokeCap="round"
        color={selected ? 'rgba(255,120,120,0.85)' : 'rgba(255,255,255,0.4)'}
      />
      {/* per-note sub-points (interior): filled = on, hollow = off; drag to move */}
      {pts.slice(1, -1).map((pt, idx) =>
        path.enabled[idx + 1] ? (
          <Circle key={idx} cx={pt.x} cy={pt.y} r={SUB_R} color={subColor} />
        ) : (
          <Circle
            key={idx}
            cx={pt.x}
            cy={pt.y}
            r={SUB_R}
            style="stroke"
            strokeWidth={1.5}
            color="rgba(255,255,255,0.3)"
          />
        )
      )}
      {/* draggable endpoint handles */}
      {a ? (
        <Circle cx={a.x} cy={a.y} r={HANDLE_R} style="stroke" strokeWidth={2} color={handleColor} />
      ) : null}
      {b ? (
        <Circle cx={b.x} cy={b.y} r={HANDLE_R} style="stroke" strokeWidth={2} color={handleColor} />
      ) : null}
      <Circle c={pos} r={RUNNER_R * 2.2} color="white" opacity={bloomOpacity}>
        <Blur blur={RUNNER_R} />
      </Circle>
      <Circle c={pos} r={runnerR} color="white" />
    </Group>
  );
}

// Long-press sheet for a path: subdivision selector + delete.
function PathSheet({
  path,
  onSubdivision,
  onDelete,
  onClose,
}: {
  path: PathItem;
  onSubdivision: (d: number) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.panel} pointerEvents="box-none">
        <Text style={styles.panelTitle}>Path · {path.notes.length} steps</Text>

        <Text style={styles.panelLabel}>subdivision</Text>
        <View style={styles.row}>
          {SUBDIVISIONS.map((s) => {
            const on = s.d === path.subdivision;
            return (
              <Pressable
                key={s.d}
                onPress={() => onSubdivision(s.d)}
                style={[
                  styles.subBtn,
                  on
                    ? { backgroundColor: '#fff', borderColor: '#fff' }
                    : { borderColor: 'rgba(255,255,255,0.28)' },
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
  panelTitle: { color: '#fff', fontSize: 18, fontWeight: '700', letterSpacing: 0.5, marginBottom: 16 },
  panelLabel: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 10,
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
