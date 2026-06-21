import {
  Canvas,
  Circle,
  Fill,
  Line,
  RadialGradient,
  vec,
} from '@shopify/react-native-skia';
import * as Contacts from 'expo-contacts';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  LayoutRectangle,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import type { Sketch } from './types';

// ── Premise ────────────────────────────────────────────────────────────────
// "Cluster people by how many texts I've sent them" is impossible on iOS — no
// public API exposes iMessage/SMS history to a third-party app. So *you* place
// people instead: tap a node to pull it inward (closer = you interact more),
// or drag it anywhere and release to set its distance by hand. Closeness ↔
// distance from the center "you" node. Contacts are read live on-device, held
// only in memory, and never written to disk or sent anywhere.

const NODE_CAP = 80; // keep the force sim smooth; bigger phones can take more
const GOLDEN = Math.PI * (3 - Math.sqrt(5)); // ~2.39996 rad — even radial spread
const DOT_R = 19; // node circle radius
const NODE_W = 86; // node hit/label box
const NODE_H = 60;
const STIFF = 130; // radial spring stiffness
const DAMP = 13; // spring damping
const SEP = 64; // min center-to-center spacing before nodes push apart
const REPULSE = 900; // declutter strength

const PALETTE = [
  '#6c5ce7',
  '#00d2a8',
  '#3b5bff',
  '#ff7a00',
  '#ff2d6b',
  '#b14bff',
  '#21d4fd',
  '#ffd23f',
];

type Person = { id: string; name: string };
type GNode = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number; // slot on the ring
  closeness: number; // 0 (far) … 1 (center)
  dragging: boolean;
};
type Phase = 'idle' | 'loading' | 'denied' | 'unavailable' | 'ready';

function clamp(v: number, lo: number, hi: number) {
  'worklet';
  return Math.min(hi, Math.max(lo, v));
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '');
}

function tap(light: boolean) {
  try {
    if (light) Haptics.selectionAsync();
    else Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } catch {
    // haptics are best-effort
  }
}

// ── A single contact: tap to pull closer, drag to place by hand ──────────────
function NodeView({
  i,
  person,
  color,
  nodes,
  tick,
  geom,
}: {
  i: number;
  person: Person;
  color: string;
  nodes: SharedValue<GNode[]>;
  tick: SharedValue<number>;
  geom: SharedValue<{ cx: number; cy: number; rMin: number; rMax: number }>;
}) {
  const style = useAnimatedStyle(() => {
    tick.value; // recompute every sim frame
    const n = nodes.value[i];
    return {
      transform: [
        { translateX: n.x - NODE_W / 2 },
        { translateY: n.y - NODE_H / 2 },
        { scale: n.dragging ? 1.18 : 1 },
      ],
      zIndex: n.dragging ? 10 : 1,
    };
  });

  const pan = Gesture.Pan()
    .onBegin(() => {
      nodes.value[i].dragging = true;
      runOnJS(tap)(false);
    })
    .onChange((e) => {
      const n = nodes.value[i];
      n.x += e.changeX;
      n.y += e.changeY;
      n.vx = 0;
      n.vy = 0;
    })
    .onFinalize(() => {
      const n = nodes.value[i];
      const { cx, cy, rMin, rMax } = geom.value;
      const dist = Math.hypot(n.x - cx, n.y - cy);
      // where you dropped it becomes its closeness + its ring slot
      n.closeness = clamp(1 - (dist - rMin) / (rMax - rMin), 0, 1);
      n.angle = Math.atan2(n.y - cy, n.x - cx);
      n.dragging = false;
    });

  const press = Gesture.Tap()
    .maxDistance(10)
    .onStart(() => {
      const n = nodes.value[i];
      n.closeness = clamp(n.closeness + 0.18, 0, 1);
      runOnJS(tap)(true);
    });

  return (
    <GestureDetector gesture={Gesture.Race(press, pan)}>
      <Animated.View style={[styles.node, style]}>
        <View style={[styles.dot, { backgroundColor: color, shadowColor: color }]}>
          <Text style={styles.initials}>{initials(person.name).toUpperCase()}</Text>
        </View>
        <Text numberOfLines={1} style={styles.label}>
          {person.name}
        </Text>
      </Animated.View>
    </GestureDetector>
  );
}

// One spoke from the center to a node — brighter the closer the person sits.
function NodeLine({
  i,
  nodes,
  tick,
  geom,
}: {
  i: number;
  nodes: SharedValue<GNode[]>;
  tick: SharedValue<number>;
  geom: SharedValue<{ cx: number; cy: number; rMin: number; rMax: number }>;
}) {
  const p1 = useDerivedValue(() => vec(geom.value.cx, geom.value.cy));
  const p2 = useDerivedValue(() => {
    tick.value;
    const n = nodes.value[i];
    return vec(n.x, n.y);
  });
  const opacity = useDerivedValue(() => {
    tick.value;
    return 0.06 + nodes.value[i].closeness * 0.5;
  });
  return <Line p1={p1} p2={p2} color="#8a7dff" strokeWidth={1.25} opacity={opacity} />;
}

function ContactGraph() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [people, setPeople] = useState<Person[]>([]);
  const [total, setTotal] = useState(0);
  const [box, setBox] = useState<LayoutRectangle | null>(null);
  const [built, setBuilt] = useState(false);
  const builtRef = useRef(false);

  const nodes = useSharedValue<GNode[]>([]);
  const tick = useSharedValue(0);
  const geom = useSharedValue({ cx: 0, cy: 0, rMin: 0, rMax: 0 });

  const center = useDerivedValue(() => vec(geom.value.cx, geom.value.cy));

  async function load() {
    setPhase('loading');
    builtRef.current = false;
    setBuilt(false);
    try {
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== 'granted') {
        setPhase('denied');
        return;
      }
      const { data } = await Contacts.getContactsAsync({ fields: [Contacts.Fields.Name] });
      const named: Person[] = data
        .map((c, idx) => ({ id: c.id ?? String(idx), name: (c.name ?? '').trim() }))
        .filter((p) => p.name.length > 0);
      setTotal(named.length);
      setPeople(named.slice(0, NODE_CAP));
      setPhase('ready');
    } catch {
      // expo-contacts native module isn't in this build (OTA-only install)
      setPhase('unavailable');
    }
  }

  // Build the node layout once we know both the canvas size and the people.
  useEffect(() => {
    if (phase !== 'ready' || !box || people.length === 0 || builtRef.current) return;
    const cx = box.width / 2;
    const cy = box.height / 2;
    const rMin = DOT_R + 34;
    const rMax = Math.max(rMin + 40, Math.min(box.width, box.height) / 2 - 46);
    geom.value = { cx, cy, rMin, rMax };

    nodes.value = people.map((_, i) => {
      const angle = i * GOLDEN;
      const r = rMin + (rMax - rMin) * 0.5; // everyone starts neutral (mid-ring)
      return {
        x: cx + Math.cos(angle) * r,
        y: cy + Math.sin(angle) * r,
        vx: 0,
        vy: 0,
        angle,
        closeness: 0.5,
        dragging: false,
      };
    });
    builtRef.current = true;
    setBuilt(true);
  }, [phase, box, people, geom, nodes]);

  // Force loop: radial spring toward each node's closeness ring + light mutual
  // repulsion so labels don't stack. Dragged nodes follow the finger untouched.
  useFrameCallback((frame) => {
    'worklet';
    const list = nodes.value;
    const n = list.length;
    if (n === 0) return;
    const dt = clamp((frame.timeSincePreviousFrame ?? 16) / 1000, 0, 0.05);
    const { cx, cy, rMin, rMax } = geom.value;

    // declutter: push apart any two nodes sitting too close
    for (let i = 0; i < n; i++) {
      const a = list[i];
      for (let j = i + 1; j < n; j++) {
        const b = list[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d = Math.hypot(dx, dy) || 0.01;
        if (d < SEP) {
          const f = (REPULSE * (SEP - d)) / (d * SEP);
          const fx = dx * f * dt;
          const fy = dy * f * dt;
          if (!a.dragging) {
            a.vx += fx;
            a.vy += fy;
          }
          if (!b.dragging) {
            b.vx -= fx;
            b.vy -= fy;
          }
        }
      }
    }

    for (let i = 0; i < n; i++) {
      const node = list[i];
      if (node.dragging) continue;
      const r = rMin + (1 - node.closeness) * (rMax - rMin);
      const tx = cx + Math.cos(node.angle) * r;
      const ty = cy + Math.sin(node.angle) * r;
      node.vx += ((tx - node.x) * STIFF - node.vx * DAMP) * dt;
      node.vy += ((ty - node.y) * STIFF - node.vy * DAMP) * dt;
      node.x += node.vx * dt;
      node.y += node.vy * dt;
    }
    tick.value = tick.value + 1;
  });

  function reset() {
    const list = nodes.value;
    for (let i = 0; i < list.length; i++) list[i].closeness = 0.5;
    tap(true);
  }

  // ── non-graph states ───────────────────────────────────────────────────────
  if (phase === 'idle' || phase === 'denied' || phase === 'unavailable') {
    const denied = phase === 'denied';
    const unavailable = phase === 'unavailable';
    return (
      <View style={styles.center}>
        <Text style={styles.h1}>Contact graph</Text>
        <Text style={styles.body}>
          {unavailable
            ? 'This sketch needs the contacts native module, which isn’t in the installed build yet. It ships only with a native rebuild (eas build), not an over-the-air update.'
            : denied
              ? 'Contacts permission was declined. Grant it in Settings → Privacy → Contacts, then try again. Names are read on-device only and never leave your phone.'
              : 'Map your contacts as a graph. Tap a person to pull them closer to you; drag anyone out to push them away. Nothing is uploaded or saved — names live only in memory while this screen is open.'}
        </Text>
        {!unavailable && (
          <Pressable style={styles.cta} onPress={load}>
            <Text style={styles.ctaText}>{denied ? 'Try again' : 'Map my contacts'}</Text>
          </Pressable>
        )}
      </View>
    );
  }

  if (phase === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#8a7dff" />
        <Text style={[styles.body, { marginTop: 16 }]}>Reading contacts…</Text>
      </View>
    );
  }

  // ── the graph ────────────────────────────────────────────────────────────
  return (
    <View style={styles.fill} onLayout={(e) => setBox(e.nativeEvent.layout)}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Fill color="#050509" />
        <Circle c={center} r={120} opacity={0.5}>
          <RadialGradient
            c={center}
            r={120}
            colors={['#6c5ce755', '#6c5ce700']}
          />
        </Circle>
        {built &&
          people.map((_, i) => (
            <NodeLine key={i} i={i} nodes={nodes} tick={tick} geom={geom} />
          ))}
      </Canvas>

      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {built &&
          people.map((p, i) => (
            <NodeView
              key={p.id}
              i={i}
              person={p}
              color={PALETTE[i % PALETTE.length]}
              nodes={nodes}
              tick={tick}
              geom={geom}
            />
          ))}
        {/* the fixed "you" anchor at the center */}
        <View pointerEvents="none" style={[styles.you, { left: (box?.width ?? 0) / 2 - 30, top: (box?.height ?? 0) / 2 - 30 }]}>
          <Text style={styles.youText}>You</Text>
        </View>
      </View>

      <View style={styles.bar} pointerEvents="box-none">
        <Text style={styles.barText}>
          {total > NODE_CAP ? `${NODE_CAP} of ${total}` : `${people.length}`} contacts · tap to pull
          closer, drag to place
        </Text>
        <Pressable style={styles.reset} onPress={reset}>
          <Text style={styles.resetText}>Reset</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#050509' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    backgroundColor: '#050509',
  },
  h1: { color: '#fff', fontSize: 24, fontWeight: '700', marginBottom: 14 },
  body: {
    color: 'rgba(255,255,255,0.62)',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  cta: {
    marginTop: 28,
    backgroundColor: '#6c5ce7',
    paddingHorizontal: 26,
    paddingVertical: 14,
    borderRadius: 16,
  },
  ctaText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  node: {
    position: 'absolute',
    width: NODE_W,
    height: NODE_H,
    alignItems: 'center',
  },
  dot: {
    width: DOT_R * 2,
    height: DOT_R * 2,
    borderRadius: DOT_R,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.7,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  initials: { color: '#fff', fontSize: 14, fontWeight: '700' },
  label: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 11,
    marginTop: 4,
    maxWidth: NODE_W,
    textAlign: 'center',
  },
  you: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  youText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 16,
  },
  barText: { color: '#6a6a7e', fontSize: 12, flexShrink: 1 },
  reset: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  resetText: { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '600' },
});

const sketch: Sketch = {
  id: 'contact-graph',
  title: 'Contact graph',
  description:
    'Your contacts as a force graph — tap to pull people closer, drag to place. Read on-device only, never uploaded.',
  order: 80,
  Component: ContactGraph,
};

export default sketch;
