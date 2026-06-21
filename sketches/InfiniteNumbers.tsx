import * as Haptics from 'expo-haptics';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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

const TEAL = '#00e6b8'; // the live, centered operand
const AMBER = '#ffb454'; // the held operand
const DIM = '#5a5a6b';

function NumberItem({
  index,
  offset,
  centerY,
  held,
}: {
  index: number;
  offset: SharedValue<number>;
  centerY: number;
  held: boolean;
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
    // The held number keeps its amber tint wherever it scrolls to, and never
    // fully fades — so you can always find your stored operand.
    const color = held
      ? AMBER
      : interpolateColor(dist, [0, ITEM_HEIGHT * 1.6], [TEAL, DIM]);
    return {
      transform: [{ translateY: d }, { scale }],
      opacity: held ? Math.max(opacity, 0.85) : opacity,
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
  const [heldIndex, setHeldIndex] = useState<number | null>(null);
  const [height, setHeight] = useState(0);
  const insets = useSafeAreaInsets();

  const onCenter = (i: number) => {
    setCenterIndex(i);
    Haptics.selectionAsync().catch(() => {});
  };

  const grab = (i: number) => {
    setHeldIndex(i);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  };

  const release = () => {
    setHeldIndex(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };

  // Slide the rendered window (and tick a haptic) only when a *new* number
  // takes the center — not every frame.
  useAnimatedReaction(
    () => Math.round(offset.value / ITEM_HEIGHT),
    (cur, prev) => {
      if (prev !== null && cur !== prev) runOnJS(onCenter)(cur);
    },
  );

  // Drag to scroll; press-and-hold (without moving) to grab the number under
  // your finger. Simultaneous, so you can hold, then keep dragging to dial the
  // center while watching the results update live.
  const gesture = useMemo(() => {
    const centerY = height / 2;
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

    const hold = Gesture.LongPress()
      .minDuration(350)
      .maxDistance(14)
      .onStart((e) => {
        // which number is under the finger, given where we're scrolled to
        const i = Math.round((e.y - centerY + offset.value) / ITEM_HEIGHT);
        runOnJS(grab)(i);
      });

    return Gesture.Simultaneous(pan, hold);
  }, [height, offset]);

  const indices = useMemo(() => {
    const out: number[] = [];
    for (let i = centerIndex - WINDOW; i <= centerIndex + WINDOW; i++) out.push(i);
    return out;
  }, [centerIndex]);

  return (
    <View style={styles.fill} onLayout={(e) => setHeight(e.nativeEvent.layout.height)}>
      <GestureDetector gesture={gesture}>
        <View style={StyleSheet.absoluteFill}>
          {height > 0 &&
            indices.map((i) => (
              <NumberItem
                key={i}
                index={i}
                offset={offset}
                centerY={height / 2}
                held={i === heldIndex}
              />
            ))}
        </View>
      </GestureDetector>

      {/* Held operand — pinned top shelf. Tap to release. */}
      {heldIndex !== null && (
        <Pressable
          onPress={release}
          style={[styles.heldChip, { top: insets.top + 12 }]}
          hitSlop={10}
        >
          <Text style={styles.heldLabel}>HELD</Text>
          <Text style={styles.heldValue}>{heldIndex.toLocaleString()}</Text>
          <Text style={styles.heldClear}>✕</Text>
        </Pressable>
      )}

      {/* Results — pinned bottom. Reads top(held) → middle(live) → bottom(result). */}
      {heldIndex !== null ? (
        <View style={[styles.results, { bottom: insets.bottom + 20 }]} pointerEvents="none">
          <Equation a={heldIndex} op="+" b={centerIndex} />
          <Equation a={heldIndex} op="−" b={centerIndex} />
        </View>
      ) : (
        <Text style={[styles.hint, { bottom: insets.bottom + 24 }]} pointerEvents="none">
          Long-press a number to hold it
        </Text>
      )}
    </View>
  );
}

function Equation({ a, op, b }: { a: number; op: '+' | '−'; b: number }) {
  const result = op === '+' ? a + b : a - b;
  return (
    <Text style={styles.eqn}>
      <Text style={{ color: AMBER }}>{a.toLocaleString()}</Text>
      <Text style={styles.eqnOp}> {op} </Text>
      <Text style={{ color: TEAL }}>{b.toLocaleString()}</Text>
      <Text style={styles.eqnOp}> = </Text>
      <Text style={styles.eqnResult}>{result.toLocaleString()}</Text>
    </Text>
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
  heldChip: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: '#1a160d',
    borderWidth: 1,
    borderColor: '#3a2f17',
  },
  heldLabel: { color: '#8a7a4a', fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  heldValue: { color: AMBER, fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
  heldClear: { color: '#8a7a4a', fontSize: 14, fontWeight: '700' },
  results: { position: 'absolute', left: 0, right: 0, alignItems: 'center', gap: 6 },
  eqn: { fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'] },
  eqnOp: { color: DIM },
  eqnResult: { color: '#ffffff' },
  hint: { position: 'absolute', left: 0, right: 0, textAlign: 'center', color: '#3c3c52', fontSize: 14 },
});

const sketch: Sketch = {
  id: 'infinite-numbers',
  title: 'Infinite numbers',
  description: 'Scroll a bottomless number line; long-press to hold a value and watch it add and subtract live.',
  order: 80,
  Component: InfiniteNumbers,
};

export default sketch;
