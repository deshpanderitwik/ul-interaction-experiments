import {
  Canvas,
  Circle,
  Fill,
  Line,
  useClock,
  vec,
} from '@shopify/react-native-skia';
import { useEffect, useState } from 'react';
import { LayoutRectangle, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
} from 'react-native-reanimated';
import { FireBurst } from '../studies/Fireworks';
import { NeonBurst } from '../studies/NeonLaser';
import { PlasmaBurst } from '../studies/Plasma';
import { BloomBurst } from '../studies/SoftBloom';
import { POOL, makeWaves, type Wave } from '../studies/shared';
import type { Sketch } from './types';

const BALL = 26;
const GRAB = BALL + 44;
const POWER = 6;
const MAXV = 3200;
const RESTITUTION = 0.84;
const DRAG = 0.994;
const STOP = 26;
const MIN_HIT = 120;

// the four explosion treatments, swapped live via the chips up top
const TREATMENTS = [
  { key: 'neon', label: 'Neon', Burst: NeonBurst },
  { key: 'bloom', label: 'Bloom', Burst: BloomBurst },
  { key: 'fireworks', label: 'Fireworks', Burst: FireBurst },
  { key: 'plasma', label: 'Plasma', Burst: PlasmaBurst },
] as const;

function clamp(v: number, lo: number, hi: number) {
  'worklet';
  return Math.min(hi, Math.max(lo, v));
}

// Explosion studies — a harness, not a final sketch. Same slingshot physics
// as Slingshot bloom, but the wall-impact burst is rendered by whichever
// study you pick, so you can A/B all four on the exact same hit. Lock a
// winner, then fold it back into SlingshotBloom.
function ExplosionStudies() {
  const [box, setBox] = useState<LayoutRectangle | null>(null);
  const [pick, setPick] = useState(0);
  const w = box?.width ?? 0;
  const h = box?.height ?? 0;

  const bx = useSharedValue(0);
  const by = useSharedValue(0);
  const vx = useSharedValue(0);
  const vy = useSharedValue(0);
  const ax = useSharedValue(0);
  const ay = useSharedValue(0);
  const mode = useSharedValue(0); // 0 idle · 1 aiming · 2 flying

  const clock = useClock();
  const waves = useSharedValue<Wave[]>(makeWaves());
  const nextWave = useSharedValue(0);

  useEffect(() => {
    if (box) {
      bx.value = w / 2;
      by.value = h / 2;
    }
  }, [box, w, h, bx, by]);

  useFrameCallback((frame) => {
    'worklet';
    if (mode.value !== 2) return;
    const dt = clamp((frame.timeSincePreviousFrame ?? 16) / 1000, 0, 0.05);

    const spawn = (x: number, y: number, nx: number, ny: number, speed: number) => {
      const i = nextWave.value % POOL;
      nextWave.value = i + 1;
      const wv = waves.value[i];
      wv.x = x;
      wv.y = y;
      wv.nx = nx;
      wv.ny = ny;
      wv.speed = speed;
      wv.seed = (clock.value * 0.000613) % 1;
      wv.born = clock.value;
    };

    vx.value *= DRAG;
    vy.value *= DRAG;
    let nx = bx.value + vx.value * dt;
    let ny = by.value + vy.value * dt;

    if (nx < BALL) {
      nx = BALL;
      if (Math.abs(vx.value) > MIN_HIT) spawn(0, ny, 1, 0, Math.abs(vx.value));
      vx.value = -vx.value * RESTITUTION;
    } else if (nx > w - BALL) {
      nx = w - BALL;
      if (Math.abs(vx.value) > MIN_HIT) spawn(w, ny, -1, 0, Math.abs(vx.value));
      vx.value = -vx.value * RESTITUTION;
    }
    if (ny < BALL) {
      ny = BALL;
      if (Math.abs(vy.value) > MIN_HIT) spawn(nx, 0, 0, 1, Math.abs(vy.value));
      vy.value = -vy.value * RESTITUTION;
    } else if (ny > h - BALL) {
      ny = h - BALL;
      if (Math.abs(vy.value) > MIN_HIT) spawn(nx, h, 0, -1, Math.abs(vy.value));
      vy.value = -vy.value * RESTITUTION;
    }

    bx.value = nx;
    by.value = ny;

    if (Math.hypot(vx.value, vy.value) < STOP) {
      vx.value = 0;
      vy.value = 0;
      mode.value = 0;
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
        mode.value = 0;
        return;
      }
      if (speed > MAXV) {
        lvx = (lvx / speed) * MAXV;
        lvy = (lvy / speed) * MAXV;
      }
      vx.value = lvx;
      vy.value = lvy;
      mode.value = 2;
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

  const Burst = TREATMENTS[pick].Burst;

  return (
    <GestureDetector gesture={pan}>
      <View style={styles.fill} onLayout={(e) => setBox(e.nativeEvent.layout)}>
        <Canvas style={StyleSheet.absoluteFill}>
          <Fill color="#0b0b0f" />
          {Array.from({ length: POOL }, (_, i) => (
            <Burst key={`${pick}-${i}`} index={i} waves={waves} clock={clock} />
          ))}
          <Line p1={anchorPos} p2={aimPos} color="#6c5ce755" strokeWidth={2} opacity={aimOpacity} />
          <Line p1={anchorPos} p2={ballPos} color="#8a8a99" strokeWidth={3} opacity={aimOpacity} />
          <Circle c={anchorPos} r={4} color="#3c3c52" opacity={aimOpacity} />
          <Circle c={ballPos} r={BALL} color="#e8e8f0" />
        </Canvas>

        <View style={styles.bar}>
          {TREATMENTS.map((t, i) => (
            <Pressable
              key={t.key}
              onPress={() => setPick(i)}
              style={[styles.chip, i === pick && styles.chipOn]}
            >
              <Text style={[styles.chipText, i === pick && styles.chipTextOn]}>
                {t.label}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.hint}>Pull back & release — tap a style above</Text>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  bar: {
    position: 'absolute',
    top: 12,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#15151d',
    borderWidth: 1,
    borderColor: '#26263a',
  },
  chipOn: { backgroundColor: '#2a2a40', borderColor: '#6c5ce7' },
  chipText: { color: '#8a8a99', fontSize: 13, fontWeight: '600' },
  chipTextOn: { color: '#fff' },
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
  id: 'explosion-studies',
  title: 'Explosion studies',
  description: 'A/B four explosion treatments on the same slingshot — neon, bloom, fireworks, plasma.',
  parentId: 'slingshot-bloom',
  Component: ExplosionStudies,
};

export default sketch;
