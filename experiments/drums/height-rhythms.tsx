import { useClock } from '@shopify/react-native-skia';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useExperimentActive } from '../_host';
import { useSharedClock } from '../combinations/clock';
import { useTempo } from '../tempo';
import { playKick } from './voice';

// Drums · Height Rhythms — a bouncing ball whose *apex* is its subdivision. Drag
// the dashed ring (the point the ball rises to) up for a higher, slower bounce =
// coarser hits, or down for a lower, faster bounce = finer hits. It snaps between
// subdivisions (1/2, 1/4, 1/8, 1/16); each bounce is clock-locked to that
// subdivision so the rhythm stays musical. The kick fires on every ground touch.

const BALL_R = 24;
const RR = 44;
const GROUND_FROM_BOTTOM = 140;
const TOP_MARGIN = 120;
const PERIODS = [2, 1, 0.5, 0.25]; // bounce period in beats (slow → fast)
const APEX_FRACS = [1.0, 0.6, 0.32, 0.16]; // apex as a fraction of the available height
const LABELS = ['1/2', '1/4', '1/8', '1/16'];

export default function HeightRhythms() {
  const live = useExperimentActive();
  const tempo = useTempo();
  const localClock = useClock();
  const sharedClock = useSharedClock();
  const clock = sharedClock ?? localClock;
  const { width, height } = useWindowDimensions();
  const groundY = height - GROUND_FROM_BOTTOM;
  const ballX = width / 2;

  // Apex heights (px above resting center) for each subdivision, fit to the screen.
  const apexes = useMemo(
    () => APEX_FRACS.map((f) => Math.max(44, f * (groundY - TOP_MARGIN - 2 * BALL_R))),
    [groundY]
  );

  const [idx, setIdx] = useState(1); // for the labels
  const idxSV = useSharedValue(1);
  const periodsSV = useSharedValue(PERIODS);
  const apexesSV = useSharedValue(apexes);
  const tempoSV = useSharedValue(tempo);
  const groundYSV = useSharedValue(groundY);
  useEffect(() => {
    apexesSV.value = apexes;
    tempoSV.value = tempo;
    groundYSV.value = groundY;
  }, [apexes, tempo, groundY, apexesSV, tempoSV, groundYSV]);

  const ballY = useSharedValue(groundY - BALL_R);
  const squash = useSharedValue(0);
  const rScale = useSharedValue(0);
  const rOp = useSharedValue(0);
  const kCount = useSharedValue(-1);
  const started = useSharedValue(0);

  const frame = useFrameCallback(() => {
    'worklet';
    const now = clock.value;
    const beatMs = 60000 / tempoSV.value;
    const ground = groundYSV.value;
    const i = idxSV.value;
    const T = periodsSV.value[i] * beatMs;
    const apex = apexesSV.value[i];
    const u = (now % T) / T;
    ballY.value = ground - BALL_R - apex * 4 * u * (1 - u);
    const k = Math.floor(now / T);
    if (started.value === 0) {
      kCount.value = k;
      started.value = 1;
      return;
    }
    if (k !== kCount.value) {
      kCount.value = k;
      squash.value = withSequence(
        withTiming(1, { duration: 45, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 200, easing: Easing.out(Easing.quad) })
      );
      rScale.value = 0;
      rScale.value = withTiming(1, { duration: 400, easing: Easing.out(Easing.quad) });
      rOp.value = 0.5;
      rOp.value = withTiming(0, { duration: 400, easing: Easing.out(Easing.quad) });
      runOnJS(playKick)(0.95);
    }
  }, false);

  useEffect(() => {
    started.value = 0;
    frame.setActive(live);
    return () => frame.setActive(false);
  }, [live, frame, started]);

  // Drag anywhere up/down to set the apex; snaps to the nearest subdivision.
  const pan = Gesture.Pan().onUpdate((e) => {
    const target = groundYSV.value - BALL_R - e.y; // desired apex from finger height
    const ax = apexesSV.value;
    let best = 0;
    let bestD = 1e9;
    for (let j = 0; j < ax.length; j++) {
      const d = Math.abs(ax[j] - target);
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    if (best !== idxSV.value) {
      idxSV.value = best;
      started.value = 0; // re-baseline the hit counter for the new period
      runOnJS(setIdx)(best);
    }
  });

  const ballStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: ballX - BALL_R },
      { translateY: ballY.value - BALL_R },
      { scaleX: 1 + 0.4 * squash.value },
      { scaleY: 1 - 0.4 * squash.value },
    ],
  }));
  const ringStyle = useAnimatedStyle(() => {
    const apex = apexesSV.value[idxSV.value] ?? 0;
    return { transform: [{ translateX: ballX - BALL_R }, { translateY: groundYSV.value - 2 * BALL_R - apex }] };
  });
  const rippleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: ballX - RR }, { translateY: groundYSV.value - RR }, { scale: rScale.value }],
    opacity: rOp.value,
  }));

  return (
    <GestureDetector gesture={pan}>
      <View style={styles.fill}>
        {/* subdivision markers at each snap height */}
        {apexes.map((a, i) => (
          <Text key={i} style={[styles.subLabel, { top: groundY - BALL_R - a - 8, opacity: i === idx ? 0.9 : 0.28 }]}>
            {LABELS[i]}
          </Text>
        ))}
        <View style={[styles.ground, { top: groundY }]} />
        <Animated.View style={[styles.ripple, rippleStyle]} pointerEvents="none" />
        <Animated.View style={[styles.ring, ringStyle]} pointerEvents="none" />
        <Animated.View style={[styles.ball, ballStyle]} pointerEvents="none" />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  ground: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  ball: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: BALL_R * 2,
    height: BALL_R * 2,
    borderRadius: BALL_R,
    backgroundColor: '#fff',
  },
  // Dashed apex ring — the point the ball rises to.
  ring: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: BALL_R * 2,
    height: BALL_R * 2,
    borderRadius: BALL_R,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.6)',
  },
  ripple: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: RR * 2,
    height: RR * 2,
    borderRadius: RR,
    borderWidth: 2,
    borderColor: '#fff',
  },
  subLabel: {
    position: 'absolute',
    left: 16,
    width: 40,
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.5,
  },
});
