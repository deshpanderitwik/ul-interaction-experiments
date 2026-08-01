import { useClock } from '@shopify/react-native-skia';
import { useNavigation } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useFrameCallback, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { useExperimentActive } from '../_host';
import { useSharedClock } from '../combinations/clock';
import { useTempo } from '../tempo';

// Time · Overlapping Rings — a stack of same-size loop rings. Looked at top-down
// they sit exactly on top of each other, so only one is visible; swipe (either
// direction) to cycle which ring that is. Tap to tilt the camera: the stack
// separates so you can see every ring at once, the current one held in front.
// Tap again to drop back to top-down. The back-swipe navigation is disabled so
// both swipe directions cycle rings.

const BEATS_PER_BAR = 4;
const FLATTEN = 0.3; // vertical squash when tilted
const GAP = 50; // vertical separation between layers when tilted

const RINGS = [
  { bars: 1, color: '#7ad0ff', dots: 8 },
  { bars: 2, color: '#a0b4ff', dots: 8 },
  { bars: 3, color: '#c9a0ff', dots: 8 },
  { bars: 4, color: '#ff9db0', dots: 8 },
  { bars: 6, color: '#ffd166', dots: 8 },
];
const N = RINGS.length;

export default function OverlappingRings() {
  const live = useExperimentActive();
  const tempo = useTempo();
  const localClock = useClock();
  const sharedClock = useSharedClock();
  const clock = sharedClock ?? localClock;
  const { width, height } = useWindowDimensions();
  const navigation = useNavigation();

  const cx = width / 2;
  const cy = height * 0.44;
  const R = Math.min(width * 0.36, height * 0.2);

  const [current, setCurrent] = useState(0);
  const tilt = useSharedValue(0);
  const tilted = useSharedValue(0);
  const tempoSV = useSharedValue(tempo);
  const phases = RINGS.map(() => useSharedValue(0));
  const focus = RINGS.map((_, i) => useSharedValue(i === 0 ? 1 : 0));
  useEffect(() => {
    tempoSV.value = tempo;
  }, [tempo, tempoSV]);

  // Disable the stack's swipe-back so both swipe directions cycle rings.
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: false });
    return () => navigation.setOptions({ gestureEnabled: true });
  }, [navigation]);

  // Crossfade the focused (current) ring.
  useEffect(() => {
    for (let i = 0; i < N; i++) focus[i].value = withTiming(i === current ? 1 : 0, { duration: 220 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  const frame = useFrameCallback(() => {
    'worklet';
    const now = clock.value;
    const beatMs = 60000 / tempoSV.value;
    for (let i = 0; i < N; i++) {
      const loopMs = RINGS[i].bars * BEATS_PER_BAR * beatMs;
      phases[i].value = (now % loopMs) / loopMs;
    }
  }, false);

  useEffect(() => {
    frame.setActive(live);
    return () => frame.setActive(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, frame]);

  const cycle = (dir: number) => setCurrent((c) => (c + dir + N) % N);

  const tap = Gesture.Tap().onEnd(() => {
    'worklet';
    tilted.value = tilted.value === 0 ? 1 : 0;
    tilt.value = withTiming(tilted.value, { duration: 550 });
  });
  const swipe = Gesture.Pan()
    .activeOffsetX([-16, 16])
    .onEnd((e) => {
      if (e.translationX <= -40 || e.velocityX < -500) runOnJS(cycle)(1);
      else if (e.translationX >= 40 || e.velocityX > 500) runOnJS(cycle)(-1);
    });

  return (
    <GestureDetector gesture={Gesture.Race(tap, swipe)}>
      <View style={styles.fill}>
        {RINGS.map((r, i) => (
          <RingLayer
            key={i}
            cx={cx}
            cy={cy}
            R={R}
            color={r.color}
            dots={r.dots}
            phase={phases[i]}
            tilt={tilt}
            focus={focus[i]}
            offset={(i - (N - 1) / 2) * GAP}
            zIndex={i === current ? 100 : i}
          />
        ))}
        {/* page indicator */}
        <View style={styles.pager} pointerEvents="none">
          {RINGS.map((r, i) => (
            <View
              key={i}
              style={{ width: i === current ? 9 : 6, height: i === current ? 9 : 6, borderRadius: 5, marginHorizontal: 4, backgroundColor: i === current ? r.color : 'rgba(255,255,255,0.25)' }}
            />
          ))}
        </View>
      </View>
    </GestureDetector>
  );
}

function RingLayer({
  cx,
  cy,
  R,
  color,
  dots,
  phase,
  tilt,
  focus,
  offset,
  zIndex,
}: {
  cx: number;
  cy: number;
  R: number;
  color: string;
  dots: number;
  phase: SharedValue<number>;
  tilt: SharedValue<number>;
  focus: SharedValue<number>;
  offset: number;
  zIndex: number;
}) {
  const dotList = useMemo(
    () =>
      Array.from({ length: dots }, (_, i) => {
        const a = (i / dots) * 2 * Math.PI - Math.PI / 2;
        return { x: R + R * Math.cos(a), y: R + R * Math.sin(a) };
      }),
    [R, dots]
  );

  const containerStyle = useAnimatedStyle(() => ({
    opacity: Math.max(focus.value, tilt.value * 0.5),
    transform: [{ translateY: tilt.value * offset }, { scaleY: 1 - tilt.value * (1 - FLATTEN) }],
  }));
  const handStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${phase.value * 360}deg` }] }));

  return (
    <Animated.View style={[{ position: 'absolute', left: cx - R, top: cy - R, width: 2 * R, height: 2 * R, zIndex }, containerStyle]} pointerEvents="none">
      <View style={{ position: 'absolute', left: 0, top: 0, width: 2 * R, height: 2 * R, borderRadius: R, borderWidth: 1.5, borderColor: color }} />
      {dotList.map((d, i) => (
        <View key={i} style={{ position: 'absolute', left: d.x - 4, top: d.y - 4, width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      ))}
      <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: 2 * R, height: 2 * R }, handStyle]}>
        <View style={{ position: 'absolute', left: R - 1.5, top: 0, width: 3, height: R, borderRadius: 1.5, backgroundColor: '#fff' }} />
        <View style={{ position: 'absolute', left: R - 4, top: -4, width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  pager: { position: 'absolute', bottom: 60, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
});
