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
// apex picks a rhythmic slot off a ladder on the left. Below, a bar meter shows a
// looping 4-bar phrase: tap a bar to select it, then move a sound's height to
// write a *variation* just for that bar (the base pattern plays in every other
// bar). Each bounce is grid-locked, so the three grooves — and their per-bar
// variations — stay in time. Every ground touch fires that ball's voice.

const N = 3;
const NAMES = ['KICK', 'SNARE', 'HAT'];
const BALL_R = 22;
const RR = 40;
const GROUND_FROM_BOTTOM = 170;
const TOP_MARGIN = 150;
const RAIL_W = 48;
const BARS = 4; // loop length in bars
const BEATS_PER_BAR = 4;

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
const VAR_COLOR = '#ffd166';
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

  // Bar meter geometry.
  const meterLeft = RAIL_W;
  const meterW = width - RAIL_W - 16;
  const cellW = meterW / BARS;
  const meterTop = groundY + 44;
  const meterH = 22;

  // Apex height (px above the ground) for each ladder slot — evenly spaced rungs.
  const apexes = useMemo(() => {
    const top = Math.max(140, groundY - TOP_MARGIN - 2 * BALL_R);
    const bottom = 44;
    const n = SLOTS.length;
    return SLOTS.map((_, i) => top - (i / (n - 1)) * (top - bottom));
  }, [groundY]);

  // Base slot per ball, plus per-(ball,bar) overrides (-1 = follow the base).
  const [baseIdxs, setBaseIdxs] = useState(DEFAULT_IDX);
  const [overrides, setOverrides] = useState<number[]>(() => new Array(N * BARS).fill(-1));
  const [selectedBar, setSelectedBar] = useState(-1); // -1 = editing the base
  const [active, setActive] = useState([false, false, false]); // every voice starts off

  const setBaseIdxAt = (b: number, v: number) =>
    setBaseIdxs((prev) => {
      const next = prev.slice();
      next[b] = v;
      return next;
    });
  const setOverrideAt = (b: number, bar: number, v: number) =>
    setOverrides((prev) => {
      const next = prev.slice();
      next[b * BARS + bar] = v;
      return next;
    });
  const setActiveAt = (b: number, on: boolean) =>
    setActive((prev) => {
      const next = prev.slice();
      next[b] = on;
      return next;
    });

  // The slot the ring/label should show for ball b — the current edit target.
  const displayIdx = (b: number) => {
    if (selectedBar >= 0) {
      const ov = overrides[b * BARS + selectedBar];
      return ov >= 0 ? ov : baseIdxs[b];
    }
    return baseIdxs[b];
  };
  // Which bars carry a real variation (any ball differs from its base there).
  const barHasVar = (bar: number) => {
    for (let b = 0; b < N; b++) {
      const ov = overrides[b * BARS + bar];
      if (ov >= 0 && ov !== baseIdxs[b]) return true;
    }
    return false;
  };

  // Per-ball animated state (arrays of shared values, indexed in the worklet).
  const ballYs = [useSharedValue(groundY - BALL_R), useSharedValue(groundY - BALL_R), useSharedValue(groundY - BALL_R)];
  const squashes = [useSharedValue(0), useSharedValue(0), useSharedValue(0)];
  const rScales = [useSharedValue(0), useSharedValue(0), useSharedValue(0)];
  const rOps = [useSharedValue(0), useSharedValue(0), useSharedValue(0)];
  const kCounts = [useSharedValue(-1), useSharedValue(-1), useSharedValue(-1)];
  const starteds = [useSharedValue(0), useSharedValue(0), useSharedValue(0)];
  const t0s = [useSharedValue(0), useSharedValue(0), useSharedValue(0)]; // release time
  const tHit0s = [useSharedValue(0), useSharedValue(0), useSharedValue(0)]; // first grid hit
  const firstApexs = [useSharedValue(0), useSharedValue(0), useSharedValue(0)]; // entry drop height
  const activeSVs = [useSharedValue(0), useSharedValue(0), useSharedValue(0)]; // 0 = muted

  const baseIdxSV = useSharedValue(DEFAULT_IDX.slice());
  const overrideSV = useSharedValue<number[]>(new Array(N * BARS).fill(-1));
  const selectedBarSV = useSharedValue(-1);
  const slotBeatsSV = useSharedValue(SLOT_BEATS);
  const slotPhaseSV = useSharedValue(SLOT_PHASE);
  const apexesSV = useSharedValue(apexes);
  const tempoSV = useSharedValue(tempo);
  const groundYSV = useSharedValue(groundY);
  const xsSV = useSharedValue(xs);
  const activeBall = useSharedValue(-1);
  const loopProgress = useSharedValue(0);
  const currentBar = useSharedValue(0);
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
    const barMs = BEATS_PER_BAR * beatMs;
    const ground = groundYSV.value;
    const ax = apexesSV.value;

    const bar = Math.floor(now / barMs) % BARS;
    currentBar.value = bar;
    loopProgress.value = (now % (BARS * barMs)) / (BARS * barMs);

    for (let b = 0; b < N; b++) {
      if (activeSVs[b].value === 0) continue; // muted — no bounce, no hit
      // Effective slot for this ball in the bar that's playing right now.
      const ov = overrideSV.value[b * BARS + bar];
      const slot = ov >= 0 ? ov : baseIdxSV.value[b];
      const T = slotBeatsSV.value[slot] * beatMs;
      const ph = slotPhaseSV.value[slot];
      const apex = ax[slot];
      const t0 = t0s[b].value;

      if (starteds[b].value === 0) {
        // Arm the entry: baseline the hit counter and time the first fall to land
        // on the next grid hit, dropping from this slot's ring.
        const k0 = Math.floor(t0 / T - ph);
        kCounts[b].value = k0;
        tHit0s[b].value = (k0 + 1 + ph) * T;
        firstApexs[b].value = apex;
        starteds[b].value = 1;
      }

      const tHit0 = tHit0s[b].value;
      if (now < tHit0) {
        // Immediate accelerating fall from the ring to the ground on the grid hit.
        let u = (now - t0) / (tHit0 - t0);
        if (u < 0) u = 0;
        else if (u > 1) u = 1;
        ballYs[b].value = ground - BALL_R - firstApexs[b].value * (1 - u * u);
      } else {
        const g = now / T - ph;
        const p = g - Math.floor(g);
        ballYs[b].value = ground - BALL_R - apex * 4 * p * (1 - p);
      }

      const kPassed = Math.floor(now / T - ph); // grid hits elapsed for this slot
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

  // Drag a ball's column up/down to set its bounce height. If a bar is selected,
  // the change writes a variation just for that bar; otherwise it sets the base.
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
      const target = groundYSV.value - BALL_R - e.y;
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
      const sel = selectedBarSV.value;
      let cur;
      if (sel >= 0) {
        const ov = overrideSV.value[b * BARS + sel];
        cur = ov >= 0 ? ov : baseIdxSV.value[b];
      } else {
        cur = baseIdxSV.value[b];
      }
      if (best !== cur) {
        if (sel >= 0) {
          const arr = overrideSV.value.slice();
          arr[b * BARS + sel] = best;
          overrideSV.value = arr;
          runOnJS(setOverrideAt)(b, sel, best);
        } else {
          const arr = baseIdxSV.value.slice();
          arr[b] = best;
          baseIdxSV.value = arr;
          starteds[b].value = 0;
          t0s[b].value = clock.value; // re-drop from the new ring on a base edit
          runOnJS(setBaseIdxAt)(b, best);
        }
      }
    })
    .onFinalize(() => {
      activeBall.value = -1;
    });

  // Tap an instrument label to toggle its voice; tap a bar in the meter to select
  // it for editing (tap again to deselect).
  const tap = Gesture.Tap()
    .maxDistance(18)
    .onEnd((e) => {
      const ground = groundYSV.value;
      // Bar meter strip.
      if (e.y >= meterTop - 4 && e.y <= meterTop + meterH + 6 && e.x >= meterLeft && e.x <= meterLeft + meterW) {
        let bar = Math.floor((e.x - meterLeft) / cellW);
        if (bar < 0) bar = 0;
        else if (bar >= BARS) bar = BARS - 1;
        const next = selectedBarSV.value === bar ? -1 : bar;
        selectedBarSV.value = next;
        runOnJS(setSelectedBar)(next);
        return;
      }
      // Instrument label strip.
      if (e.y >= ground + 2 && e.y <= ground + 36) {
        const cols = xsSV.value;
        for (let b = 0; b < N; b++) {
          if (Math.abs(e.x - cols[b]) > 60) continue;
          const on = activeSVs[b].value === 0;
          activeSVs[b].value = on ? 1 : 0;
          if (on) {
            starteds[b].value = 0;
            t0s[b].value = clock.value;
          }
          runOnJS(setActiveAt)(b, on);
          break;
        }
      }
    });

  const railTop = groundY - BALL_R - apexes[0];

  return (
    <GestureDetector gesture={Gesture.Exclusive(tap, pan)}>
      <View style={styles.fill}>
        {/* left ruler: the rhythm ladder */}
        <View style={[styles.rail, { top: railTop - 10, height: groundY - (railTop - 10) }]} pointerEvents="none" />
        {apexes.map((a, i) => {
          const y = groundY - BALL_R - a;
          const c = KIND_COLOR[SLOTS[i].kind];
          return (
            <View key={i} pointerEvents="none">
              <View style={[styles.railGuide, { top: y }]} />
              <View style={[styles.railTick, { top: y - 0.5, backgroundColor: c }]} />
              <Text style={[styles.railLabel, { top: y - 8, color: c }]}>{SLOTS[i].label}</Text>
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
            apexes={apexes}
            groundY={groundY}
            groundYSV={groundYSV}
            displayIdx={displayIdx(b)}
            ringColor={KIND_COLOR[SLOTS[displayIdx(b)].kind]}
            active={active[b]}
          />
        ))}
        {[0, 1, 2].map((b) => (
          <Text
            key={b}
            style={[
              styles.name,
              { top: groundY + 12, left: xs[b] - 50, color: KIND_COLOR[SLOTS[displayIdx(b)].kind], opacity: active[b] ? 1 : 0.5 },
            ]}
          >
            {active[b] ? '● ' : '○ '}
            {NAMES[b]}
          </Text>
        ))}

        {/* bar meter */}
        <View style={{ position: 'absolute', left: meterLeft, top: meterTop, width: meterW, height: meterH }}>
          {Array.from({ length: BARS }, (_, i) => (
            <MeterCell
              key={i}
              index={i}
              left={i * cellW}
              width={cellW - 4}
              height={meterH}
              selected={selectedBar === i}
              hasVar={barHasVar(i)}
              currentBar={currentBar}
            />
          ))}
          <Playhead loopProgress={loopProgress} meterW={meterW} height={meterH} />
        </View>
      </View>
    </GestureDetector>
  );
}

function MeterCell({
  index,
  left,
  width,
  height,
  selected,
  hasVar,
  currentBar,
}: {
  index: number;
  left: number;
  width: number;
  height: number;
  selected: boolean;
  hasVar: boolean;
  currentBar: SharedValue<number>;
}) {
  const fillStyle = useAnimatedStyle(() => ({ opacity: currentBar.value === index ? 0.24 : 0 }));
  const border = selected ? '#fff' : hasVar ? 'rgba(255,209,102,0.8)' : 'rgba(255,255,255,0.22)';
  return (
    <View
      style={{
        position: 'absolute',
        left,
        top: 0,
        width,
        height,
        borderRadius: 5,
        borderWidth: selected ? 1.5 : 1,
        borderColor: border,
        overflow: 'hidden',
      }}
    >
      <Animated.View style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#fff' }, fillStyle]} />
      {hasVar && <View style={{ position: 'absolute', top: 4, right: 4, width: 4, height: 4, borderRadius: 2, backgroundColor: VAR_COLOR }} />}
    </View>
  );
}

function Playhead({ loopProgress, meterW, height }: { loopProgress: SharedValue<number>; meterW: number; height: number }) {
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: loopProgress.value * meterW }] }));
  return (
    <Animated.View
      style={[{ position: 'absolute', top: -3, left: 0, width: 2, height: height + 6, backgroundColor: 'rgba(255,255,255,0.85)' }, style]}
      pointerEvents="none"
    />
  );
}

function BallView({
  x,
  ballY,
  squash,
  rScale,
  rOp,
  apexes,
  groundY,
  groundYSV,
  displayIdx,
  ringColor,
  active,
}: {
  x: number;
  ballY: SharedValue<number>;
  squash: SharedValue<number>;
  rScale: SharedValue<number>;
  rOp: SharedValue<number>;
  apexes: number[];
  groundY: number;
  groundYSV: SharedValue<number>;
  displayIdx: number;
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
  const rippleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x - RR }, { translateY: groundYSV.value - RR }, { scale: rScale.value }],
    opacity: rOp.value,
  }));
  // The dashed ring marks how high the ball travels (the edit target's apex). It's
  // a discrete value, so a plain positioned view is fine.
  const ringTop = groundY - 2 * BALL_R - (apexes[displayIdx] ?? 0);
  return (
    <>
      {active && <Animated.View style={[styles.ripple, rippleStyle]} pointerEvents="none" />}
      <View
        style={[styles.ring, { borderColor: ringColor, opacity: active ? 1 : 0.55, left: x - BALL_R, top: ringTop }]}
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
  railGuide: { position: 'absolute', left: RAIL_W, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.05)' },
  railTick: { position: 'absolute', left: RAIL_W - 8, width: 8, height: 1 },
  railLabel: {
    position: 'absolute',
    left: 0,
    width: RAIL_W - 12,
    textAlign: 'right',
    fontSize: 10,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.3,
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
  ring: {
    position: 'absolute',
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
