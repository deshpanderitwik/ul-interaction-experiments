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
import { StyleSheet, View, useWindowDimensions } from 'react-native';
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
import {
  computeGridYs,
  fieldLadder,
  midiFromY,
  noteEnabled,
  PITCH_BOTTOM_INSET,
  PITCH_TOP,
  PitchRuler,
  RULER_WIDTH,
} from './field';
import { useSettingsActions } from '../settings';
import { playSine } from './voice';

// Bodies · Slingshot & Receivers — a fork of Emitters & Receivers where the driver
// isn't a clocked emitter but a slung body. Long-press empty grid to place a
// RECEIVER (silent until struck); drag back on empty grid and release to FLING a
// body that arcs and bounces like Slingshot — but it makes no sound on its own. It
// only rings a note when it collides with a receiver, which then sounds its pitch
// and flashes. Rhythm comes from the geometry of the throw and where the receivers
// sit. Long-press a receiver to delete it; drag a receiver to move it.

const PULSES = 24;
const LIFE = 1.6; // ripple lifetime, s
const RING_ALPHA = 0.24;
const SCHED_MS = 15;
const PROJ_R = 12; // slung body radius
const NODE_R = 18; // receiver radius
const HIT_R = 34; // touch radius for placing/dragging/deleting a receiver
const COLLIDE_R = NODE_R + 10; // a projectile within this of a receiver strikes it
const MAX_BODIES = 14;
const MAX_NODES = 24;
const FLASH_MS = 480; // receiver flash decay
const LAUNCH_K = 0.39; // launch speed = LAUNCH_K * pull^LAUNCH_EXP (px/tick)
const LAUNCH_EXP = 0.7; // sub-linear: big pulls give diminishing extra speed
const FRICTION = 0.99; // velocity kept per tick
const BOUNCE = 0.86; // velocity kept per wall bounce
const DEATH_SPEED = 1.2; // px/tick below which the body fades and dies
const FADE_REF = 6; // px/tick at which opacity reaches full
const MIN_PULL = 24; // min drawback to launch
const EDGE = 6; // screen-edge inset for horizontal bounce

// Hairline monochrome ripple (matches Bodies/Paths).
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

type Slung = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  dying: boolean;
  inside: Set<number>; // receiver ids the body is currently overlapping (for entry detection)
};
type Item = { id: number; x0: number; y0: number };
type Fx = { x: SharedValue<number>; y: SharedValue<number>; op: SharedValue<number>; pulse: SharedValue<number> };
type Node = { id: number; x: number; y: number; midi: number }; // a receiver
type RxFx = { pulse: SharedValue<number> };
type Pulse = { x: number; y: number; t: number; seed: number };
type Band = { ax: number; ay: number; fx: number; fy: number };

export default function SlingshotReceivers() {
  const live = useExperimentActive();
  const scale = useScale();
  const { width, height } = useWindowDimensions();
  const clock = useClock();

  const ladder = useMemo(() => fieldLadder(scale), [scale]);
  const ladderRef = useRef(ladder);
  ladderRef.current = ladder;
  const gridYs = useMemo(() => computeGridYs(ladder, height), [ladder, height]);
  const widthRef = useRef(width);
  widthRef.current = width;
  const heightRef = useRef(height);
  heightRef.current = height;

  const [items, setItems] = useState<Item[]>([]); // mounts a SlungBody per live projectile
  const [band, setBand] = useState<Band | null>(null); // slingshot draw feedback
  const bandRef = useRef<Band | null>(null);
  const slungRef = useRef<Slung[]>([]); // physics source of truth
  const idRef = useRef(0);

  const [nodes, setNodes] = useState<Node[]>([]); // receivers
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  const pulses = useSharedValue<Pulse[]>([]);
  const pulseBufRef = useRef<Pulse[]>([]);
  const fxRef = useRef<Map<number, Fx>>(new Map()); // projectile fx
  const registerFx = useCallback((id: number, fx: Fx) => {
    fxRef.current.set(id, fx);
  }, []);
  const unregisterFx = useCallback((id: number) => {
    fxRef.current.delete(id);
  }, []);
  const rxFxRef = useRef<Map<number, RxFx>>(new Map()); // receiver fx
  const registerRxFx = useCallback((id: number, fx: RxFx) => {
    rxFxRef.current.set(id, fx);
  }, []);
  const unregisterRxFx = useCallback((id: number) => {
    rxFxRef.current.delete(id);
  }, []);

  // Strike a receiver: sound its note, flash it, shed a ripple at its spot.
  const fireReceiver = useCallback(
    (n: Node, nowSec: number) => {
      if (!noteEnabled(n.midi)) return; // muted note: silent, no flash
      playSine(midiToFreq(n.midi));
      pulseBufRef.current.push({ x: n.x, y: n.y, t: nowSec, seed: Math.random() });
      const fx = rxFxRef.current.get(n.id);
      if (fx) {
        fx.pulse.value = 0;
        fx.pulse.value = withSequence(
          withTiming(1, { duration: 60, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: FLASH_MS, easing: Easing.out(Easing.quad) })
        );
      }
    },
    []
  );

  const clearAll = useCallback(() => {
    slungRef.current = [];
    setItems([]);
    setNodes([]);
    pulseBufRef.current = [];
    pulses.value = [];
  }, [pulses]);
  useSettingsActions(
    useMemo(() => [{ id: 'clear', label: 'Clear', danger: true, onPress: clearAll }], [clearAll])
  );

  // Physics + collision-driven receiver firing + ripple publishing, in one loop.
  useEffect(() => {
    if (!live) return;
    const handle = setInterval(() => {
      const nowMs = clock.value;
      const nowSec = nowMs / 1000;
      const xMin = RULER_WIDTH; // bounce off the ruler edge, never under it
      const xMax = widthRef.current - EDGE;
      const yMin = PITCH_TOP;
      const yMax = heightRef.current - PITCH_BOTTOM_INSET;
      const receivers = nodesRef.current;

      for (const b of slungRef.current) {
        if (b.dying) continue;
        b.x += b.vx;
        b.y += b.vy;
        b.vx *= FRICTION;
        b.vy *= FRICTION;
        if (b.x < xMin) {
          b.x = xMin;
          b.vx = -b.vx * BOUNCE;
        } else if (b.x > xMax) {
          b.x = xMax;
          b.vx = -b.vx * BOUNCE;
        }
        if (b.y < yMin) {
          b.y = yMin;
          b.vy = -b.vy * BOUNCE;
        } else if (b.y > yMax) {
          b.y = yMax;
          b.vy = -b.vy * BOUNCE;
        }

        // Collision: strike a receiver on ENTRY (once per pass); re-arm on exit so
        // a body that bounces back through it can strike again.
        const fx = fxRef.current.get(b.id);
        for (const r of receivers) {
          const near = Math.hypot(b.x - r.x, b.y - r.y) <= COLLIDE_R;
          if (near && !b.inside.has(r.id)) {
            b.inside.add(r.id);
            fireReceiver(r, nowSec);
            if (fx) {
              fx.pulse.value = 0;
              fx.pulse.value = withSequence(
                withTiming(1, { duration: 50, easing: Easing.out(Easing.quad) }),
                withTiming(0, { duration: 240, easing: Easing.out(Easing.quad) })
              );
            }
          } else if (!near && b.inside.has(r.id)) {
            b.inside.delete(r.id);
          }
        }

        const speed = Math.hypot(b.vx, b.vy);
        if (fx) {
          fx.x.value = b.x;
          fx.y.value = b.y;
          fx.op.value = Math.min(1, speed / FADE_REF);
        }
        if (speed < DEATH_SPEED) {
          b.dying = true;
          if (fx) fx.op.value = withTiming(0, { duration: 250 });
          const id = b.id;
          setTimeout(() => {
            slungRef.current = slungRef.current.filter((s) => s.id !== id);
            setItems((prev) => prev.filter((it) => it.id !== id));
          }, 280);
        }
      }

      // publish ripple buffer once per tick
      let buf = pulseBufRef.current.filter((p) => nowSec - p.t <= LIFE);
      if (buf.length > PULSES) buf = buf.slice(buf.length - PULSES);
      pulseBufRef.current = buf;
      pulses.value = buf;
    }, SCHED_MS);
    return () => {
      clearInterval(handle);
      pulseBufRef.current = [];
      pulses.value = [];
    };
  }, [live, clock, pulses, fireReceiver]);

  // Re-pitch receivers when the scale or field height changes.
  useEffect(() => {
    setNodes((prev) => prev.map((n) => ({ ...n, midi: midiFromY(n.y, ladder, height) })));
  }, [ladder, height]);

  const launch = (b: Band) => {
    const dx = b.ax - b.fx;
    const dy = b.ay - b.fy;
    const d = Math.hypot(dx, dy);
    if (d < 1e-3) return;
    const speed = LAUNCH_K * Math.pow(d, LAUNCH_EXP);
    const vx = (dx / d) * speed;
    const vy = (dy / d) * speed;
    const id = idRef.current++;
    slungRef.current.push({ id, x: b.fx, y: b.fy, vx, vy, dying: false, inside: new Set() });
    while (slungRef.current.length > MAX_BODIES) slungRef.current.shift();
    setItems(slungRef.current.map((s) => ({ id: s.id, x0: s.x, y0: s.y })));
  };

  // ---- receivers: place / delete / drag ----
  const hitNode = (x: number, y: number): number | null => {
    const ns = nodesRef.current;
    for (let i = ns.length - 1; i >= 0; i--) {
      if (Math.hypot(x - ns[i].x, y - ns[i].y) <= HIT_R) return ns[i].id;
    }
    return null;
  };
  const placeReceiver = (x: number, y: number) => {
    if (x < RULER_WIDTH || nodesRef.current.length >= MAX_NODES) return;
    setNodes((prev) => [
      ...prev,
      { id: idRef.current++, x, y, midi: midiFromY(y, ladderRef.current, heightRef.current) },
    ]);
  };
  // Long-press an empty spot → drop a receiver; long-press a receiver → delete it.
  const onLongPress = (x: number, y: number) => {
    const id = hitNode(x, y);
    if (id != null) setNodes((prev) => prev.filter((n) => n.id !== id));
    else placeReceiver(x, y);
  };

  // A pan grabs a receiver to move it, or (on empty grid) draws the slingshot. The
  // band is only shown once the finger actually moves, so a stationary long-press
  // (to place a receiver) never flashes a slingshot.
  const dragNodeRef = useRef<number | null>(null);
  const onPanBegin = (x: number, y: number) => {
    const id = hitNode(x, y);
    if (id != null) {
      dragNodeRef.current = id;
      bandRef.current = null;
      return;
    }
    dragNodeRef.current = null;
    // Record the anchor but don't render the band until there's real movement.
    bandRef.current = x < RULER_WIDTH ? null : { ax: x, ay: y, fx: x, fy: y };
  };
  const onPanMove = (x: number, y: number) => {
    const id = dragNodeRef.current;
    if (id != null) {
      const cx = Math.max(RULER_WIDTH, x);
      setNodes((prev) =>
        prev.map((n) => (n.id === id ? { ...n, x: cx, y, midi: midiFromY(y, ladderRef.current, heightRef.current) } : n))
      );
      return;
    }
    if (!bandRef.current) return;
    bandRef.current = { ...bandRef.current, fx: x, fy: y };
    setBand(bandRef.current); // first real move reveals the band
  };
  const onPanEnd = () => {
    if (dragNodeRef.current != null) {
      dragNodeRef.current = null;
      return;
    }
    const b = bandRef.current;
    bandRef.current = null;
    setBand(null);
    if (!b) return;
    if (Math.hypot(b.ax - b.fx, b.ay - b.fy) >= MIN_PULL) launch(b);
  };

  const pan = Gesture.Pan()
    .minDistance(6)
    .onBegin((e) => {
      if (!live) return;
      runOnJS(onPanBegin)(e.x, e.y);
    })
    .onUpdate((e) => {
      if (!live) return;
      runOnJS(onPanMove)(e.x, e.y);
    })
    .onFinalize(() => {
      if (!live) return;
      runOnJS(onPanEnd)();
    });
  const longPress = Gesture.LongPress()
    .minDuration(350)
    .onStart((e) => {
      if (!live) return;
      runOnJS(onLongPress)(e.x, e.y);
    });
  const gesture = Gesture.Race(pan, longPress);

  const bandPath = useMemo(() => {
    const p = Skia.Path.Make();
    if (band) {
      p.moveTo(band.ax, band.ay);
      p.lineTo(band.fx, band.fy);
    }
    return p;
  }, [band]);

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
              <ReceiverView key={n.id} node={n} register={registerRxFx} unregister={unregisterRxFx} />
            ))}
            {items.map((it) => (
              <SlungBody key={it.id} item={it} register={registerFx} unregister={unregisterFx} />
            ))}
            {band ? (
              <Group>
                <Path path={bandPath} style="stroke" strokeWidth={1.5} color="rgba(255,255,255,0.4)" />
                <Circle cx={band.fx} cy={band.fy} r={PROJ_R} color="white" opacity={0.85} />
                <Circle cx={band.ax} cy={band.ay} r={3} color="rgba(255,255,255,0.6)" />
              </Group>
            ) : null}
          </Canvas>
        </View>
      </GestureDetector>

      <PitchRuler ladder={ladder} height={height} />
    </View>
  );
}

// A receiver: a hollow ring that fills with a bright flash when a body strikes it.
function ReceiverView({
  node,
  register,
  unregister,
}: {
  node: Node;
  register: (id: number, fx: RxFx) => void;
  unregister: (id: number) => void;
}) {
  const pulse = useSharedValue(0);
  useEffect(() => {
    register(node.id, { pulse });
    return () => unregister(node.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  const transform = useDerivedValue(() => [{ scale: 1 + 0.16 * pulse.value }]);
  const bloom = useDerivedValue(() => 0.5 * pulse.value);
  const core = useDerivedValue(() => 0.75 * pulse.value);

  return (
    <Group transform={transform} origin={{ x: node.x, y: node.y }}>
      <Circle cx={node.x} cy={node.y} r={NODE_R * 1.15} color="white" opacity={bloom}>
        <Blur blur={NODE_R * 0.5} />
      </Circle>
      <Circle cx={node.x} cy={node.y} r={NODE_R} color="white" opacity={core} />
      <Circle cx={node.x} cy={node.y} r={NODE_R} style="stroke" strokeWidth={2} color="white" opacity={0.4} />
    </Group>
  );
}

// A flying projectile: a soft-blooming white dot whose position/opacity are
// driven by the physics loop through shared values.
function SlungBody({
  item,
  register,
  unregister,
}: {
  item: Item;
  register: (id: number, fx: Fx) => void;
  unregister: (id: number) => void;
}) {
  const x = useSharedValue(item.x0);
  const y = useSharedValue(item.y0);
  const op = useSharedValue(1);
  const pulse = useSharedValue(0);
  useEffect(() => {
    register(item.id, { x, y, op, pulse });
    return () => unregister(item.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  const pos = useDerivedValue(() => ({ x: x.value, y: y.value }));
  const r = useDerivedValue(() => PROJ_R * (0.85 + 0.4 * pulse.value));
  const coreOp = useDerivedValue(() => op.value * (0.6 + 0.4 * pulse.value));
  const bloomOp = useDerivedValue(() => op.value * (0.15 + 0.4 * pulse.value));

  return (
    <Group>
      <Circle c={pos} r={PROJ_R * 1.7} color="white" opacity={bloomOp}>
        <Blur blur={PROJ_R} />
      </Circle>
      <Circle c={pos} r={r} color="white" opacity={coreOp} />
    </Group>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
});
