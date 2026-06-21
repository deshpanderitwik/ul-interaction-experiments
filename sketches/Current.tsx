import {
  BlurMask,
  Canvas,
  Fill,
  Path,
  Skia,
  useClock,
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
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import type { Sketch } from './types';

// ── Instrument · Series "Performative image-making" ──────────────────────────
// Flow-field ink. The screen is a vector field (cheap curl-ish noise from a few
// sines). Eighty ink particles ride the field, each dragging a short ribbon, so
// the picture is the *residue of a gesture-driven living system* — you don't
// place pixels, you steer currents. Drag to inject dye at your fingertip with
// the velocity of your stroke; let go and it keeps flowing. Double-tap to clear,
// tap the dot to change palette. Full-screen + auto-fading chrome, so an iOS
// screenshot is a clean artwork and a screen recording is the making-of.
//   Pure JS over Skia + Reanimated → ships OTA, no native rebuild.

const COUNT = 80; // ink particles
const TRAIL = 26; // ribbon length (samples per particle)
const FORCE = 900; // field push (px/s² feel)
const DAMP = 0.92; // per-frame velocity damping → settles to a steady drift
const MAXV = 700; // speed cap (px/s)
const FIELD_SCALE = 0.0032; // spatial frequency of the field
const SWIRL = 1.7; // angular gain of the field

const PALETTES: string[][] = [
  ['#00e5ff', '#3b82ff', '#8a5bff', '#ff4fd8', '#19f0c3'], // ink in water
  ['#ffd23f', '#ff7a00', '#ff2d6b', '#b14bff', '#39ff14'], // neon
  ['#7cffcb', '#5bc0eb', '#9b8cff', '#ff8fb1', '#ffd6a5'], // pastel
];
const NCOL = 5;

type Pt = { x: number; y: number };
type P = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  c: number; // palette / color-bucket index
  age: number; // frames lived
  ttl: number; // frames before respawn
  trail: Pt[];
};

// The flow field: angle (radians) at a point, evolving slowly with time so the
// currents drift. Layered sines stand in for curl noise — no texture, worklet-safe.
function fieldAngle(x: number, y: number, t: number) {
  'worklet';
  const s = FIELD_SCALE;
  return (
    (Math.sin(x * s + t * 0.18) +
      Math.cos(y * s * 1.27 - t * 0.13) +
      Math.sin((x + y) * s * 0.6 + t * 0.09)) *
    SWIRL
  );
}

function clampw(v: number, lo: number, hi: number) {
  'worklet';
  return Math.min(hi, Math.max(lo, v));
}

function seedRoster(w: number, h: number): P[] {
  const arr: P[] = [];
  for (let i = 0; i < COUNT; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    arr.push({
      x,
      y,
      vx: 0,
      vy: 0,
      c: i % NCOL,
      age: Math.random() * 200,
      ttl: 180 + Math.random() * 360,
      trail: [{ x, y }],
    });
  }
  return arr;
}

// One color bucket → a glow stroke + a bright core stroke over the same path,
// rebuilt every frame from its particles' ribbons (neon-ink look, like SwipeTrail).
function InkLayer({
  index,
  color,
  particles,
  clock,
  ready,
}: {
  index: number;
  color: string;
  particles: SharedValue<P[]>;
  clock: SharedValue<number>;
  ready: SharedValue<number>;
}) {
  const path = useDerivedValue(() => {
    clock.value; // force per-frame recompute (in-place mutation won't)
    const p = Skia.Path.Make();
    if (ready.value === 0) return p;
    const list = particles.value;
    for (let i = 0; i < list.length; i++) {
      const pt = list[i];
      if (pt.c !== index) continue;
      const tr = pt.trail;
      if (tr.length < 2) continue;
      p.moveTo(tr[0].x, tr[0].y);
      for (let j = 1; j < tr.length; j++) p.lineTo(tr[j].x, tr[j].y);
    }
    return p;
  });

  return (
    <>
      <Path
        path={path}
        style="stroke"
        strokeWidth={11}
        strokeJoin="round"
        strokeCap="round"
        color={color}
        opacity={0.16}
      >
        <BlurMask blur={9} style="normal" />
      </Path>
      <Path
        path={path}
        style="stroke"
        strokeWidth={2.4}
        strokeJoin="round"
        strokeCap="round"
        color={color}
        opacity={0.9}
      />
    </>
  );
}

function Current() {
  const [box, setBox] = useState<LayoutRectangle | null>(null);
  const w = box?.width ?? 0;
  const h = box?.height ?? 0;
  const sizeRef = useRef({ w: 0, h: 0 });
  sizeRef.current = { w, h };

  const particles = useSharedValue<P[]>([]);
  const ready = useSharedValue(0);
  const clock = useClock();

  // finger + stroke velocity, written on the UI thread by the pan gesture
  const fx = useSharedValue(0);
  const fy = useSharedValue(0);
  const dvx = useSharedValue(0);
  const dvy = useSharedValue(0);
  const dragging = useSharedValue(0);
  const spawnCursor = useSharedValue(0);

  const [paletteIdx, setPaletteIdx] = useState(0);
  const palette = PALETTES[paletteIdx];

  const hintOpacity = useSharedValue(1);
  const hintStyle = useAnimatedStyle(() => ({ opacity: hintOpacity.value }));

  // seed once the canvas is sized
  useEffect(() => {
    if (!box) return;
    particles.value = seedRoster(w, h);
    ready.value = 1;
  }, [box, w, h, particles, ready]);

  // simulation — runs every frame on the UI thread
  useFrameCallback((frame) => {
    'worklet';
    if (ready.value === 0) return;
    const list = particles.value;
    const n = list.length;
    if (n === 0) return;
    const dt = clampw((frame.timeSincePreviousFrame ?? 16) / 1000, 0, 0.05);
    const t = clock.value / 1000;

    // inject dye at the fingertip while dragging — recycle a few particles,
    // launching them with a fraction of the stroke's velocity
    if (dragging.value === 1) {
      for (let k = 0; k < 3; k++) {
        const idx = spawnCursor.value % n;
        spawnCursor.value = idx + 1;
        const p = list[idx];
        p.x = fx.value + (Math.random() - 0.5) * 24;
        p.y = fy.value + (Math.random() - 0.5) * 24;
        p.vx = dvx.value * 0.3 + (Math.random() - 0.5) * 60;
        p.vy = dvy.value * 0.3 + (Math.random() - 0.5) * 60;
        p.age = 0;
        p.ttl = 220 + Math.random() * 300;
        p.trail = [{ x: p.x, y: p.y }];
      }
    }

    for (let i = 0; i < n; i++) {
      const p = list[i];
      const a = fieldAngle(p.x, p.y, t);
      p.vx += Math.cos(a) * FORCE * dt;
      p.vy += Math.sin(a) * FORCE * dt;
      p.vx *= DAMP;
      p.vy *= DAMP;
      const sp = Math.hypot(p.vx, p.vy);
      if (sp > MAXV) {
        p.vx = (p.vx / sp) * MAXV;
        p.vy = (p.vy / sp) * MAXV;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.age += 1;

      const tr = p.trail;
      tr.push({ x: p.x, y: p.y });
      if (tr.length > TRAIL) tr.shift();

      // respawn when spent or off-screen — reset the ribbon so it doesn't streak
      if (p.age > p.ttl || p.x < -20 || p.x > w + 20 || p.y < -20 || p.y > h + 20) {
        const nx = Math.random() * w;
        const ny = Math.random() * h;
        p.x = nx;
        p.y = ny;
        p.vx = 0;
        p.vy = 0;
        p.age = 0;
        p.ttl = 180 + Math.random() * 360;
        p.trail = [{ x: nx, y: ny }];
      }
    }
  });

  const reset = () => {
    const { w: cw, h: ch } = sizeRef.current;
    if (cw === 0 || ch === 0) return;
    particles.value = seedRoster(cw, ch);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  };

  const cyclePalette = () => {
    setPaletteIdx((i) => (i + 1) % PALETTES.length);
    Haptics.selectionAsync().catch(() => {});
  };

  const hideHint = () => {
    hintOpacity.value = withTiming(0, { duration: 450 });
  };

  const pan = Gesture.Pan()
    .onBegin((e) => {
      fx.value = e.x;
      fy.value = e.y;
      dvx.value = 0;
      dvy.value = 0;
      dragging.value = 1;
      runOnJS(hideHint)();
    })
    .onChange((e) => {
      fx.value = e.x;
      fy.value = e.y;
      dvx.value = e.velocityX ?? 0;
      dvy.value = e.velocityY ?? 0;
    })
    .onFinalize(() => {
      dragging.value = 0;
    });

  const clearTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(260)
    .onEnd(() => runOnJS(reset)());

  const gesture = Gesture.Race(pan, clearTap);

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.fill} onLayout={(e) => setBox(e.nativeEvent.layout)}>
        <Canvas style={StyleSheet.absoluteFill}>
          <Fill color="#04050a" />
          {palette.map((c, k) => (
            <InkLayer
              key={k}
              index={k}
              color={c}
              particles={particles}
              clock={clock}
              ready={ready}
            />
          ))}
        </Canvas>

        <Animated.View style={[styles.hintWrap, hintStyle]} pointerEvents="none">
          <Text style={styles.hint}>
            Drag to pour ink · double-tap to clear
          </Text>
        </Animated.View>

        <Pressable
          style={[styles.swatch, { backgroundColor: palette[0] }]}
          onPress={cyclePalette}
          hitSlop={16}
        />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#04050a' },
  hintWrap: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  hint: { color: 'rgba(255,255,255,0.5)', fontSize: 14 },
  swatch: {
    position: 'absolute',
    bottom: 38,
    right: 28,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    opacity: 0.7,
  },
});

const sketch: Sketch = {
  id: 'current',
  title: 'Current',
  description:
    'Flow-field ink: drag to pour dye into a living current and steer the painting. Image-making instrument #1.',
  order: 100,
  Component: Current,
};

export default sketch;
