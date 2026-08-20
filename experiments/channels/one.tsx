import { Blur, Canvas, Circle, RoundedRect, rect, rrect } from '@shopify/react-native-skia';
import { useMemo, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  runOnJS,
  useAnimatedReaction,
  useDerivedValue,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';

// Channels 1 — the seed of the channels family: what is the glass-born gesture
// for moving attention between parallel voices? Here, the bare skeleton: a row
// of colored squares at different depths. Swipe left/right to pull focus — the
// focused square is sharp and full-size, the others recede behind it, blurred.
// The key decision: focus is CONTINUOUS under the finger (mid-swipe, two
// squares are each half-blurred — a focus dial, not a tab), and only snaps to
// a channel on release. No audio yet; this sketch is only about the feel of
// the pull.

const COLORS = ['#ff6b6b', '#54f2b0', '#9b8cff', '#ffd166', '#5b8cff']; // the repo's accents
const N = COLORS.length;
const CORNER = 22; // corner radius of a focused square, px

export default function ChannelsOne() {
  const { width, height } = useWindowDimensions();
  const focus = useSharedValue(0); // continuous channel index, 0..N-1
  const dragStart = useSharedValue(0);
  const STEP = width * 0.5; // px of swipe per channel step

  // Painter's order: the square nearest the (rounded) focus must draw last, on
  // top. Re-sorting happens exactly at the half-step crossover, where the two
  // swapping squares are the same size — so the z-swap is invisible.
  const [front, setFront] = useState(0);
  useAnimatedReaction(
    () => Math.round(Math.max(0, Math.min(N - 1, focus.value))),
    (cur, prev) => {
      if (prev !== null && cur !== prev) runOnJS(setFront)(cur);
    }
  );
  const order = useMemo(
    () =>
      COLORS.map((_, i) => i).sort(
        (a, b) => Math.abs(b - front) - Math.abs(a - front) || a - b
      ),
    [front]
  );

  const pan = Gesture.Pan()
    .onBegin(() => {
      dragStart.value = focus.value;
    })
    .onUpdate((e) => {
      let f = dragStart.value - e.translationX / STEP;
      // Rubber-band past the ends: the row resists, then springs back.
      if (f < 0) f = f / 3;
      else if (f > N - 1) f = N - 1 + (f - (N - 1)) / 3;
      focus.value = f;
    })
    .onEnd((e) => {
      // Project the flick velocity a beat forward, then snap to that channel.
      const proj = focus.value - (e.velocityX / STEP) * 0.22;
      const target = Math.max(0, Math.min(N - 1, Math.round(proj)));
      focus.value = withSpring(target, { damping: 17, stiffness: 170, mass: 0.6 });
    });

  return (
    <View style={styles.fill}>
      <GestureDetector gesture={pan}>
        <View style={styles.fill}>
          <Canvas style={StyleSheet.absoluteFill}>
            {order.map((i) => (
              <ChannelSquare
                key={i}
                index={i}
                focus={focus}
                width={width}
                height={height}
                color={COLORS[i]}
              />
            ))}
            {COLORS.map((_, i) => (
              <FocusDot
                key={`d${i}`}
                index={i}
                focus={focus}
                cx={width / 2 + (i - (N - 1) / 2) * 20}
                cy={height - 72}
              />
            ))}
          </Canvas>
        </View>
      </GestureDetector>
    </View>
  );
}

// One channel: a rounded square whose position, size, blur, and presence all
// derive from its signed distance to the focal plane (d = index - focus).
// At d = 0 it is centered, full-size, and sharp; each step away slides it
// aside, shrinks it, lifts it slightly, and blurs it further back.
function ChannelSquare({
  index,
  focus,
  width,
  height,
  color,
}: {
  index: number;
  focus: SharedValue<number>;
  width: number;
  height: number;
  color: string;
}) {
  const SIZE = Math.min(width * 0.56, 250);

  const rr = useDerivedValue(() => {
    const d = index - focus.value;
    const a = Math.abs(d);
    const scale = 1 / (1 + 0.38 * a);
    const s = SIZE * scale;
    const cx = width / 2 + d * SIZE * 0.72;
    const cy = height * 0.44 - a * 10;
    return rrect(rect(cx - s / 2, cy - s / 2, s, s), CORNER * scale, CORNER * scale);
  });
  const blurSigma = useDerivedValue(() => Math.abs(index - focus.value) * 8);
  const opacity = useDerivedValue(() => Math.max(0.25, 1 - 0.2 * Math.abs(index - focus.value)));

  return (
    <RoundedRect rect={rr} color={color} opacity={opacity}>
      <Blur blur={blurSigma} />
    </RoundedRect>
  );
}

// Position indicator: one dot per channel; the dot nearest the focus swells
// and brightens continuously as focus passes through it.
function FocusDot({
  index,
  focus,
  cx,
  cy,
}: {
  index: number;
  focus: SharedValue<number>;
  cx: number;
  cy: number;
}) {
  const near = useDerivedValue(() => Math.max(0, 1 - Math.abs(index - focus.value)));
  const r = useDerivedValue(() => 2.6 + 1.6 * near.value);
  const opacity = useDerivedValue(() => 0.25 + 0.7 * near.value);
  return <Circle cx={cx} cy={cy} r={r} color="white" opacity={opacity} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#0a0a0a' },
});
