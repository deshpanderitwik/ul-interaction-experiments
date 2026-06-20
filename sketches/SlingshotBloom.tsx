import { Canvas, Circle, Fill, Line, vec } from '@shopify/react-native-skia';
import { useEffect, useState } from 'react';
import { LayoutRectangle, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
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

// mode: 0 idle · 1 aiming · 2 flying
function clamp(v: number, lo: number, hi: number) {
  'worklet';
  return Math.min(hi, Math.max(lo, v));
}

// Brick 2 — flight + bounce. Release turns the pull into velocity (fired
// opposite the pull), a frame loop flies the ball on the UI thread, it
// ricochets off the walls with restitution + light drag, and settles to
// rest where it stops. Grab it again from there — or catch it mid-flight.
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
  const mode = useSharedValue(0);

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

    vx.value *= DRAG;
    vy.value *= DRAG;
    let nx = bx.value + vx.value * dt;
    let ny = by.value + vy.value * dt;

    if (nx < BALL) {
      nx = BALL;
      vx.value = -vx.value * RESTITUTION;
    } else if (nx > w - BALL) {
      nx = w - BALL;
      vx.value = -vx.value * RESTITUTION;
    }
    if (ny < BALL) {
      ny = BALL;
      vy.value = -vy.value * RESTITUTION;
    } else if (ny > h - BALL) {
      ny = h - BALL;
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
      // grab (or catch) the ball if the touch lands on it
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
  // band + guide only while aiming; otherwise collapse onto the ball
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
