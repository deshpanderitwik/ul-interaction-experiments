import {
  Canvas,
  Circle,
  Fill,
  Line,
  RadialGradient,
  vec,
} from '@shopify/react-native-skia';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { LayoutRectangle, Pressable, StyleSheet, Text, View } from 'react-native';
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

// ── Thought experiment ───────────────────────────────────────────────────────
// The real version of this idea — "cluster my contacts by how many texts I've
// sent them" — can't read iMessage/SMS on iOS (no public API). So this is the
// concept on *fake* data: a generated roster, each person with a SIMULATED text
// count. People you "text" most sit closest to the center "you" node; the rest
// drift outward. No contacts permission, no real data, pure JS → ships OTA.
//
// Flick a node to feel it spring back to its count-determined orbit; tap one to
// read it out; Shuffle to roll a fresh roster.

const COUNT = 60; // fake contacts on screen
const GOLDEN = Math.PI * (3 - Math.sqrt(5)); // even radial spread
const DOT_MIN = 11;
const DOT_MAX = 26; // node radius scales with text volume
const NODE_W = 86;
const NODE_H = 60;
const STIFF = 130;
const DAMP = 13;
const SEP = 62; // declutter spacing
const REPULSE = 900;

const FIRST = [
  'Maya', 'Leo', 'Aria', 'Noah', 'Zoe', 'Kai', 'Emma', 'Liam', 'Ivy', 'Omar',
  'Nina', 'Jonas', 'Priya', 'Mateo', 'Lena', 'Theo', 'Sana', 'Felix', 'Ada',
  'Ravi', 'Mira', 'Hugo', 'Yara', 'Dane', 'Cleo', 'Ezra', 'Nora', 'Iris',
  'Sam', 'Tess', 'Beau', 'Juno', 'Remy', 'Vera', 'Otis', 'Wren', 'Cass',
  'Dion', 'Esme', 'Finn', 'Gemma', 'Hana', 'Ines', 'Jude', 'Kira', 'Luca',
  'Mona', 'Niko', 'Opal', 'Pax', 'Rhea', 'Soren', 'Tara', 'Uma', 'Vince',
  'Wade', 'Xena', 'Yves', 'Zane', 'Bea',
];
const LASTI = 'ABCDEFGHJKLMNPRSTVW';
const PALETTE = [
  '#6c5ce7', '#00d2a8', '#3b5bff', '#ff7a00',
  '#ff2d6b', '#b14bff', '#21d4fd', '#ffd23f',
];

type Person = {
  id: string;
  name: string;
  count: number; // simulated texts sent
  closeness: number; // 0 (far) … 1 (center), normalized across the roster
};
type GNode = { x: number; y: number; vx: number; vy: number; angle: number; dragging: boolean };

function clamp(v: number, lo: number, hi: number) {
  'worklet';
  return Math.min(hi, Math.max(lo, v));
}

function initials(name: string) {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase();
}

function buzz(light: boolean) {
  try {
    if (light) Haptics.selectionAsync();
    else Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } catch {
    // best-effort
  }
}

// A skewed roster: a few people you text constantly, a long tail you barely do.
function makeRoster(): Person[] {
  const used = new Set<string>();
  const raw = Array.from({ length: COUNT }, () => {
    let name = '';
    do {
      const f = FIRST[Math.floor(Math.random() * FIRST.length)];
      const l = LASTI[Math.floor(Math.random() * LASTI.length)];
      name = `${f} ${l}.`;
    } while (used.has(name));
    used.add(name);
    // power-law-ish: random^2.4 → many small counts, a handful of big ones
    const count = Math.round(2 + Math.pow(Math.random(), 2.4) * 480);
    return { name, count };
  });
  const max = Math.max(...raw.map((r) => r.count));
  const min = Math.min(...raw.map((r) => r.count));
  const span = Math.max(1, max - min);
  return raw.map((r, i) => ({
    id: `${i}-${r.name}`,
    name: r.name,
    count: r.count,
    closeness: (r.count - min) / span,
  }));
}

// One contact: size & line brightness scale with simulated volume. Flick it and
// it springs back to its orbit; tap it to read it out.
function NodeView({
  i,
  person,
  color,
  selected,
  nodes,
  tick,
  onTap,
}: {
  i: number;
  person: Person;
  color: string;
  selected: boolean;
  nodes: SharedValue<GNode[]>;
  tick: SharedValue<number>;
  onTap: (i: number) => void;
}) {
  const r = DOT_MIN + person.closeness * (DOT_MAX - DOT_MIN);
  const style = useAnimatedStyle(() => {
    tick.value;
    const n = nodes.value[i];
    return {
      transform: [
        { translateX: n.x - NODE_W / 2 },
        { translateY: n.y - NODE_H / 2 },
        { scale: n.dragging ? 1.16 : 1 },
      ],
      zIndex: n.dragging || selected ? 10 : 1,
    };
  });

  const pan = Gesture.Pan()
    .onBegin(() => {
      nodes.value[i].dragging = true;
      runOnJS(buzz)(false);
    })
    .onChange((e) => {
      const n = nodes.value[i];
      n.x += e.changeX;
      n.y += e.changeY;
      n.vx = 0;
      n.vy = 0;
    })
    .onFinalize(() => {
      // closeness is fixed by text count, so just let it spring home
      nodes.value[i].dragging = false;
    });

  const press = Gesture.Tap()
    .maxDistance(10)
    .onStart(() => {
      runOnJS(onTap)(i);
      runOnJS(buzz)(true);
    });

  return (
    <GestureDetector gesture={Gesture.Race(press, pan)}>
      <Animated.View style={[styles.node, style]}>
        <View
          style={[
            styles.dot,
            {
              width: r * 2,
              height: r * 2,
              borderRadius: r,
              backgroundColor: color,
              shadowColor: color,
              borderWidth: selected ? 2 : 0,
            },
          ]}
        >
          <Text style={styles.initials}>{initials(person.name)}</Text>
        </View>
        <Text numberOfLines={1} style={styles.label}>
          {person.name}
        </Text>
      </Animated.View>
    </GestureDetector>
  );
}

// A spoke from "you" to a contact — brighter the more you text them.
function NodeLine({
  i,
  closeness,
  nodes,
  tick,
  geom,
}: {
  i: number;
  closeness: number;
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
  return (
    <Line
      p1={p1}
      p2={p2}
      color="#8a7dff"
      strokeWidth={1.25}
      opacity={0.05 + closeness * 0.55}
    />
  );
}

function ContactGraph() {
  const [people, setPeople] = useState<Person[]>(makeRoster);
  const [box, setBox] = useState<LayoutRectangle | null>(null);
  const [built, setBuilt] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const builtRef = useRef(false);

  const nodes = useSharedValue<GNode[]>([]);
  const tick = useSharedValue(0);
  const geom = useSharedValue({ cx: 0, cy: 0, rMin: 0, rMax: 0 });
  const center = useDerivedValue(() => vec(geom.value.cx, geom.value.cy));

  // (re)build the layout when the roster changes or the canvas is first sized
  useEffect(() => {
    if (!box || people.length === 0 || builtRef.current) return;
    const cx = box.width / 2;
    const cy = box.height / 2;
    const rMin = DOT_MAX + 28;
    const rMax = Math.max(rMin + 40, Math.min(box.width, box.height) / 2 - 46);
    geom.value = { cx, cy, rMin, rMax };

    nodes.value = people.map((p, i) => {
      const angle = i * GOLDEN;
      const rad = rMin + (1 - p.closeness) * (rMax - rMin);
      return {
        x: cx + Math.cos(angle) * rad,
        y: cy + Math.sin(angle) * rad,
        vx: 0,
        vy: 0,
        angle,
        dragging: false,
      };
    });
    builtRef.current = true;
    setBuilt(true);
  }, [box, people, geom, nodes]);

  // force loop: spring each node to its count-determined orbit + declutter
  useFrameCallback((frame) => {
    'worklet';
    const list = nodes.value;
    const n = list.length;
    if (n === 0) return;
    const dt = clamp((frame.timeSincePreviousFrame ?? 16) / 1000, 0, 0.05);
    const { cx, cy, rMin, rMax } = geom.value;

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
          if (!a.dragging) { a.vx += fx; a.vy += fy; }
          if (!b.dragging) { b.vx -= fx; b.vy -= fy; }
        }
      }
    }

    for (let i = 0; i < n; i++) {
      const node = list[i];
      if (node.dragging) continue;
      const rad = rMin + (1 - people[i].closeness) * (rMax - rMin);
      const tx = cx + Math.cos(node.angle) * rad;
      const ty = cy + Math.sin(node.angle) * rad;
      node.vx += ((tx - node.x) * STIFF - node.vx * DAMP) * dt;
      node.vy += ((ty - node.y) * STIFF - node.vy * DAMP) * dt;
      node.x += node.vx * dt;
      node.y += node.vy * dt;
    }
    tick.value = tick.value + 1;
  });

  function shuffle() {
    builtRef.current = false;
    setBuilt(false);
    setSelected(null);
    setPeople(makeRoster());
    buzz(false);
  }

  const sel = selected != null ? people[selected] : null;

  return (
    <View style={styles.fill} onLayout={(e) => setBox(e.nativeEvent.layout)}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Fill color="#050509" />
        <Circle c={center} r={120} opacity={0.5}>
          <RadialGradient c={center} r={120} colors={['#6c5ce755', '#6c5ce700']} />
        </Circle>
        {built &&
          people.map((p, i) => (
            <NodeLine key={p.id} i={i} closeness={p.closeness} nodes={nodes} tick={tick} geom={geom} />
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
              selected={selected === i}
              nodes={nodes}
              tick={tick}
              onTap={setSelected}
            />
          ))}
        <View
          pointerEvents="none"
          style={[
            styles.you,
            { left: (box?.width ?? 0) / 2 - 30, top: (box?.height ?? 0) / 2 - 30 },
          ]}
        >
          <Text style={styles.youText}>You</Text>
        </View>
      </View>

      <View style={styles.bar} pointerEvents="box-none">
        <Text style={styles.barText} numberOfLines={1}>
          {sel
            ? `${sel.name} · ${sel.count} texts (simulated)`
            : `${people.length} fake contacts · clustered by simulated texts`}
        </Text>
        <Pressable style={styles.btn} onPress={shuffle}>
          <Text style={styles.btnText}>Shuffle</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#050509' },
  node: { position: 'absolute', width: NODE_W, height: NODE_H, alignItems: 'center' },
  dot: {
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: '#fff',
    shadowOpacity: 0.7,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  initials: { color: '#fff', fontSize: 12, fontWeight: '700' },
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
  barText: { color: '#8a8a9e', fontSize: 12, flexShrink: 1 },
  btn: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  btnText: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '600' },
});

const sketch: Sketch = {
  id: 'contact-graph',
  title: 'Contact graph',
  description:
    'Thought experiment: fake contacts clustered by simulated texts sent — closer = more. No real data, pure JS.',
  order: 80,
  Component: ContactGraph,
};

export default sketch;
