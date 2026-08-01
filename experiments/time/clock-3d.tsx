import { useClock } from '@shopify/react-native-skia';
import { useEffect, useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useExperimentActive } from '../_host';
import { useSharedClock } from '../combinations/clock';
import { useTempo } from '../tempo';

// Time · 3D Clock — three concentric clocks, each looping at its own length (1, 2,
// 4 bars) so their hands sweep at different speeds. Tap and the "camera" tilts:
// the rings flatten into ellipses and separate vertically, so the concentric
// circles resolve into a stack seen from the side. Tap again and it lies back
// down, top-down. A study in reading the same loops as flat rings or a depth
// stack.

const BEATS_PER_BAR = 4;
const FLATTEN = 0.32; // vertical squash of the ring when tilted sideways
const GAP = 52; // vertical separation between stacked layers when tilted

const RINGS = [
  { bars: 1, rMul: 0.5, ring: 'rgba(122,208,255,0.45)', dot: '#7ad0ff', offset: -GAP },
  { bars: 2, rMul: 0.75, ring: 'rgba(160,180,255,0.45)', dot: '#a0b4ff', offset: 0 },
  { bars: 4, rMul: 1.0, ring: 'rgba(201,160,255,0.45)', dot: '#c9a0ff', offset: GAP },
];

export default function Clock3D() {
  const live = useExperimentActive();
  const tempo = useTempo();
  const localClock = useClock();
  const sharedClock = useSharedClock();
  const clock = sharedClock ?? localClock;
  const { width, height } = useWindowDimensions();

  const cx = width / 2;
  const cy = height * 0.44;
  const R = Math.min(width * 0.34, height * 0.24);

  const tempoSV = useSharedValue(tempo);
  useEffect(() => {
    tempoSV.value = tempo;
  }, [tempo, tempoSV]);

  const phases = [useSharedValue(0), useSharedValue(0), useSharedValue(0)];
  const tilt = useSharedValue(0); // 0 = top-down, 1 = sideways stack
  const sideways = useSharedValue(0);

  const frame = useFrameCallback(() => {
    'worklet';
    const now = clock.value;
    const beatMs = 60000 / tempoSV.value;
    for (let i = 0; i < RINGS.length; i++) {
      const loopMs = RINGS[i].bars * BEATS_PER_BAR * beatMs;
      phases[i].value = (now % loopMs) / loopMs;
    }
  }, false);

  useEffect(() => {
    frame.setActive(live);
    return () => frame.setActive(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, frame]);

  const tap = Gesture.Tap().onEnd(() => {
    'worklet';
    sideways.value = sideways.value === 0 ? 1 : 0;
    tilt.value = withTiming(sideways.value, { duration: 650, easing: Easing.inOut(Easing.cubic) });
  });

  return (
    <GestureDetector gesture={tap}>
      <View style={styles.fill}>
        {RINGS.map((r, i) => (
          <Ring
            key={i}
            cx={cx}
            cy={cy}
            R={R * r.rMul}
            count={r.bars * BEATS_PER_BAR}
            phase={phases[i]}
            tilt={tilt}
            offset={r.offset}
            ringColor={r.ring}
            dotColor={r.dot}
          />
        ))}
      </View>
    </GestureDetector>
  );
}

function Ring({
  cx,
  cy,
  R,
  count,
  phase,
  tilt,
  offset,
  ringColor,
  dotColor,
}: {
  cx: number;
  cy: number;
  R: number;
  count: number;
  phase: SharedValue<number>;
  tilt: SharedValue<number>;
  offset: number;
  ringColor: string;
  dotColor: string;
}) {
  // Dot centers relative to the box center (R, R).
  const dots = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const a = (i / count) * 2 * Math.PI - Math.PI / 2;
        return { x: R + R * Math.cos(a), y: R + R * Math.sin(a), bar: i % BEATS_PER_BAR === 0 };
      }),
    [R, count]
  );

  // A 2R×2R box centered at (cx, cy) — a real, sized view so scaleY and the hand's
  // rotate both pivot cleanly around its center. Tilt squashes it and slides it
  // to its stacked layer.
  const containerStyle = useAnimatedStyle(() => {
    const t = tilt.value;
    return { transform: [{ translateY: t * offset }, { scaleY: 1 - t * (1 - FLATTEN) }] };
  });
  const handStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${phase.value * 360}deg` }] }));

  return (
    <Animated.View style={[{ position: 'absolute', left: cx - R, top: cy - R, width: 2 * R, height: 2 * R }, containerStyle]} pointerEvents="none">
      <View style={{ position: 'absolute', left: 0, top: 0, width: 2 * R, height: 2 * R, borderRadius: R, borderWidth: 1, borderColor: ringColor }} />
      {dots.map((d, i) => {
        const size = d.bar ? 9 : 5;
        return (
          <View
            key={i}
            style={{ position: 'absolute', left: d.x - size / 2, top: d.y - size / 2, width: size, height: size, borderRadius: size / 2, backgroundColor: d.bar ? dotColor : 'rgba(255,255,255,0.5)' }}
          />
        );
      })}
      {/* hand: a 2R×2R box that rotates around its center; the line runs from the
          top-center down to the center, so it stays pinned no matter the angle */}
      <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: 2 * R, height: 2 * R }, handStyle]}>
        <View style={{ position: 'absolute', left: R - 1.5, top: 0, width: 3, height: R, borderRadius: 1.5, backgroundColor: '#fff' }} />
        <View style={{ position: 'absolute', left: R - 3.5, top: -3.5, width: 7, height: 7, borderRadius: 3.5, backgroundColor: dotColor }} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
});
