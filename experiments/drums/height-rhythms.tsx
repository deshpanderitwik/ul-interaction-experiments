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
  type SharedValue,
} from 'react-native-reanimated';
import { useExperimentActive } from '../_host';
import { useSharedClock } from '../combinations/clock';
import { useTempo } from '../tempo';
import { playHat, playKick, playSnare } from './voice';

// Drums · Height Rhythms — three bouncing balls (kick, snare, hi-hat), each one's
// *apex* is its own subdivision. Drag a ball's column up for a higher, slower
// bounce = coarser hits, or down for a lower, faster bounce = finer hits. Each
// snaps between subdivisions (1/2, 1/4, 1/8, 1/16) and is clock-locked to it, so
// three independent rhythms layer without drifting. Every ground touch fires that
// ball's voice.

const N = 3;
const NAMES = ['KICK', 'SNARE', 'HAT'];
const BALL_R = 22;
const RR = 40;
const GROUND_FROM_BOTTOM = 150;
const TOP_MARGIN = 120;
const PERIODS = [2, 1, 0.5, 0.25]; // bounce period in beats (slow → fast)
const APEX_FRACS = [1.0, 0.6, 0.32, 0.16]; // apex as a fraction of the available height
const LABELS = ['1/2', '1/4', '1/8', '1/16'];
const DEFAULT_IDX = [1, 0, 2]; // kick 1/4, snare 1/2, hat 1/8 — a starting groove

export default function HeightRhythms() {
  const live = useExperimentActive();
  const tempo = useTempo();
  const localClock = useClock();
  const sharedClock = useSharedClock();
  const clock = sharedClock ?? localClock;
  const { width, height } = useWindowDimensions();
  const groundY = height - GROUND_FROM_BOTTOM;
  const xs = useMemo(() => [width * 0.25, width * 0.5, width * 0.75], [width]);

  // Apex heights (px above the ground) for each subdivision, fit to the screen.
  const apexes = useMemo(
    () => APEX_FRACS.map((f) => Math.max(44, f * (groundY - TOP_MARGIN - 2 * BALL_R))),
    [groundY]
  );

  const [idxs, setIdxs] = useState(DEFAULT_IDX); // per-ball subdivision index, for labels
  const setIdxAt = (b: number, v: number) =>
    setIdxs((prev) => {
      const next = prev.slice();
      next[b] = v;
      return next;
    });

  // Per-ball animated state (arrays of shared values, indexed in the worklet).
  const ballYs = [useSharedValue(groundY - BALL_R), useSharedValue(groundY - BALL_R), useSharedValue(groundY - BALL_R)];
  const squashes = [useSharedValue(0), useSharedValue(0), useSharedValue(0)];
  const rScales = [useSharedValue(0), useSharedValue(0), useSharedValue(0)];
  const rOps = [useSharedValue(0), useSharedValue(0), useSharedValue(0)];
  const kCounts = [useSharedValue(-1), useSharedValue(-1), useSharedValue(-1)];
  const starteds = [useSharedValue(0), useSharedValue(0), useSharedValue(0)];
  const idxSVs = [useSharedValue(DEFAULT_IDX[0]), useSharedValue(DEFAULT_IDX[1]), useSharedValue(DEFAULT_IDX[2])];

  const periodsSV = useSharedValue(PERIODS);
  const apexesSV = useSharedValue(apexes);
  const tempoSV = useSharedValue(tempo);
  const groundYSV = useSharedValue(groundY);
  const xsSV = useSharedValue(xs);
  const activeBall = useSharedValue(-1);
  useEffect(() => {
    apexesSV.value = apexes;
    tempoSV.value = tempo;
    groundYSV.value = groundY;
    xsSV.value = xs;
  }, [apexes, tempo, groundY, xs, apexesSV, tempoSV, groundYSV, xsSV]);

  const fire = (b: number) => {
    if (b === 0) playKick(0.95);
    else if (b === 1) playSnare(0.7);
    else playHat(false, 0.5);
  };

  const frame = useFrameCallback(() => {
    'worklet';
    const now = clock.value;
    const beatMs = 60000 / tempoSV.value;
    const ground = groundYSV.value;
    const ax = apexesSV.value;
    for (let b = 0; b < N; b++) {
      const i = idxSVs[b].value;
      const T = periodsSV.value[i] * beatMs;
      const apex = ax[i];
      const u = (now % T) / T;
      ballYs[b].value = ground - BALL_R - apex * 4 * u * (1 - u);
      const k = Math.floor(now / T);
      if (starteds[b].value === 0) {
        kCounts[b].value = k;
        starteds[b].value = 1;
        continue;
      }
      if (k !== kCounts[b].value) {
        kCounts[b].value = k;
        squashes[b].value = withSequence(
          withTiming(1, { duration: 45, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 200, easing: Easing.out(Easing.quad) })
        );
        rScales[b].value = 0;
        rScales[b].value = withTiming(1, { duration: 400, easing: Easing.out(Easing.quad) });
        rOps[b].value = 0.5;
        rOps[b].value = withTiming(0, { duration: 400, easing: Easing.out(Easing.quad) });
        runOnJS(fire)(b);
      }
    }
  }, false);

  useEffect(() => {
    for (let b = 0; b < N; b++) starteds[b].value = 0;
    frame.setActive(live);
    return () => frame.setActive(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, frame]);

  // Grab the nearest ball's column, then drag up/down to set its apex; snaps to
  // the nearest subdivision.
  const pan = Gesture.Pan()
    .onBegin((e) => {
      const cols = xsSV.value;
      let best = 0;
      let bestD = 1e9;
      for (let b = 0; b < N; b++) {
        const d = Math.abs(cols[b] - e.x);
        if (d < bestD) {
          bestD = d;
          best = b;
        }
      }
      activeBall.value = best;
    })
    .onUpdate((e) => {
      const b = activeBall.value;
      if (b < 0) return;
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
      if (best !== idxSVs[b].value) {
        idxSVs[b].value = best;
        starteds[b].value = 0; // re-baseline the hit counter for the new period
        runOnJS(setIdxAt)(b, best);
      }
    })
    .onFinalize(() => {
      activeBall.value = -1;
    });

  return (
    <GestureDetector gesture={pan}>
      <View style={styles.fill}>
        {/* shared height ladder: a faint line + label at each snap height */}
        {apexes.map((a, i) => (
          <View key={i} style={[styles.guide, { top: groundY - BALL_R - a }]} pointerEvents="none">
            <Text style={styles.guideLabel}>{LABELS[i]}</Text>
            <View style={styles.guideLine} />
          </View>
        ))}
        <View style={[styles.ground, { top: groundY }]} />
        {[0, 1, 2].map((b) => (
          <BallView
            key={b}
            x={xs[b]}
            ballY={ballYs[b]}
            squash={squashes[b]}
            rScale={rScales[b]}
            rOp={rOps[b]}
            idxSV={idxSVs[b]}
            apexesSV={apexesSV}
            groundYSV={groundYSV}
          />
        ))}
        {[0, 1, 2].map((b) => (
          <Text key={b} style={[styles.name, { top: groundY + 16, left: xs[b] - 50 }]}>
            {NAMES[b]} · {LABELS[idxs[b]]}
          </Text>
        ))}
      </View>
    </GestureDetector>
  );
}

function BallView({
  x,
  ballY,
  squash,
  rScale,
  rOp,
  idxSV,
  apexesSV,
  groundYSV,
}: {
  x: number;
  ballY: SharedValue<number>;
  squash: SharedValue<number>;
  rScale: SharedValue<number>;
  rOp: SharedValue<number>;
  idxSV: SharedValue<number>;
  apexesSV: SharedValue<number[]>;
  groundYSV: SharedValue<number>;
}) {
  const ballStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: x - BALL_R },
      { translateY: ballY.value - BALL_R },
      { scaleX: 1 + 0.4 * squash.value },
      { scaleY: 1 - 0.4 * squash.value },
    ],
  }));
  const ringStyle = useAnimatedStyle(() => {
    const apex = apexesSV.value[idxSV.value] ?? 0;
    return { transform: [{ translateX: x - BALL_R }, { translateY: groundYSV.value - 2 * BALL_R - apex }] };
  });
  const rippleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x - RR }, { translateY: groundYSV.value - RR }, { scale: rScale.value }],
    opacity: rOp.value,
  }));
  return (
    <>
      <Animated.View style={[styles.ripple, rippleStyle]} pointerEvents="none" />
      <Animated.View style={[styles.ring, ringStyle]} pointerEvents="none" />
      <Animated.View style={[styles.ball, ballStyle]} pointerEvents="none" />
    </>
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
  guide: { position: 'absolute', left: 0, right: 0, height: 0, flexDirection: 'row', alignItems: 'center' },
  guideLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.08)' },
  guideLabel: {
    width: 40,
    marginLeft: 16,
    color: 'rgba(255,255,255,0.35)',
    fontSize: 11,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.5,
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
    borderColor: 'rgba(255,255,255,0.55)',
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
  name: {
    position: 'absolute',
    width: 100,
    textAlign: 'center',
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    letterSpacing: 1,
  },
});
