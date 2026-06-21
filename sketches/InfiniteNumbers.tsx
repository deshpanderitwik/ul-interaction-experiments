import * as Haptics from 'expo-haptics';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  type SharedValue,
  interpolate,
  interpolateColor,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withDecay,
  withSpring,
} from 'react-native-reanimated';
import type { Sketch } from './types';

// Spacing between consecutive numbers, in px. `offset` is the scroll position:
// when offset === i * ITEM_HEIGHT, number `i` sits dead-center and is largest.
const ITEM_HEIGHT = 92;
const BASE_FONT = 32;
const MAX_SCALE = 2.5; // the centered number
const MIN_SCALE = 0.5; // far from center
// How many numbers to render on each side of center. The list is "infinite":
// we only ever mount this window and slide it as the center index changes, so
// the integers themselves run unbounded in both directions.
const WINDOW = 8;

function NumberItem({
  index,
  offset,
  centerY,
}: {
  index: number;
  offset: SharedValue<number>;
  centerY: number;
}) {
  const style = useAnimatedStyle(() => {
    // signed distance (px) of this number's home position from screen center
    const d = index * ITEM_HEIGHT - offset.value;
    const dist = Math.abs(d);
    const scale = interpolate(
      dist,
      [0, ITEM_HEIGHT, ITEM_HEIGHT * 4],
      [MAX_SCALE, 1, MIN_SCALE],
      Extrapolation.CLAMP,
    );
    const opacity = interpolate(
      dist,
      [0, ITEM_HEIGHT * 1.2, ITEM_HEIGHT * 4.5],
      [1, 0.5, 0.06],
      Extrapolation.CLAMP,
    );
    const color = interpolateColor(
      dist,
      [0, ITEM_HEIGHT * 1.6],
      ['#00e6b8', '#5a5a6b'],
    );
    return {
      transform: [{ translateY: d }, { scale }],
      opacity,
      color,
    };
  });

  return (
    <Animated.Text style={[styles.number, { top: centerY - ITEM_HEIGHT / 2 }, style]}>
      {index.toLocaleString()}
    </Animated.Text>
  );
}

function InfiniteNumbers() {
  const offset = useSharedValue(0);
  const [centerIndex, setCenterIndex] = useState(0);
  const [height, setHeight] = useState(0);

  const onCenter = (i: number) => {
    setCenterIndex(i);
    Haptics.selectionAsync().catch(() => {});
  };

  // Slide the rendered window (and tick a haptic) only when a *new* number
  // takes the center — not every frame.
  useAnimatedReaction(
    () => Math.round(offset.value / ITEM_HEIGHT),
    (cur, prev) => {
      if (prev !== null && cur !== prev) runOnJS(onCenter)(cur);
    },
  );

  const pan = Gesture.Pan()
    .onBegin(() => {
      offset.value = offset.value; // halt any running momentum on touch
    })
    .onChange((e) => {
      offset.value -= e.changeY; // drag up → count up, drag down → count down
    })
    .onEnd((e) => {
      // fling with momentum, then settle so a number rests exactly centered
      offset.value = withDecay(
        { velocity: -e.velocityY, deceleration: 0.997 },
        (finished) => {
          if (finished) {
            offset.value = withSpring(Math.round(offset.value / ITEM_HEIGHT) * ITEM_HEIGHT, {
              damping: 18,
              stiffness: 130,
              mass: 0.6,
            });
          }
        },
      );
    });

  const indices = useMemo(() => {
    const out: number[] = [];
    for (let i = centerIndex - WINDOW; i <= centerIndex + WINDOW; i++) out.push(i);
    return out;
  }, [centerIndex]);

  return (
    <View style={styles.fill} onLayout={(e) => setHeight(e.nativeEvent.layout.height)}>
      <GestureDetector gesture={pan}>
        <View style={StyleSheet.absoluteFill}>
          {height > 0 &&
            indices.map((i) => (
              <NumberItem key={i} index={i} offset={offset} centerY={height / 2} />
            ))}
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#0b0b0f' },
  number: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: ITEM_HEIGHT,
    lineHeight: ITEM_HEIGHT,
    textAlign: 'center',
    fontSize: BASE_FONT,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});

const sketch: Sketch = {
  id: 'infinite-numbers',
  title: 'Infinite numbers',
  description: 'Scroll a bottomless number line — the centered value swells as its neighbors shrink aside.',
  order: 80,
  Component: InfiniteNumbers,
};

export default sketch;
