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
import { midiToFreq, noteName, useScale } from '../scale';
import { useTempo } from '../tempo';
import { BODY_R, HIT_R, MAX_BODIES, SUBDIVISIONS, periodMs, type Body } from './shared';
import {
  PITCH_TOP,
  PITCH_BOTTOM_INSET,
  fieldLadder,
  midiFromY as pitchAtY,
  computeGridYs,
  noteEnabled,
  PitchRuler,
} from './field';
import { playSine } from './voice';

// Bodies — the "compose a scene" atom (see THESIS.md), stark monochrome cut.
//   double-tap  → plant a body at that point (starts playing, on the scale)
//   single-tap  → play / pause that body
//   long-press  → open its properties (subdivision, note, delete)
//   drag        → move it around the scene
// Bodies are plain white circles. Each time a playing body plucks its sine it
// sheds a ripple — the same domain-warped ring shader as Fence · Raindrops, but
// monochrome (white rings on black) and emanating from the body's position.

const PULSES = 24; // max concurrent ripples across the whole scene
const LIFE = 1.6; // ripple lifetime, seconds
const RING_ALPHA = 0.24; // per-ring brightness — kept low so many voices don't wash out
const SCHED_MS = 15; // scheduler poll interval — the grid's timing resolution
const MAX_DRIFT_FRAC = 0.18; // max early/late as a fraction of a body's own step (subtle)

// Monochrome raindrop ripple: for each pulse, an organically-wobbled expanding
// ring of white light on black. Lifted from Fence · Raindrops' ring math with
// the ocean substrate removed.
const source = Skia.RuntimeEffect.Make(`
uniform float2 u_resolution;
uniform float u_time;
uniform float2 u_pulses[${PULSES}];
uniform float u_pulseTimes[${PULSES}];
uniform float u_pulseSeed[${PULSES}];

// domain-warp field, same trick as Waves/Raindrops — gives the rings an organic,
// non-perfect-circle wobble.
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

    // organic radius perturbation
    float bump = flow(d * 0.012 + float2(seed * 21.0, seed * 13.0), u_time * 0.15).x;
    float dist = len * (1.0 + 0.06 * bump);

    // a single expanding wavefront — one hairline ring (~2px) per note
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
  // subtle dither to keep the soft rings from banding
  float dither = fract(sin(dot(fragcoord, float2(12.9898, 78.233))) * 43758.5453);
  col += half3((dither - 0.5) / 255.0);
  return half4(col, 1.0);
}
`)!;

type Fx = { pulse: SharedValue<number> };
type Pulse = { x: number; y: number; t: number; seed: number };

// Horizontal position → timing offset against the grid. Center = on the grid;
// right of center plays late (+), left plays early (−). Scaled to a fraction of
// the body's own step so it stays subtle and never crosses into the next slot.
function driftMs(x: number, period: number, width: number): number {
  const frac = Math.max(-1, Math.min(1, (x - width / 2) / (width / 2)));
  return frac * MAX_DRIFT_FRAC * period;
}

export default function Bodies() {
  const live = useExperimentActive();
  const scale = useScale();
  const tempo = useTempo();
  const { width, height } = useWindowDimensions();
  const clock = useClock();

  const ladder = useMemo(() => fieldLadder(scale), [scale]);
  const ladderRef = useRef(ladder);
  ladderRef.current = ladder;

  // Full-width note-boundary lines (midpoints between note centers).
  const gridYs = useMemo(() => computeGridYs(ladder, height), [ladder, height]);

  // Vertical position → nearest scale note (top of the field = high, bottom = low).
  const midiFromY = useCallback((y: number) => pitchAtY(y, ladderRef.current, height), [height]);

  const [bodies, setBodies] = useState<Body[]>([]);
  const [editing, setEditing] = useState<number | null>(null);

  // Refs the audio timers and gesture callbacks read so they see current state
  // without re-subscribing.
  const bodiesRef = useRef(bodies);
  bodiesRef.current = bodies;
  const tempoRef = useRef(tempo);
  tempoRef.current = tempo;
  const widthRef = useRef(width);
  widthRef.current = width;
  const idRef = useRef(0);
  const draggingRef = useRef<number | null>(null);

  // Ring buffer of recent note-fires, fed to the ripple shader as uniforms.
  const pulses = useSharedValue<Pulse[]>([]);

  // Per-body pop channel, registered by each BodyView on mount.
  const fxRef = useRef<Map<number, Fx>>(new Map());
  const registerFx = useCallback((id: number, fx: Fx) => {
    fxRef.current.set(id, fx);
  }, []);
  const unregisterFx = useCallback((id: number) => {
    fxRef.current.delete(id);
  }, []);

  // Fire a body: sound, pop the body, and shed a ripple from its position.
  const fire = useCallback(
    (b: Body) => {
      if (!noteEnabled(b.midi)) return; // muted note: no sound, no ripple
      playSine(midiToFreq(b.midi));
      const fx = fxRef.current.get(b.id);
      if (fx) {
        fx.pulse.value = 0;
        fx.pulse.value = withSequence(
          withTiming(1, { duration: 70, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 320, easing: Easing.out(Easing.quad) })
        );
      }
      const list = pulses.value.slice(-(PULSES - 1));
      list.push({ x: b.x, y: b.y, t: clock.value / 1000, seed: Math.random() });
      pulses.value = list;
    },
    [pulses, clock]
  );

  // A single global scheduler drives every body off one shared grid, anchored at
  // t0. A body fires when real time crosses gridSlot·period + drift(x): dead
  // center is on the grid, right of center is a touch late, left a touch early.
  // Polling fast and firing on the crossing keeps all voices phase-locked, so the
  // drifted notes push and pull around a common pulse instead of free-running.
  const schedRef = useRef<Map<number, { k: number; sig: string }>>(new Map()); // body id → last fired slot + its rhythm signature
  const t0Ref = useRef(Date.now());
  useEffect(() => {
    if (!live) return;
    const sched = schedRef.current;
    const handle = setInterval(() => {
      const now = Date.now();
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
        // While dragging, stay silent but keep the slot counter current so the
        // body re-enters on the grid (not with a burst) once it lands.
        if (draggingRef.current === b.id) {
          sched.set(b.id, { k, sig });
          continue;
        }
        const entry = sched.get(b.id);
        if (entry === undefined || entry.sig !== sig) {
          sched.set(b.id, { k, sig }); // new/resumed/retimed voice: align, fire on the next slot
        } else if (k > entry.k) {
          sched.set(b.id, { k, sig });
          fire(b);
        }
      }
      for (const id of sched.keys()) if (!present.has(id)) sched.delete(id);
    }, SCHED_MS);
    return () => {
      clearInterval(handle);
      sched.clear(); // re-align to the grid when we come back on-screen
    };
  }, [live, fire]);

  // Close the panel if its body is deleted out from under it.
  useEffect(() => {
    if (editing != null && !bodies.some((b) => b.id === editing)) setEditing(null);
  }, [editing, bodies]);

  // Re-pitch every body when the scale or the field height changes.
  useEffect(() => {
    setBodies((prev) => prev.map((b) => ({ ...b, midi: midiFromY(b.y) })));
  }, [ladder, midiFromY]);

  // Topmost body under a point (last drawn wins), or null.
  const hitId = (x: number, y: number): number | null => {
    const bs = bodiesRef.current;
    for (let i = bs.length - 1; i >= 0; i--) {
      if (Math.hypot(x - bs[i].x, y - bs[i].y) <= HIT_R) return bs[i].id;
    }
    return null;
  };

  const addBody = (x: number, y: number) => {
    setBodies((prev) => {
      if (prev.length >= MAX_BODIES) return prev;
      return [
        ...prev,
        { id: idRef.current++, x, y, midi: midiFromY(y), subdivision: 4, playing: true },
      ];
    });
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

  const onDragBegin = (x: number, y: number) => {
    draggingRef.current = hitId(x, y);
  };
  const onDragMove = (x: number, y: number) => {
    const id = draggingRef.current;
    if (id == null) return;
    setBodies((prev) => prev.map((b) => (b.id === id ? { ...b, x, y, midi: midiFromY(y) } : b)));
  };
  const onDragEnd = () => {
    draggingRef.current = null;
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
    // onStart (not onBegin) so a body only mutes once you actually move it —
    // a long-press that doesn't move keeps the note sounding.
    .onStart((e) => runOnJS(onDragBegin)(e.x, e.y))
    .onUpdate((e) => runOnJS(onDragMove)(e.x, e.y))
    .onFinalize(() => runOnJS(onDragEnd)());
  // Race so the first intent to activate wins: move → drag, hold → properties,
  // otherwise a tap (double preferred over single, so a double-tap adds not toggles).
  const gesture = Gesture.Race(pan, longPress, Gesture.Exclusive(doubleTap, singleTap));

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

  return (
    <View style={styles.fill}>
      <GestureDetector gesture={gesture}>
        <View style={styles.fill}>
          <Canvas style={StyleSheet.absoluteFill}>
            <Fill>
              <Shader source={source} uniforms={uniforms} />
            </Fill>
            {/* note-boundary grid lines, behind the bodies */}
            {gridYs.map((y, i) => (
              <Line
                key={i}
                p1={vec(0, y)}
                p2={vec(width, y)}
                color="rgba(255,255,255,0.09)"
                strokeWidth={1}
              />
            ))}
            {bodies.map((b) => (
              <BodyView key={b.id} body={b} register={registerFx} unregister={unregisterFx} />
            ))}
          </Canvas>
          {/* on-grid center line + horizontal drift (early ↔ late) ruler */}
          <View style={styles.centerGuide} pointerEvents="none" />
          <DriftRuler />
          {/* note-name labels, centered on each body (dark on white when playing) */}
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            {bodies.map((b) => (
              <Text
                key={b.id}
                style={[
                  styles.label,
                  { left: b.x - 40, top: b.y - 7, color: b.playing ? '#0a0a0a' : '#fff' },
                ]}
              >
                {noteName(b.midi)}
              </Text>
            ))}
          </View>
        </View>
      </GestureDetector>

      {/* tappable pitch ruler (outside the gesture area so labels capture taps) */}
      <PitchRuler ladder={ladder} height={height} />

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

// A single body: a plain white circle — solid when playing, a hollow ring when
// paused — with a soft bloom and a scale pop kicked on each note. The ripple it
// sheds lives in the full-screen shader, not here.
function BodyView({
  body,
  register,
  unregister,
}: {
  body: Body;
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
  const glowOpacity = useDerivedValue(
    () => (body.playing ? 0.2 : 0.0) + 0.45 * pulse.value,
    [body.playing]
  );

  return (
    <Group transform={transform} origin={{ x: body.x, y: body.y }}>
      {/* soft bloom */}
      <Circle cx={body.x} cy={body.y} r={BODY_R * 1.1} color="white" opacity={glowOpacity}>
        <Blur blur={BODY_R * 0.5} />
      </Circle>
      {body.playing ? (
        <Circle cx={body.x} cy={body.y} r={BODY_R} color="white" />
      ) : (
        <Circle cx={body.x} cy={body.y} r={BODY_R} style="stroke" strokeWidth={2} color="white" opacity={0.5} />
      )}
    </Group>
  );
}

// Horizontal drift ruler along the bottom: a hairline with a center "grid" tick
// and early/late ends, matching the x→timing map (center = quantized).
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

// Long-press panel: subdivision buttons and delete. (Pitch is set by position,
// so there's no note control here — drag the body up/down to tune it.)
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
  label: {
    position: 'absolute',
    width: 80,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
    fontVariant: ['tabular-nums'],
  },
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
  driftLabels: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
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
    marginTop: 16,
    paddingVertical: 11,
    paddingHorizontal: 28,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(255,90,90,0.7)',
  },
  deleteText: { color: '#ff5a5a', fontSize: 15, fontWeight: '700', letterSpacing: 0.5 },
});
