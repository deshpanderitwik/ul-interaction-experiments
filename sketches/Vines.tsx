import {
  BlurMask,
  Canvas,
  Fill,
  Path,
  Skia,
  useClock,
} from '@shopify/react-native-skia';
import * as Haptics from 'expo-haptics';
import { StyleSheet, Text, View } from 'react-native';
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

// ── Instrument · Series "Performative image-making" · #2 ─────────────────────
// Vines. Your drag is recorded as a spine; from it, tendrils sprout, curl, and
// keep growing after you lift — each tendril branching into finer ones, so a
// single gesture blooms into a vine-like structure. The picture is the residue
// of a living growth, not placed pixels: you plant a line, the garden grows.
// Drag to plant · double-tap to clear. One branch pool (no allocation in the
// frame loop). Pure JS over Skia + Reanimated → ships OTA, no native rebuild.

const POOL = 180; // max branches alive at once
const MAXPTS = 64; // points stored per branch
const ACCUM = 6; // px between recorded points on a growing tendril
const GROW_SPEED = 200; // tendril growth speed (px/s)
const MAXDEPTH = 3; // how many times a tendril may sub-branch
const SPINE_MIN = 8; // px between recorded finger points on the spine
const SPROUT_EVERY = 3; // sprout a tendril every Nth spine point

// Vine greens, indexed by depth: deep stem → bright young tips.
const COL = ['#1f9e6b', '#28c878', '#5cf08a', '#b6ffb0'];
const WIDTH = [6, 3.4, 2.1, 1.3];

type Pt = { x: number; y: number };
type Branch = {
  active: number; // 0 | 1
  depth: number; // 0 = finger-drawn spine, >=1 = sprouted tendril
  ang: number; // heading (radians)
  curl: number; // signed curl per px → spiral
  grow: number; // length left to grow (0 once finished)
  spawnAt: number; // grow-threshold at which it spawns a child (0 = none)
  hx: number; // live head (between recorded points)
  hy: number;
  n: number; // recorded points used
  pts: Pt[]; // length MAXPTS
};

function makePool(): Branch[] {
  return Array.from({ length: POOL }, () => ({
    active: 0,
    depth: 0,
    ang: 0,
    curl: 0,
    grow: 0,
    spawnAt: 0,
    hx: 0,
    hy: 0,
    n: 0,
    pts: Array.from({ length: MAXPTS }, () => ({ x: 0, y: 0 })),
  }));
}

function clampw(v: number, lo: number, hi: number) {
  'worklet';
  return Math.min(hi, Math.max(lo, v));
}

function freeSlot(pool: Branch[]) {
  'worklet';
  for (let i = 0; i < pool.length; i++) if (pool[i].active === 0) return i;
  return -1;
}

// Plant a finger-driven spine; returns its slot (or -1 if the garden is full).
function startSpine(pool: Branch[], x: number, y: number) {
  'worklet';
  const s = freeSlot(pool);
  if (s < 0) return -1;
  const b = pool[s];
  b.active = 1;
  b.depth = 0;
  b.ang = 0;
  b.curl = 0;
  b.grow = 0;
  b.spawnAt = 0;
  b.hx = x;
  b.hy = y;
  b.n = 1;
  b.pts[0].x = x;
  b.pts[0].y = y;
  return s;
}

// Sprout a self-growing tendril at (x,y) heading `ang`.
function sprout(pool: Branch[], x: number, y: number, ang: number, depth: number) {
  'worklet';
  const s = freeSlot(pool);
  if (s < 0) return -1;
  const b = pool[s];
  const len =
    depth === 1
      ? 70 + Math.random() * 80
      : depth === 2
        ? 45 + Math.random() * 55
        : 26 + Math.random() * 34;
  b.active = 1;
  b.depth = depth;
  b.ang = ang;
  b.curl = (Math.random() < 0.5 ? -1 : 1) * (0.012 + Math.random() * 0.03);
  b.grow = len;
  b.spawnAt = depth < MAXDEPTH ? len * (0.4 + Math.random() * 0.25) : 0;
  b.hx = x;
  b.hy = y;
  b.n = 1;
  b.pts[0].x = x;
  b.pts[0].y = y;
  return s;
}

// One depth tier → glow stroke + bright core over the same per-frame path.
function VineLayer({
  depth,
  branches,
  clock,
}: {
  depth: number;
  branches: SharedValue<Branch[]>;
  clock: SharedValue<number>;
}) {
  const path = useDerivedValue(() => {
    clock.value; // force per-frame recompute (in-place mutation won't)
    const p = Skia.Path.Make();
    const pool = branches.value;
    for (let i = 0; i < pool.length; i++) {
      const b = pool[i];
      if (b.active === 0 || b.depth !== depth || b.n < 1) continue;
      p.moveTo(b.pts[0].x, b.pts[0].y);
      for (let j = 1; j < b.n; j++) p.lineTo(b.pts[j].x, b.pts[j].y);
      if (b.depth !== 0 && b.grow > 0) p.lineTo(b.hx, b.hy); // live tip
    }
    return p;
  });

  const color = COL[depth];
  const w = WIDTH[depth];
  return (
    <>
      <Path
        path={path}
        style="stroke"
        strokeWidth={w * 3.2}
        strokeJoin="round"
        strokeCap="round"
        color={color}
        opacity={0.14}
      >
        <BlurMask blur={8} style="normal" />
      </Path>
      <Path
        path={path}
        style="stroke"
        strokeWidth={w}
        strokeJoin="round"
        strokeCap="round"
        color={color}
        opacity={0.95}
      />
    </>
  );
}

// Glowing buds at the tips of finished deep tendrils (zero-length round-cap dots).
function Buds({
  branches,
  clock,
}: {
  branches: SharedValue<Branch[]>;
  clock: SharedValue<number>;
}) {
  const path = useDerivedValue(() => {
    clock.value;
    const p = Skia.Path.Make();
    const pool = branches.value;
    for (let i = 0; i < pool.length; i++) {
      const b = pool[i];
      if (b.active === 0 || b.depth < 2 || b.grow > 0 || b.n < 1) continue;
      const x = b.pts[b.n - 1].x;
      const y = b.pts[b.n - 1].y;
      p.moveTo(x, y);
      p.lineTo(x + 0.1, y);
    }
    return p;
  });
  return (
    <Path path={path} style="stroke" strokeWidth={5} strokeCap="round" color="#d9ffce" opacity={0.9}>
      <BlurMask blur={3} style="solid" />
    </Path>
  );
}

function Vines() {
  const branches = useSharedValue<Branch[]>(makePool());
  const clock = useClock();

  const activeSpine = useSharedValue(-1);
  const sproutCount = useSharedValue(0);

  const hintOpacity = useSharedValue(1);
  const hintStyle = useAnimatedStyle(() => ({ opacity: hintOpacity.value }));

  // growth loop — advances every sprouted tendril each frame on the UI thread
  useFrameCallback((frame) => {
    'worklet';
    const pool = branches.value;
    const dt = clampw((frame.timeSincePreviousFrame ?? 16) / 1000, 0, 0.05);
    for (let i = 0; i < pool.length; i++) {
      const b = pool[i];
      if (b.active === 0 || b.depth === 0 || b.grow <= 0) continue;

      const step = Math.min(GROW_SPEED * dt, b.grow);
      b.ang += b.curl * step + (Math.random() - 0.5) * 0.04;
      b.hx += Math.cos(b.ang) * step;
      b.hy += Math.sin(b.ang) * step;
      b.grow -= step;

      // commit a point every ACCUM px so the ribbon has resolution
      const last = b.pts[b.n - 1];
      if (Math.hypot(b.hx - last.x, b.hy - last.y) >= ACCUM && b.n < MAXPTS) {
        b.pts[b.n].x = b.hx;
        b.pts[b.n].y = b.hy;
        b.n++;
      }

      // sprout a single child partway along
      if (b.spawnAt > 0 && b.grow <= b.spawnAt) {
        const side = Math.random() < 0.5 ? -1 : 1;
        sprout(pool, b.hx, b.hy, b.ang + side * (0.5 + Math.random() * 0.5), b.depth + 1);
        b.spawnAt = 0;
      }

      // finished: freeze the live head as the final point
      if (b.grow <= 0 && b.n < MAXPTS) {
        b.pts[b.n].x = b.hx;
        b.pts[b.n].y = b.hy;
        b.n++;
      }
    }
  });

  const reset = () => {
    branches.value = makePool();
    activeSpine.value = -1;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  };

  const tick = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };

  const hideHint = () => {
    hintOpacity.value = withTiming(0, { duration: 450 });
  };

  const pan = Gesture.Pan()
    .onBegin((e) => {
      activeSpine.value = startSpine(branches.value, e.x, e.y);
      sproutCount.value = 0;
      runOnJS(hideHint)();
      runOnJS(tick)();
    })
    .onChange((e) => {
      const si = activeSpine.value;
      if (si < 0) return;
      const pool = branches.value;
      const b = pool[si];
      const last = b.pts[b.n - 1];
      const dx = e.x - last.x;
      const dy = e.y - last.y;
      if (Math.hypot(dx, dy) < SPINE_MIN) return;

      if (b.n < MAXPTS) {
        b.pts[b.n].x = e.x;
        b.pts[b.n].y = e.y;
        b.n++;
      }

      // sprout a tendril off the spine, alternating sides
      sproutCount.value += 1;
      if (sproutCount.value % SPROUT_EVERY === 0) {
        const tang = Math.atan2(dy, dx);
        const side = (sproutCount.value / SPROUT_EVERY) % 2 === 0 ? 1 : -1;
        sprout(pool, e.x, e.y, tang + side * (0.6 + Math.random() * 0.5), 1);
      }
    })
    .onFinalize(() => {
      activeSpine.value = -1;
    });

  const clearTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(260)
    .onEnd(() => runOnJS(reset)());

  const gesture = Gesture.Race(pan, clearTap);

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.fill}>
        <Canvas style={StyleSheet.absoluteFill}>
          <Fill color="#04070a" />
          {[0, 1, 2, 3].map((d) => (
            <VineLayer key={d} depth={d} branches={branches} clock={clock} />
          ))}
          <Buds branches={branches} clock={clock} />
        </Canvas>

        <Animated.View style={[styles.hintWrap, hintStyle]} pointerEvents="none">
          <Text style={styles.hint}>Drag to plant a vine · double-tap to clear</Text>
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#04070a' },
  hintWrap: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  hint: { color: 'rgba(255,255,255,0.5)', fontSize: 14 },
});

const sketch: Sketch = {
  id: 'vines',
  title: 'Vines',
  description:
    'Drag to plant a spine; tendrils sprout, curl, and branch into a growing vine. Image-making instrument #2.',
  order: 110,
  Component: Vines,
};

export default sketch;
