import {
  Canvas,
  Circle,
  Fill,
  Line,
  SweepGradient,
  useClock,
  vec,
} from '@shopify/react-native-skia';
import { useEffect, useState } from 'react';
import { LayoutRectangle, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  type SharedValue,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
} from 'react-native-reanimated';
import type { Sketch } from './types';

const BALL = 26; // ball radius
const GRAB = BALL + 44; // how close a touch must land to grab the ball
const POWER = 6; // pull pixels → launch px/s
const MAXV = 3200; // launch speed cap
const RESTITUTION = 0.8; // energy kept on a wall bounce
const DRAG = 0.994; // per-frame air friction
const STOP = 26; // below this speed, the ball settles
const MIN_HIT = 120; // min impact speed to spawn a shockwave

// shockwave pool
const POOL = 7;
const LIFE = 520; // ms a shockwave lives
const BASE_R = 6; // starting ring radius
const MAX_R = 130; // ring radius at end of life
const BASE_SW = 16; // starting stroke width (thins to 1)
const RAINBOW = [
  '#ff004c',
  '#ff7a00',
  '#ffe000',
  '#39ff14',
  '#00e5ff',
  '#3b5bff',
  '#b14bff',
  '#ff004c', // repeat first so the sweep wraps seamlessly
];

type Wave = { x: number; y: number; born: number };

function clamp(v: number, lo: number, hi: number) {
  'worklet';
  return Math.min(hi, Math.max(lo, v));
}

// One pooled ring: an expanding, fading sweep-gradient stroke. Driven by the
// Skia clock so it keeps animating regardless of the physics loop.
function Ring({
  index,
  waves,
  clock,
}: {
  index: number;
  waves: SharedValue<Wave[]>;
  clock: SharedValue<number>;
}) {
  const age = useDerivedValue(() => {
    const wv = waves.value[index];
    if (wv.born < 0) return 2; // inactive (> 1)
    return (clock.value - wv.born) / LIFE;
  });
  const center = useDerivedValue(() => {
    const wv = waves.value[index];
    return vec(wv.x, wv.y);
  });
  const radius = useDerivedValue(
    () => BASE_R + clamp(age.value, 0, 1) * (MAX_R - BASE_R),
  );
  const strokeWidth = useDerivedValue(
    () => 1 + (1 - clamp(age.value, 0, 1)) * BASE_SW,
  );
  const opacity = useDerivedValue(() =>
    age.value >= 1 || age.value < 0 ? 0 : 1 - age.value,
  );

  return (
    <Circle
      c={center}
      r={radius}
      style="stroke"
      strokeWidth={strokeWidth}
      opacity={opacity}
    >
      <SweepGradient c={center} colors={RAINBOW} />
    </Circle>
  );
}

// Brick 3 — rainbow shockwaves. Each wall impact (above MIN_HIT) fires a
// pooled sweep-gradient ring at the contact point that expands and fades.
function SlingshotBloom() {
  const [box, setBox] = useState<LayoutRectangle | null>(null);
  const w = box?.width ?? 0;
  const h = box?.height ?? 0;

  const bx = useSharedValue(0); // ball position
  const by = useSharedValue(0);
  const vx = useSharedValue(0); // velocity
  const vy = useSharedValue(0);
  const ax = useSharedValue(0); // anchor (grab point) while aiming
  const ay = useSharedValue(0);
  const mode = useSharedValue(0); // 0 idle · 1 aiming · 2 flying

  const clock = useClock();
  const waves = useSharedValue<Wave[]>(
    Array.from({ length: POOL }, () => ({ x: 0, y: 0, born: -1 })),
  );
  const nextWave = useSharedValue(0);

  // park the ball at center once we know the canvas size
  useEffect(() => {
    if (box) {
      bx.value = w / 2;
      by.value = h / 2;
    }
  }, [box, w, h, bx, by]);

  // physics loop — runs every frame, but only does work while flying
  useFrameCallback((frame) => {
    'worklet';
    if (mode.value !== 2) return;
    const dt = clamp((frame.timeSincePreviousFrame ?? 16) / 1000, 0, 0.05);

    const spawn = (x: number, y: number) => {
      const i = nextWave.value % POOL;
      nextWave.value = i + 1;
      const wv = waves.value[i];
      wv.x = x;
      wv.y = y;
      wv.born = clock.value;
    };

    vx.value *= DRAG;
    vy.value *= DRAG;
    let nx = bx.value + vx.value * dt;
    let ny = by.value + vy.value * dt;

    if (nx < BALL) {
      nx = BALL;
      if (Math.abs(vx.value) > MIN_HIT) spawn(0, ny);
      vx.value = -vx.value * RESTITUTION;
    } else if (nx > w - BALL) {
      nx = w - BALL;
      if (Math.abs(vx.value) > MIN_HIT) spawn(w, ny);
      vx.value = -vx.value * RESTITUTION;
    }
    if (ny < BALL) {
      ny = BALL;
      if (Math.abs(vy.value) > MIN_HIT) spawn(nx, 0);
      vy.value = -vy.value * RESTITUTION;
    } else if (ny > h - BALL) {
      ny = h - BALL;
      if (Math.abs(vy.value) > MIN_HIT) spawn(nx, h);
      vy.value = -vy.value * RESTITUTION;
    }

    bx.value = nx;
    by.value = ny;

    if (Math.hypot(vx.value, vy.value) < STOP) {
      vx.value = 0;
      vy.value = 0;
      mode.value = 0; // settle
    }
  });

  const pan = Gesture.Pan()
    .onBegin((e) => {
      if (Math.hypot(e.x - bx.value, e.y - by.value) <= GRAB) {
        mode.value = 1;
        vx.value = 0;
        vy.value = 0;
        ax.value = bx.value;
        ay.value = by.value;
      }
    })
    .onChange((e) => {
      if (mode.value !== 1) return;
      bx.value = clamp(e.x, BALL, w - BALL);
      by.value = clamp(e.y, BALL, h - BALL);
    })
    .onFinalize(() => {
      if (mode.value !== 1) return;
      let lvx = (ax.value - bx.value) * POWER;
      let lvy = (ay.value - by.value) * POWER;
      const speed = Math.hypot(lvx, lvy);
      if (speed < STOP) {
        mode.value = 0; // a tap, not a pull
        return;
      }
      if (speed > MAXV) {
        lvx = (lvx / speed) * MAXV;
        lvy = (lvy / speed) * MAXV;
      }
      vx.value = lvx;
      vy.value = lvy;
      mode.value = 2; // fly
    });

  const ballPos = useDerivedValue(() => vec(bx.value, by.value));
  const anchorPos = useDerivedValue(() =>
    mode.value === 1 ? vec(ax.value, ay.value) : vec(bx.value, by.value),
  );
  const aimPos = useDerivedValue(() =>
    mode.value === 1
      ? vec(2 * ax.value - bx.value, 2 * ay.value - by.value)
      : vec(bx.value, by.value),
  );
  const aimOpacity = useDerivedValue(() => (mode.value === 1 ? 1 : 0));

  return (
    <GestureDetector gesture={pan}>
      <View style={styles.fill} onLayout={(e) => setBox(e.nativeEvent.layout)}>
        <Canvas style={StyleSheet.absoluteFill}>
          <Fill color="#0b0b0f" />
          {Array.from({ length: POOL }, (_, i) => (
            <Ring key={i} index={i} waves={waves} clock={clock} />
          ))}
          <Line p1={anchorPos} p2={aimPos} color="#6c5ce755" strokeWidth={2} opacity={aimOpacity} />
          <Line p1={anchorPos} p2={ballPos} color="#8a8a99" strokeWidth={3} opacity={aimOpacity} />
          <Circle c={anchorPos} r={4} color="#3c3c52" opacity={aimOpacity} />
          <Circle c={ballPos} r={BALL} color="#e8e8f0" />
        </Canvas>
        <Text style={styles.hint}>Pull back and release to fire</Text>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  hint: {
    position: 'absolute',
    bottom: 32,
    left: 0,
    right: 0,
    textAlign: 'center',
    color: '#5a5a6b',
    fontSize: 14,
  },
});

const sketch: Sketch = {
  id: 'slingshot-bloom',
  title: 'Slingshot bloom',
  description: 'Pull, release, ricochet — rainbow shockwaves burst where it hits the walls.',
  Component: SlingshotBloom,
};

export default sketch;
