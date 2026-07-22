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
// *apex* picks a rhythmic slot off a ladder on the left. The ladder isn't just
// straight subdivisions: interleaved between them are OFF-BEAT slots (same rate,
// landing on the "and") and SYNCOPATED slots (dotted values that cross the beat).
// Drag a ball's column up for a higher, slower slot or down for a lower, faster
// one; each is clock-locked (with its phase offset) so three independent grooves
// layer without drifting. Every ground touch fires that ball's voice.

const N = 3;
const NAMES = ['KICK', 'SNARE', 'HAT'];
const BALL_R = 22;
const RR = 40;
const GROUND_FROM_BOTTOM = 150;
const TOP_MARGIN = 150;
const RAIL_W = 48;

// The rhythm ladder, slowest (top) → fastest (bottom). Each slot is a period in
// beats plus a phase offset within that period: phase 0 lands on the grid,
// phase 0.5 lands halfway (the off-beat / "and"). Dotted periods (1.5, 0.75)
// don't divide the beat evenly, so they push against it — syncopation.
const SLOTS: { beats: number; phase: number; label: string; kind: 'straight' | 'off' | 'sync' }[] = [
  { beats: 2, phase: 0, label: '1/2', kind: 'straight' },
  { beats: 1.5, phase: 0, label: '1/4.', kind: 'sync' },
  { beats: 1, phase: 0, label: '1/4', kind: 'straight' },
  { beats: 1, phase: 0.5, label: '1/4+', kind: 'off' },
  { beats: 0.75, phase: 0, label: '1/8.', kind: 'sync' },
  { beats: 0.5, phase: 0, label: '1/8', kind: 'straight' },
  { beats: 0.5, phase: 0.5, label: '1/8+', kind: 'off' },
  { beats: 0.25, phase: 0, label: '1/16', kind: 'straight' },
];
const SLOT_BEATS = SLOTS.map((s) => s.beats);
const SLOT_PHASE = SLOTS.map((s) => s.phase);
const KIND_COLOR: Record<string, string> = {
  straight: 'rgba(255,255,255,0.72)',
  off: '#7ad0ff', // cool = off-beat
  sync: '#ffd166', // amber = syncopated
};
const DEFAULT_IDX = [2, 0, 5]; // kick 1/4, snare 1/2, hat 1/8 — a straight starting groove

export default function HeightRhythms() {
  const live = useExperimentActive();
  const tempo = useTempo();
  const localClock = useClock();
  const sharedClock = useSharedClock();
  const clock = sharedClock ?? localClock;
  const { width, height } = useWindowDimensions();
  const groundY = height - GROUND_FROM_BOTTOM;
  const xs = useMemo(() => {
    const span = width - RAIL_W;
    return [1, 2, 3].map((k) => RAIL_W + (span * k) / 4);
  }, [width]);

  // Apex height (px above the ground) for each ladder slot — evenly spaced rungs,
  // so off-beat/syncopated slots get their own reachable height next to the
  // straight ones. Independent of the raw period, which the slot also carries.
  const apexes = useMemo(() => {
    const top = Math.max(140, groundY - TOP_MARGIN - 2 * BALL_R);
    const bottom = 44;
    const n = SLOTS.length;
    return SLOTS.map((_, i) => top - (i / (n - 1)) * (top - bottom));
  }, [groundY]);

  const [idxs, setIdxs] = useState(DEFAULT_IDX); // per-ball slot index, for labels
  const setIdxAt = (b: number, v: number) =>
    setIdxs((prev) => {
      const next = prev.slice();
      next[b] = v;
      return next;
    });

  const [active, setActive] = useState([false, false, false]); // every voice starts off
  const setActiveAt = (b: number, on: boolean) =>
    setActive((prev) => {
      const next = prev.slice();
      next[b] = on;
      return next;
    });

  // Per-ball animated state (arrays of shared values, indexed in the worklet).
  const ballYs = [useSharedValue(groundY - BALL_R), useSharedValue(groundY - BALL_R), useSharedValue(groundY - BALL_R)];
  const squashes = [useSharedValue(0), useSharedValue(0), useSharedValue(0)];
  const rScales = [useSharedValue(0), useSharedValue(0), useSharedValue(0)];
  const rOps = [useSharedValue(0), useSharedValue(0), useSharedValue(0)];
  const kCounts = [useSharedValue(-1), useSharedValue(-1), useSharedValue(-1)];
  const starteds = [useSharedValue(0), useSharedValue(0), useSharedValue(0)];
  const t0s = [useSharedValue(0), useSharedValue(0), useSharedValue(0)]; // clock time each ball was released
  const activeSVs = [useSharedValue(0), useSharedValue(0), useSharedValue(0)]; // 0 = muted
  const idxSVs = [useSharedValue(DEFAULT_IDX[0]), useSharedValue(DEFAULT_IDX[1]), useSharedValue(DEFAULT_IDX[2])];

  const slotBeatsSV = useSharedValue(SLOT_BEATS);
  const slotPhaseSV = useSharedValue(SLOT_PHASE);
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
      if (activeSVs[b].value === 0) continue; // muted — no bounce, no hit
      const i = idxSVs[b].value;
      const T = slotBeatsSV.value[i] * beatMs;
      const ph = slotPhaseSV.value[i];
      const apex = ax[i]; // the dashed ring's height
      const t0 = t0s[b].value;
      // First descent: the ball starts exactly at the dashed ring (where it was
      // released) and falls from there right away, timed to reach the ground on
      // the next grid hit. After that it bounces steadily, locked to the beat —
      // so the entry is immediate but the rhythm still lands on the grid.
      const kNext = Math.floor(t0 / T - ph) + 1;
      const tHit0 = (kNext + ph) * T;
      if (now < tHit0) {
        let u = (now - t0) / (tHit0 - t0);
        if (u < 0) u = 0;
        else if (u > 1) u = 1;
        ballYs[b].value = ground - BALL_R - apex * (1 - u * u); // accelerating fall
      } else {
        const g = now / T - ph;
        const p = g - Math.floor(g);
        ballYs[b].value = ground - BALL_R - apex * 4 * p * (1 - p);
      }
      const kPassed = Math.floor(now / T - ph); // grid hits elapsed
      if (starteds[b].value === 0) {
        kCounts[b].value = kPassed;
        starteds[b].value = 1;
        continue;
      }
      if (kPassed !== kCounts[b].value) {
        kCounts[b].value = kPassed;
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
    const now = clock.value;
    for (let b = 0; b < N; b++) {
      starteds[b].value = 0;
      t0s[b].value = now; // re-drop live balls from their ring on (re)activation
    }
    frame.setActive(live);
    return () => frame.setActive(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, frame]);

  // Grab the nearest ball's column, then drag up/down to set its slot; snaps to
  // the nearest rung.
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
        starteds[b].value = 0;
        t0s[b].value = clock.value; // changing height re-drops from the new ring
        runOnJS(setIdxAt)(b, best);
      }
    })
    .onFinalize(() => {
      activeBall.value = -1;
    });

  // Tap an instrument's label (below the ground line) to switch that voice on or
  // off. The dashed ring is no longer a switch — it just marks bounce height.
  const tap = Gesture.Tap()
    .maxDistance(18)
    .onEnd((e) => {
      const cols = xsSV.value;
      const ground = groundYSV.value;
      if (e.y < ground + 6 || e.y > ground + 56) return; // only the label strip
      for (let b = 0; b < N; b++) {
        if (Math.abs(e.x - cols[b]) > 60) continue;
        const on = activeSVs[b].value === 0;
        activeSVs[b].value = on ? 1 : 0;
        if (on) {
          starteds[b].value = 0;
          t0s[b].value = clock.value; // release now → drops from the ring immediately
        }
        runOnJS(setActiveAt)(b, on);
        break;
      }
    });

  const railTop = groundY - BALL_R - apexes[0];

  return (
    <GestureDetector gesture={Gesture.Exclusive(tap, pan)}>
      <View style={styles.fill}>
        {/* left ruler: the rhythm ladder */}
        <View
          style={[styles.rail, { top: railTop - 10, height: groundY - (railTop - 10) }]}
          pointerEvents="none"
        />
        {apexes.map((a, i) => {
          const y = groundY - BALL_R - a;
          const c = KIND_COLOR[SLOTS[i].kind];
          return (
            <View key={i} pointerEvents="none">
              <View style={[styles.railGuide, { top: y }]} />
              <View style={[styles.railTick, { top: y - 0.5, backgroundColor: c }]} />
            </View>
          );
        })}
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
            ringColor={KIND_COLOR[SLOTS[idxs[b]].kind]}
            active={active[b]}
          />
        ))}
        {[0, 1, 2].map((b) => (
          <Text
            key={b}
            style={[
              styles.name,
              { top: groundY + 16, left: xs[b] - 50, color: KIND_COLOR[SLOTS[idxs[b]].kind], opacity: active[b] ? 1 : 0.5 },
            ]}
          >
            {active[b] ? '● ' : '○ '}
            {NAMES[b]}
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
  ringColor,
  active,
}: {
  x: number;
  ballY: SharedValue<number>;
  squash: SharedValue<number>;
  rScale: SharedValue<number>;
  rOp: SharedValue<number>;
  idxSV: SharedValue<number>;
  apexesSV: SharedValue<number[]>;
  groundYSV: SharedValue<number>;
  ringColor: string;
  active: boolean;
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
    // The dashed ring marks how high the ball travels — the slot's apex. Drag the
    // column to move it up/down (higher = slower/coarser, lower = faster/finer).
    const apex = apexesSV.value[idxSV.value] ?? 0;
    return { transform: [{ translateX: x - BALL_R }, { translateY: groundYSV.value - 2 * BALL_R - apex }] };
  });
  const rippleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x - RR }, { translateY: groundYSV.value - RR }, { scale: rScale.value }],
    opacity: rOp.value,
  }));
  return (
    <>
      {active && <Animated.View style={[styles.ripple, rippleStyle]} pointerEvents="none" />}
      {/* the dashed ring marks how high the ball travels; drag it up/down */}
      <Animated.View
        style={[styles.ring, { borderColor: ringColor, opacity: active ? 1 : 0.55 }, ringStyle]}
        pointerEvents="none"
      />
      {active && <Animated.View style={[styles.ball, ballStyle]} pointerEvents="none" />}
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
  rail: { position: 'absolute', left: RAIL_W, width: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.25)' },
  // faint full-width reference line at each rung, so a ball's apex reads across
  railGuide: { position: 'absolute', left: RAIL_W, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.05)' },
  railTick: { position: 'absolute', left: RAIL_W - 8, width: 8, height: 1 },
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
    fontSize: 11,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    letterSpacing: 1,
  },
});
