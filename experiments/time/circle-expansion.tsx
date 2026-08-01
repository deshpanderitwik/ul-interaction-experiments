import { useClock } from '@shopify/react-native-skia';
import { useEffect } from 'react';
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

// Time · Circle Expansion — the loop as a ring or a timeline, and the morph
// between. Tap and the circle of beat-dots unrolls into a straight line; each
// point rides a constant-curvature arc that flattens (curvature → 0) while its
// arc-length position is preserved, so it's a true unroll, not a slide. Tap again
// and it rolls back into a circle. A playhead dot travels the shape either way —
// orbiting the ring, or sweeping the line.

const N = 16; // sixteenths
const BEATS_PER_BAR = 4;
const LOOP_BARS = 2;
const ACCENT = '#a0b4ff';

// Position of arc-length index `f` (0..N) along a shape that morphs from a full
// circle (t=0) to a straight line (t=1), keeping total length and staying
// vertically centered on (cx, cy).
function shapePos(f: number, t: number, R: number, cx: number, cy: number) {
  'worklet';
  const C = 2 * Math.PI * R;
  const u = t > 0.9999 ? 0.0001 : 1 - t; // 1 → circle, →0 → line
  const r = R / u; // radius of curvature (→∞ as it flattens)
  const k = u / R; // curvature
  const ds = (f / N) * C - C / 2; // signed arc length from the middle
  const alpha = ds * k;
  const h = r * (1 - Math.cos(Math.PI * u)); // arc height, for centering
  const my = cy + h / 2; // middle-point y so the shape stays centered
  return { x: cx + r * Math.sin(alpha), y: my - r * (1 - Math.cos(alpha)) };
}

export default function CircleExpansion() {
  const live = useExperimentActive();
  const tempo = useTempo();
  const localClock = useClock();
  const sharedClock = useSharedClock();
  const clock = sharedClock ?? localClock;
  const { width, height } = useWindowDimensions();

  const cx = width / 2;
  const cy = height * 0.42;
  const R = (width - 44) / (2 * Math.PI); // so the unrolled line fits the width

  const tempoSV = useSharedValue(tempo);
  const phase = useSharedValue(0);
  const prevNow = useSharedValue(0);
  const started = useSharedValue(0);
  const t = useSharedValue(0); // 0 = circle, 1 = line
  const isLine = useSharedValue(0);
  useEffect(() => {
    tempoSV.value = tempo;
  }, [tempo, tempoSV]);

  const frame = useFrameCallback(() => {
    'worklet';
    const now = clock.value;
    const beatMs = 60000 / tempoSV.value;
    const loopMs = LOOP_BARS * BEATS_PER_BAR * beatMs;
    if (started.value === 0) {
      prevNow.value = now;
      started.value = 1;
      return;
    }
    let dt = now - prevNow.value;
    prevNow.value = now;
    if (dt < 0 || dt > 200) dt = 0;
    let ph = phase.value + dt / loopMs;
    ph = ph - Math.floor(ph);
    phase.value = ph;
  }, false);

  useEffect(() => {
    started.value = 0;
    frame.setActive(live);
    return () => frame.setActive(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, frame]);

  const tap = Gesture.Tap().onEnd(() => {
    'worklet';
    isLine.value = isLine.value === 0 ? 1 : 0;
    t.value = withTiming(isLine.value, { duration: 750, easing: Easing.inOut(Easing.cubic) });
  });

  return (
    <GestureDetector gesture={tap}>
      <View style={styles.fill}>
        {Array.from({ length: N }, (_, i) => (
          <Dot key={i} index={i} t={t} R={R} cx={cx} cy={cy} />
        ))}
        <Playhead phase={phase} t={t} R={R} cx={cx} cy={cy} />
      </View>
    </GestureDetector>
  );
}

function Dot({ index, t, R, cx, cy }: { index: number; t: SharedValue<number>; R: number; cx: number; cy: number }) {
  const beat = index % BEATS_PER_BAR === 0;
  const size = beat ? 12 : 7;
  const style = useAnimatedStyle(() => {
    const p = shapePos(index, t.value, R, cx, cy);
    return { transform: [{ translateX: p.x - size / 2 }, { translateY: p.y - size / 2 }] };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: 'absolute', left: 0, top: 0, width: size, height: size, borderRadius: size / 2, backgroundColor: beat ? ACCENT : 'rgba(255,255,255,0.75)' },
        style,
      ]}
    />
  );
}

function Playhead({ phase, t, R, cx, cy }: { phase: SharedValue<number>; t: SharedValue<number>; R: number; cx: number; cy: number }) {
  const SIZE = 16;
  const style = useAnimatedStyle(() => {
    const p = shapePos(phase.value * N, t.value, R, cx, cy);
    return { transform: [{ translateX: p.x - SIZE / 2 }, { translateY: p.y - SIZE / 2 }] };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: 'absolute', left: 0, top: 0, width: SIZE, height: SIZE, borderRadius: SIZE / 2, borderWidth: 2, borderColor: '#fff', backgroundColor: 'rgba(255,255,255,0.15)' },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
});
