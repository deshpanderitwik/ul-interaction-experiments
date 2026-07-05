import {
  Blur,
  Canvas,
  Circle,
  Fill,
  Group,
  Line,
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
import { computeGridYs, fieldLadder, midiFromY, noteEnabled, PitchRuler, RULER_WIDTH } from './field';
import { useSettingsActions } from '../settings';
import { playSine } from './voice';

// Bodies · Emitters & Receivers — bodies as a medium, not metronomes.
//   double-tap → drop a RECEIVER (silent until a wave front reaches it, then it
//                sounds its note and flashes)
//   long-press (empty) → drop an EMITTER (a clocked driver that plucks its note
//                and spits an expanding wave on its subdivision)
//   long-press (an emitter) → its sheet (subdivision + delete)
//   long-press (a receiver) → delete it
//   drag → move a body (its note follows its height)
// Both sit on the same pitch grid (y = note). The wave you SEE is the wave that
// triggers — so rhythm emerges from where you place things: near receivers answer
// fast, far ones echo late, and two receivers make a pattern from their distances.

const PULSES = 32; // max concurrent waves the shader draws
const WAVE_LIFE = 2.4; // wave lifetime, seconds
const WAVE_SPEED = 260; // px/s — the ring's speed; shared by the shader and the trigger test
const RING_ALPHA = 0.35;
const SCHED_MS = 15;
const NODE_R = 18;
const HIT_R = 34;
const FLASH_MS = 480; // receiver flash decay
const MAX_NODES = 24;
const DEFAULT_SUB = 4; // 1/4-note emitter pulse

// Monochrome expanding-wave shader (white ring on black), fixed speed so the
// visible ring lines up with the trigger geometry.
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
    if (age < 0.0 || age > ${WAVE_LIFE}) { continue; }
    float seed = u_pulseSeed[i];
    float2 d = fragcoord - u_pulses[i];
    float len = length(d);
    float bump = flow(d * 0.012 + float2(seed * 21.0, seed * 13.0), u_time * 0.15).x;
    float dist = len * (1.0 + 0.05 * bump);
    float r = age * ${WAVE_SPEED}.0;
    float front = (dist - r) / 1.6; // hairline crest
    float halo = (dist - r) / 15.0; // soft aura behind/around the front
    float env = exp(-front * front) + 0.4 * exp(-halo * halo);
    float decay = max(0.0, 1.0 - age / ${WAVE_LIFE});
    light += env * decay * ${RING_ALPHA};
  }
  light = clamp(light, 0.0, 1.0);
  half3 col = half3(light);
  float dither = fract(sin(dot(fragcoord, float2(12.9898, 78.233))) * 43758.5453);
  col += half3((dither - 0.5) / 255.0);
  return half4(col, 1.0);
}
`)!;

type Kind = 'emitter' | 'receiver';
type Node = { id: number; x: number; y: number; midi: number; kind: Kind; subdivision: number };
type Fx = { pulse: SharedValue<number> };
type Pulse = { x: number; y: number; t: number; seed: number };
type Wave = { x: number; y: number; t0: number; fired: Set<number> };

export default function Emitters() {
  const live = useExperimentActive();
  const scale = useScale();
  const tempo = useTempo();
  const { width, height } = useWindowDimensions();
  const clock = useClock();

  const ladder = useMemo(() => fieldLadder(scale), [scale]);
  const ladderRef = useRef(ladder);
  ladderRef.current = ladder;
  const gridYs = useMemo(() => computeGridYs(ladder, height), [ladder, height]);

  const [nodes, setNodes] = useState<Node[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const tempoRef = useRef(tempo);
  tempoRef.current = tempo;
  const heightRef = useRef(height);
  heightRef.current = height;
  const idRef = useRef(0);
  const draggingRef = useRef<number | null>(null);

  const pulses = useSharedValue<Pulse[]>([]); // shader waves (published once per tick)
  const pulseBufRef = useRef<Pulse[]>([]); // authoritative JS-side buffer
  const wavesRef = useRef<Wave[]>([]); // trigger waves (JS)
  const fxRef = useRef<Map<number, Fx>>(new Map());
  const registerFx = useCallback((id: number, fx: Fx) => {
    fxRef.current.set(id, fx);
  }, []);
  const unregisterFx = useCallback((id: number) => {
    fxRef.current.delete(id);
  }, []);

  useSettingsActions(
    useMemo(
      () => [
        {
          id: 'clear',
          label: 'Clear all',
          danger: true,
          onPress: () => {
            setNodes([]);
            wavesRef.current = [];
          },
        },
      ],
      []
    )
  );

  const popFx = (id: number, rise: number, fall: number) => {
    const fx = fxRef.current.get(id);
    if (!fx) return;
    fx.pulse.value = 0;
    fx.pulse.value = withSequence(
      withTiming(1, { duration: rise, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: fall, easing: Easing.out(Easing.quad) })
    );
  };

  // Emitter fires: pluck its own note, pop, and spawn a wave (shader + trigger).
  const emit = useCallback((n: Node, nowSec: number) => {
    if (noteEnabled(n.midi)) playSine(midiToFreq(n.midi)); // muted note: silent driver, still waves
    popFx(n.id, 70, 300);
    // accumulate into the JS buffer; the scheduler publishes it once per tick
    pulseBufRef.current.push({ x: n.x, y: n.y, t: nowSec, seed: Math.random() });
    const waves = wavesRef.current;
    waves.push({ x: n.x, y: n.y, t0: nowSec, fired: new Set() });
    if (waves.length > 64) waves.splice(0, waves.length - 64);
  }, []);

  // Receiver hit by a wave front: sound its note and flash.
  const fireReceiver = useCallback((r: Node) => {
    if (!noteEnabled(r.midi)) return; // muted note: no sound, no flash
    playSine(midiToFreq(r.midi));
    popFx(r.id, 60, FLASH_MS);
  }, []);

  // One scheduler: emitters pulse off the shared grid; live waves trigger any
  // receiver their front has just reached (once per wave).
  const schedRef = useRef<Map<number, { k: number; sig: string }>>(new Map());
  useEffect(() => {
    if (!live) return;
    const sched = schedRef.current;
    const handle = setInterval(() => {
      const now = clock.value;
      const nowSec = now / 1000;
      const bpm = tempoRef.current;
      const present = new Set<number>();
      for (const n of nodesRef.current) {
        if (n.kind !== 'emitter') continue;
        present.add(n.id);
        const P = periodMs(n.subdivision, bpm);
        const k = Math.floor(now / P);
        const sig = `${n.subdivision}:${bpm}`;
        if (draggingRef.current === n.id) {
          sched.set(n.id, { k, sig }); // muted while dragging
          continue;
        }
        const entry = sched.get(n.id);
        if (entry === undefined || entry.sig !== sig) sched.set(n.id, { k, sig });
        else if (k > entry.k) {
          sched.set(n.id, { k, sig });
          emit(n, nowSec);
        }
      }
      for (const id of sched.keys()) if (!present.has(id)) sched.delete(id);

      // waves → receivers
      const waves = wavesRef.current;
      const receivers = nodesRef.current.filter((n) => n.kind === 'receiver');
      for (let i = waves.length - 1; i >= 0; i--) {
        const w = waves[i];
        if (nowSec - w.t0 > WAVE_LIFE) {
          waves.splice(i, 1);
          continue;
        }
        const radius = (nowSec - w.t0) * WAVE_SPEED;
        for (const r of receivers) {
          if (draggingRef.current === r.id || w.fired.has(r.id)) continue;
          if (Math.hypot(r.x - w.x, r.y - w.y) <= radius) {
            w.fired.add(r.id);
            fireReceiver(r);
          }
        }
      }

      // Publish the accumulated wave buffer to the shader in one write — prune
      // dead pulses and cap length. Doing this once per tick (not per emit) is
      // what lets multiple emitters that fire together all show.
      let buf = pulseBufRef.current.filter((p) => nowSec - p.t <= WAVE_LIFE);
      if (buf.length > PULSES) buf = buf.slice(buf.length - PULSES);
      pulseBufRef.current = buf;
      pulses.value = buf;
    }, SCHED_MS);
    return () => {
      clearInterval(handle);
      sched.clear();
      wavesRef.current = [];
      pulseBufRef.current = [];
      pulses.value = [];
    };
  }, [live, emit, fireReceiver, clock, pulses]);

  // Re-pitch nodes when the scale or field height changes.
  useEffect(() => {
    setNodes((prev) => prev.map((n) => ({ ...n, midi: midiFromY(n.y, ladder, height) })));
  }, [ladder, height]);

  useEffect(() => {
    if (editing != null && !nodes.some((n) => n.id === editing)) setEditing(null);
  }, [editing, nodes]);

  const hitNode = (x: number, y: number): number | null => {
    const ns = nodesRef.current;
    for (let i = ns.length - 1; i >= 0; i--) {
      if (Math.hypot(x - ns[i].x, y - ns[i].y) <= HIT_R) return ns[i].id;
    }
    return null;
  };
  // A receiver must only answer wavefronts that reach it AFTER it appears/lands —
  // never a wave whose front has already swept past its spot. Mark such waves as
  // already-fired for this receiver so they don't retro-trigger it.
  const seedPassedWaves = (id: number, x: number, y: number) => {
    const nowSec = clock.value / 1000;
    for (const w of wavesRef.current) {
      const radius = (nowSec - w.t0) * WAVE_SPEED;
      if (Math.hypot(x - w.x, y - w.y) <= radius) w.fired.add(id);
    }
  };
  const place = (x: number, y: number, kind: Kind) => {
    if (x < RULER_WIDTH) return; // don't place under the ruler
    if (nodesRef.current.length >= MAX_NODES) return;
    const id = idRef.current++;
    if (kind === 'receiver') seedPassedWaves(id, x, y);
    setNodes((prev) => [
      ...prev,
      {
        id,
        x,
        y,
        midi: midiFromY(y, ladderRef.current, heightRef.current),
        kind,
        subdivision: DEFAULT_SUB,
      },
    ]);
  };
  const onDoubleTap = (x: number, y: number) => {
    if (hitNode(x, y) == null) place(x, y, 'receiver');
  };
  const onLongPress = (x: number, y: number) => {
    const id = hitNode(x, y);
    if (id == null) {
      place(x, y, 'emitter');
      return;
    }
    const n = nodesRef.current.find((nn) => nn.id === id);
    if (!n) return;
    if (n.kind === 'receiver') setNodes((prev) => prev.filter((nn) => nn.id !== id)); // just delete
    else setEditing(id); // emitter → sheet
  };
  const onDragBegin = (x: number, y: number) => {
    draggingRef.current = hitNode(x, y);
  };
  const onDragMove = (x: number, y: number) => {
    const id = draggingRef.current;
    if (id == null) return;
    const cx = Math.max(RULER_WIDTH, x); // never under the ruler
    setNodes((prev) =>
      prev.map((n) =>
        n.id === id ? { ...n, x: cx, y, midi: midiFromY(y, ladderRef.current, heightRef.current) } : n
      )
    );
  };
  const onDragEnd = () => {
    const id = draggingRef.current;
    if (id != null) {
      const n = nodesRef.current.find((nn) => nn.id === id);
      if (n && n.kind === 'receiver') seedPassedWaves(id, n.x, n.y); // don't retro-fire on landing
    }
    draggingRef.current = null;
  };

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(280)
    .onStart((e) => {
      if (!live) return;
      runOnJS(onDoubleTap)(e.x, e.y);
    });
  const longPress = Gesture.LongPress()
    .minDuration(350)
    .onStart((e) => {
      if (!live) return;
      runOnJS(onLongPress)(e.x, e.y);
    });
  const pan = Gesture.Pan()
    .minDistance(8)
    // onStart (not onBegin) so a body only mutes once you actually move it —
    // a long-press that doesn't move keeps it sounding.
    .onStart((e) => runOnJS(onDragBegin)(e.x, e.y))
    .onUpdate((e) => runOnJS(onDragMove)(e.x, e.y))
    .onFinalize(() => runOnJS(onDragEnd)());
  const gesture = Gesture.Race(pan, longPress, doubleTap);

  const editingNode = editing != null ? nodes.find((n) => n.id === editing) : undefined;
  const setSubdivision = (d: number) =>
    setNodes((prev) => prev.map((n) => (n.id === editing ? { ...n, subdivision: d } : n)));
  const deleteEditing = () => {
    setNodes((prev) => prev.filter((n) => n.id !== editing));
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
            {gridYs.map((y, i) => (
              <Line
                key={i}
                p1={vec(0, y)}
                p2={vec(width, y)}
                color="rgba(255,255,255,0.09)"
                strokeWidth={1}
              />
            ))}
            {nodes.map((n) => (
              <NodeView key={n.id} node={n} register={registerFx} unregister={unregisterFx} />
            ))}
          </Canvas>
        </View>
      </GestureDetector>

      <PitchRuler ladder={ladder} height={height} />

      {editingNode ? (
        <NodeSheet
          node={editingNode}
          onSubdivision={setSubdivision}
          onDelete={deleteEditing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </View>
  );
}

// Emitter: a solid disc that brightens and pops on each pulse. Receiver: a hollow
// ring that fills with a bright flash when a wave hits it.
function NodeView({
  node,
  register,
  unregister,
}: {
  node: Node;
  register: (id: number, fx: Fx) => void;
  unregister: (id: number) => void;
}) {
  const pulse = useSharedValue(0);
  useEffect(() => {
    register(node.id, { pulse });
    return () => unregister(node.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  const isEmitter = node.kind === 'emitter';
  const transform = useDerivedValue(() => [{ scale: 1 + 0.14 * pulse.value }]);
  const bloom = useDerivedValue(
    () => (isEmitter ? 0.16 : 0.0) + 0.5 * pulse.value,
    [isEmitter]
  );
  const core = useDerivedValue(
    () => (isEmitter ? 0.5 + 0.45 * pulse.value : 0.7 * pulse.value),
    [isEmitter]
  );

  return (
    <Group transform={transform} origin={{ x: node.x, y: node.y }}>
      <Circle cx={node.x} cy={node.y} r={NODE_R * 1.15} color="white" opacity={bloom}>
        <Blur blur={NODE_R * 0.5} />
      </Circle>
      <Circle cx={node.x} cy={node.y} r={NODE_R} color="white" opacity={core} />
      {!isEmitter ? (
        <Circle cx={node.x} cy={node.y} r={NODE_R} style="stroke" strokeWidth={2} color="white" opacity={0.4} />
      ) : null}
    </Group>
  );
}

// Long-press sheet: delete for both; emitters also get a subdivision selector.
function NodeSheet({
  node,
  onSubdivision,
  onDelete,
  onClose,
}: {
  node: Node;
  onSubdivision: (d: number) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.panel} pointerEvents="box-none">
        <Text style={styles.panelTitle}>{node.kind === 'emitter' ? 'Emitter' : 'Receiver'}</Text>

        {node.kind === 'emitter' ? (
          <>
            <Text style={styles.panelLabel}>subdivision</Text>
            <View style={styles.row}>
              {SUBDIVISIONS.map((s) => {
                const on = s.d === node.subdivision;
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
          </>
        ) : null}

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
