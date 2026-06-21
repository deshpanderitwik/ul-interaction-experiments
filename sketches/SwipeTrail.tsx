import {
  BlurMask,
  Canvas,
  Circle,
  Fill,
  Path,
  Skia,
  vec,
} from '@shopify/react-native-skia';
import { useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
} from 'react-native-reanimated';
import type { Sketch } from './types';

type Pt = { x: number; y: number };

const MIN_STEP = 3; // px between recorded trail points
const MAX_POINTS = 2500; // cap so a long session stays light

function buildPath(pts: Pt[]) {
  const p = Skia.Path.Make();
  if (pts.length) {
    p.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) p.lineTo(pts[i].x, pts[i].y);
  }
  return p;
}

// drop oldest strokes once we exceed the point budget
function cap(strokes: Pt[][]) {
  let total = strokes.reduce((n, s) => n + s.length, 0);
  let out = strokes;
  while (total > MAX_POINTS && out.length > 1) {
    total -= out[0].length;
    out = out.slice(1);
  }
  return out;
}

// Swipe trail — drag anywhere: a neon line follows your finger and stays
// behind as a trail, with a live x/y readout pinned next to your fingertip.
function SwipeTrail() {
  const [strokes, setStrokes] = useState<Pt[][]>([]);
  const [coord, setCoord] = useState<Pt | null>(null);
  const lastRef = useRef<Pt | null>(null);

  // finger position drives the cursor + label on the UI thread (smooth)
  const fx = useSharedValue(0);
  const fy = useSharedValue(0);
  const active = useSharedValue(0);

  const begin = (x: number, y: number) => {
    lastRef.current = { x, y };
    setStrokes((s) => cap([...s, [{ x, y }]]));
    setCoord({ x: Math.round(x), y: Math.round(y) });
  };
  const move = (x: number, y: number) => {
    setCoord({ x: Math.round(x), y: Math.round(y) });
    const last = lastRef.current;
    if (last && Math.hypot(x - last.x, y - last.y) < MIN_STEP) return;
    lastRef.current = { x, y };
    setStrokes((s) => {
      if (!s.length) return [[{ x, y }]];
      const copy = s.slice();
      copy[copy.length - 1] = [...copy[copy.length - 1], { x, y }];
      return cap(copy);
    });
  };
  const end = () => {
    lastRef.current = null;
    setCoord(null);
  };

  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => {
      fx.value = e.x;
      fy.value = e.y;
      active.value = 1;
      runOnJS(begin)(e.x, e.y);
    })
    .onChange((e) => {
      fx.value = e.x;
      fy.value = e.y;
      runOnJS(move)(e.x, e.y);
    })
    .onFinalize(() => {
      active.value = 0;
      runOnJS(end)();
    });

  // rebuild Skia paths only when the trail changes (not on every coord tick)
  const paths = useMemo(() => strokes.map(buildPath), [strokes]);

  const cursor = useDerivedValue(() => vec(fx.value, fy.value));
  const cursorOpacity = useDerivedValue(() => active.value);
  const labelStyle = useAnimatedStyle(() => ({
    opacity: active.value,
    transform: [
      { translateX: fx.value + 16 },
      { translateY: fy.value - 34 },
    ],
  }));

  return (
    <GestureDetector gesture={pan}>
      <View style={styles.fill}>
        <Canvas style={StyleSheet.absoluteFill}>
          <Fill color="#06070a" />
          {paths.map((p, i) => (
            <Path
              key={`glow-${i}`}
              path={p}
              style="stroke"
              strokeWidth={11}
              strokeJoin="round"
              strokeCap="round"
              color="#00e5ff"
              opacity={0.22}
            >
              <BlurMask blur={8} style="normal" />
            </Path>
          ))}
          {paths.map((p, i) => (
            <Path
              key={`line-${i}`}
              path={p}
              style="stroke"
              strokeWidth={3.5}
              strokeJoin="round"
              strokeCap="round"
              color="#b6f7ff"
            />
          ))}
          <Circle c={cursor} r={9} color="#eafdff" opacity={cursorOpacity}>
            <BlurMask blur={6} style="solid" />
          </Circle>
        </Canvas>

        <Animated.View style={[styles.label, labelStyle]} pointerEvents="none">
          <Text style={styles.labelText}>
            {coord ? `${coord.x}, ${coord.y}` : ''}
          </Text>
        </Animated.View>

        <Pressable
          style={styles.clear}
          onPress={() => {
            setStrokes([]);
            setCoord(null);
          }}
        >
          <Text style={styles.clearText}>Clear</Text>
        </Pressable>
        <Text style={styles.hint}>Swipe to draw — the label tracks your x, y</Text>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  label: {
    position: 'absolute',
    top: 0,
    left: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderColor: 'rgba(0,229,255,0.45)',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  labelText: {
    color: '#b6f7ff',
    fontSize: 13,
    fontVariant: ['tabular-nums'],
    fontWeight: '600',
  },
  clear: {
    position: 'absolute',
    top: 14,
    right: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  clearText: { color: '#b6f7ff', fontSize: 13, fontWeight: '600' },
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
  id: 'swipe-trail',
  title: 'Swipe trail',
  description: 'Drag to draw a neon trail with a live x/y readout pinned to your finger.',
  order: 80,
  Component: SwipeTrail,
};

export default sketch;
