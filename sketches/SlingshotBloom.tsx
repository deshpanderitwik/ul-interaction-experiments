import { Canvas, Circle, Fill, Line, vec } from '@shopify/react-native-skia';
import { useEffect, useState } from 'react';
import { LayoutRectangle, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  useDerivedValue,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import type { Sketch } from './types';

const BALL = 26; // ball radius
const GRAB = BALL + 44; // how close a touch must land to grab the ball
const SPRING = { damping: 14, stiffness: 140 };

function clamp(v: number, lo: number, hi: number) {
  'worklet';
  return Math.min(hi, Math.max(lo, v));
}

// Brick 1 — aiming. Grab the ball, drag it (it follows your finger, kept
// inside the walls), and a stretch band draws from the anchor to the ball
// while a faint guide previews the launch direction (opposite the pull).
// Release just springs it home; firing it comes in Brick 2.
function SlingshotBloom() {
  const [box, setBox] = useState<LayoutRectangle | null>(null);
  const w = box?.width ?? 0;
  const h = box?.height ?? 0;
  const cx = w / 2; // anchor (rest position)
  const cy = h / 2;

  const bx = useSharedValue(0);
  const by = useSharedValue(0);
  const aiming = useSharedValue(0);

  // park the ball at the anchor once we know the canvas size
  useEffect(() => {
    if (box) {
      bx.value = cx;
      by.value = cy;
    }
  }, [box, cx, cy, bx, by]);

  const pan = Gesture.Pan()
    .onBegin((e) => {
      if (Math.hypot(e.x - cx, e.y - cy) <= GRAB) aiming.value = 1;
    })
    .onChange((e) => {
      if (!aiming.value) return;
      bx.value = clamp(e.x, BALL, w - BALL);
      by.value = clamp(e.y, BALL, h - BALL);
    })
    .onFinalize(() => {
      if (!aiming.value) return;
      aiming.value = 0;
      bx.value = withSpring(cx, SPRING);
      by.value = withSpring(cy, SPRING);
    });

  const ballPos = useDerivedValue(() => vec(bx.value, by.value));
  const anchorPos = useDerivedValue(() => vec(cx, cy), [cx, cy]);
  // launch guide: reflect the ball through the anchor (the way it'll fire)
  const aimPos = useDerivedValue(
    () => vec(2 * cx - bx.value, 2 * cy - by.value),
    [cx, cy],
  );

  return (
    <GestureDetector gesture={pan}>
      <View style={styles.fill} onLayout={(e) => setBox(e.nativeEvent.layout)}>
        <Canvas style={StyleSheet.absoluteFill}>
          <Fill color="#0b0b0f" />
          {/* faint launch-direction guide */}
          <Line p1={anchorPos} p2={aimPos} color="#6c5ce755" strokeWidth={2} />
          {/* the stretch band */}
          <Line p1={anchorPos} p2={ballPos} color="#8a8a99" strokeWidth={3} />
          {/* anchor marker + ball */}
          <Circle cx={cx} cy={cy} r={4} color="#3c3c52" />
          <Circle c={ballPos} r={BALL} color="#e8e8f0" />
        </Canvas>
        <Text style={styles.hint}>Grab the ball, pull back, release</Text>
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
