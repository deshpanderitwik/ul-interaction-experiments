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
const PATH_HIT = 30; // max long-press-to-path distance to open a path's sheet

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
  raw: Pt[]; // as-drawn points (for the visible stroke)
  samples: Pt[]; // evenly arc-spaced points (arp steps)
  notes: number[]; // midi per sample
  subdivision: number;
  t0: number; // clock ms at creation — the runner starts at the stroke's beginning
};
type Fx = { pulse: SharedValue<number> };
type Pulse = { x: number; y: number; t: number; seed: number };

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
  const tempoRef = useRef(tempo);
  tempoRef.current = tempo;
  const heightRef = useRef(height);
  heightRef.current = height;
  const idRef = useRef(0);

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
      const pt = p.samples[stepIndex];
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
        const S = p.samples.length;
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
          fire(p, ((step % S) + S) % S);
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
      prev.map((p) => ({ ...p, notes: p.samples.map((s) => midiFromY(s.y, ladder, height)) }))
    );
  }, [ladder, height]);

  // Close the sheet if its path is gone.
  useEffect(() => {
    if (editing != null && !paths.some((p) => p.id === editing)) setEditing(null);
  }, [paths, editing]);

  // Id of the nearest path to a point (within PATH_HIT), or null.
  const hitPathId = (x: number, y: number): number | null => {
    let best: number | null = null;
    let bd = PATH_HIT;
    for (const p of pathsRef.current) {
      for (const pt of p.raw) {
        const d = Math.hypot(x - pt.x, y - pt.y);
        if (d < bd) {
          bd = d;
          best = p.id;
        }
      }
    }
    return best;
  };
  const onLongPress = (x: number, y: number) => {
    const id = hitPathId(x, y);
    if (id != null) setEditing(id);
  };
  const setSubdivision = (d: number) =>
    setPaths((prev) => prev.map((p) => (p.id === editing ? { ...p, subdivision: d } : p)));
  const deleteEditing = () => {
    setPaths((prev) => prev.filter((p) => p.id !== editing));
    setEditing(null);
  };

  // Draw gesture: record a stroke, then commit it as a path on release.
  const onDrawBegin = (x: number, y: number) => {
    draftRef.current = [{ x, y }];
    setDraft(draftRef.current.slice());
  };
  const onDrawMove = (x: number, y: number) => {
    const d = draftRef.current;
    const last = d[d.length - 1];
    if (last && dist(last, { x, y }) < MIN_SEG) return;
    d.push({ x, y });
    setDraft(d.slice());
  };
  const onDrawEnd = () => {
    const pts = draftRef.current;
    draftRef.current = [];
    setDraft([]);
    if (pts.length < 2 || pathLength(pts) < MIN_PATH_LEN) return;
    const steps = Math.max(MIN_STEPS, Math.min(MAX_STEPS, Math.round(pathLength(pts) / STEP_PX)));
    const samples = resample(pts, steps);
    const notes = samples.map((s) => midiFromY(s.y, ladderRef.current, heightRef.current));
    setPaths((prev) => [
      ...prev,
      { id: idRef.current++, raw: pts, samples, notes, subdivision: DEFAULT_SUB, t0: clock.value },
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

      {paths.length > 0 ? (
        <Pressable style={styles.clear} onPress={() => setPaths([])} hitSlop={10}>
          <Text style={styles.clearText}>Clear</Text>
        </Pressable>
      ) : null}

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

  const skPath = useMemo(() => {
    const p = Skia.Path.Make();
    const r = path.raw;
    if (r.length) {
      p.moveTo(r[0].x, r[0].y);
      for (let i = 1; i < r.length; i++) p.lineTo(r[i].x, r[i].y);
    }
    return p;
  }, [path.raw]);

  const samples = path.samples;
  const sub = path.subdivision;
  const t0 = path.t0;
  const pos = useDerivedValue(() => {
    const S = samples.length;
    if (S < 1) return { x: -100, y: -100 };
    const P = 240000 / (tempo * sub);
    const loopMs = S * P;
    let ph = (((clock.value - t0) % loopMs) + loopMs) % loopMs / loopMs;
    if (ph < 0) ph += 1;
    const fstep = ph * S;
    const i0 = Math.floor(fstep) % S;
    const i1 = (i0 + 1) % S;
    const frac = fstep - Math.floor(fstep);
    const a = samples[i0];
    const b = samples[i1];
    return { x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac };
  }, [samples, sub, tempo, t0]);

  const bloomOpacity = useDerivedValue(() => 0.12 + 0.5 * pulse.value);
  const runnerR = useDerivedValue(() => RUNNER_R * (1 + 0.5 * pulse.value));

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
        <Text style={styles.closeHint}>tap outside to close</Text>
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
  row: { flexDirection: 'row', gap: 10, marginBottom: 18 },
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
  closeHint: { color: 'rgba(255,255,255,0.32)', fontSize: 13, letterSpacing: 0.5, marginTop: 16 },
  clear: {
    position: 'absolute',
    bottom: 44,
    right: 20,
    paddingVertical: 9,
    paddingHorizontal: 18,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.28)',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  clearText: { color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: '600', letterSpacing: 0.5 },
});
