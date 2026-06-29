import { Blur, Canvas, Circle, Group, Path, useClock } from '@shopify/react-native-skia';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  Easing,
  runOnJS,
  useDerivedValue,
  useSharedValue,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useExperimentActive } from '../_host';
import { midiToFreq, useScale } from '../scale';
import { useTempo } from '../tempo';
import {
  COL_SINE_CSS,
  COL_SQUARE_CSS,
  layout,
  sineSymbolPath,
  squareSymbolPath,
  type Cell,
} from './shared';
import { playSine, playSquare } from './voice';

// Duet — two "cells", each an instrument you toggle on/off:
//   A (sine):   the scale root, legato — a long-decay sine re-voiced on the
//               quarter-note so it sustains as a held drone.
//   B (square): the fifth above, pulsed — a square-ish buzz (additive odd
//               harmonics) struck every eighth-note.
// Visuals are intentionally calm: each cell is a soft glowing circle that
// PULSES on its turn, and every time a note sounds it sheds a RIPPLE — an
// expanding ring with a bloom (Skia blur). The sine cell carries a sine-wave
// glyph, the square cell a square-wave glyph. Only interaction is tap on/off.

type Ripple = { id: number; cx: number; cy: number; r0: number; color: string; born: number };

const RIPPLE_LIFE = 1100; // ms
const MAX_RIPPLES = 28;

export default function Duet() {
  const live = useExperimentActive();
  const { width, height } = useWindowDimensions();
  const scale = useScale();
  const tempo = useTempo();
  const clock = useClock();

  const cells = useMemo(() => layout(width, height), [width, height]);
  const sinePath = useMemo(() => sineSymbolPath(cells.a), [cells.a]);
  const squarePath = useMemo(() => squareSymbolPath(cells.b), [cells.b]);

  const [aOn, setAOn] = useState(false);
  const [bOn, setBOn] = useState(false);
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const nextId = useRef(0);

  // Eased on-amount (0..1) per cell and a short per-sound pulse (0→1→0) that
  // drives the cell pop.
  const aOnV = useSharedValue(0);
  const bOnV = useSharedValue(0);
  const aPulse = useSharedValue(0);
  const bPulse = useSharedValue(0);

  useEffect(() => {
    aOnV.value = withTiming(aOn ? 1 : 0, { duration: 500, easing: Easing.out(Easing.cubic) });
  }, [aOn, aOnV]);
  useEffect(() => {
    bOnV.value = withTiming(bOn ? 1 : 0, { duration: 500, easing: Easing.out(Easing.cubic) });
  }, [bOn, bOnV]);

  // Shed a ripple from a cell the instant it makes a sound; auto-prune it.
  const spawnRipple = useCallback(
    (cell: Cell, color: string) => {
      const id = nextId.current++;
      setRipples((prev) =>
        [
          ...prev,
          { id, cx: cell.cx, cy: cell.cy, r0: cell.r, color, born: clock.value },
        ].slice(-MAX_RIPPLES)
      );
      setTimeout(() => setRipples((prev) => prev.filter((r) => r.id !== id)), RIPPLE_LIFE + 80);
    },
    [clock]
  );

  // Root + fifth from the global scale, in a comfortable low-mid register
  // (C3 = MIDI 48). The fifth is +7 semitones in both major and minor.
  const rootMidi = 48 + scale.root;
  const rootFreq = midiToFreq(rootMidi);
  const fifthFreq = midiToFreq(rootMidi + 7);

  // Sine cell: legato root re-voiced on the quarter-note (long overlapping decay
  // → continuous drone). Each re-voice pops the cell and sheds a ripple.
  useEffect(() => {
    if (!live || !aOn) return;
    const quarterMs = 60000 / tempo;
    const tick = () => {
      playSine(rootFreq);
      spawnRipple(cells.a, COL_SINE_CSS);
      aPulse.value = 0;
      aPulse.value = withSequence(
        withTiming(1, { duration: 80, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: Math.max(120, quarterMs - 80), easing: Easing.out(Easing.quad) })
      );
    };
    tick();
    const h = setInterval(tick, quarterMs);
    return () => clearInterval(h);
  }, [live, aOn, tempo, rootFreq, cells.a, spawnRipple, aPulse]);

  // Square cell: fifth struck on every eighth-note pulse.
  useEffect(() => {
    if (!live || !bOn) return;
    const eighthMs = 30000 / tempo;
    const tick = () => {
      playSquare(fifthFreq);
      spawnRipple(cells.b, COL_SQUARE_CSS);
      bPulse.value = 0;
      bPulse.value = withSequence(
        withTiming(1, { duration: 55, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: Math.max(100, eighthMs - 55), easing: Easing.out(Easing.quad) })
      );
    };
    tick();
    const h = setInterval(tick, eighthMs);
    return () => clearInterval(h);
  }, [live, bOn, tempo, fifthFreq, cells.b, spawnRipple, bPulse]);

  // Clear lingering ripples when the screen goes off/background.
  useEffect(() => {
    if (!live) setRipples([]);
  }, [live]);

  const toggle = (x: number, y: number) => {
    const da = Math.hypot(x - cells.a.cx, y - cells.a.cy);
    const db = Math.hypot(x - cells.b.cx, y - cells.b.cy);
    const inA = da <= cells.a.r * 1.25;
    const inB = db <= cells.b.r * 1.25;
    if (inA && (!inB || da <= db)) setAOn((v) => !v);
    else if (inB) setBOn((v) => !v);
  };

  const tap = Gesture.Tap().onBegin((e) => {
    if (!live) return;
    runOnJS(toggle)(e.x, e.y);
  });

  return (
    <GestureDetector gesture={tap}>
      <View style={styles.fill}>
        <Canvas style={StyleSheet.absoluteFill}>
          {ripples.map((r) => (
            <RippleRing key={r.id} ripple={r} clock={clock} />
          ))}
          <DuetCell cell={cells.a} d={sinePath} color={COL_SINE_CSS} onV={aOnV} pulse={aPulse} />
          <DuetCell cell={cells.b} d={squarePath} color={COL_SQUARE_CSS} onV={bOnV} pulse={bPulse} />
        </Canvas>
        <Text style={styles.hint} pointerEvents="none">
          tap a cell to play
        </Text>
      </View>
    </GestureDetector>
  );
}

// One expanding ring with a soft bloom (Skia blur), fading over its life.
function RippleRing({ ripple, clock }: { ripple: Ripple; clock: SharedValue<number> }) {
  const prog = useDerivedValue(() => Math.min(1, (clock.value - ripple.born) / RIPPLE_LIFE));
  const r = useDerivedValue(() => ripple.r0 * (0.55 + prog.value * 2.1));
  const opacity = useDerivedValue(() => {
    const p = prog.value;
    return Math.min(1, p / 0.08) * (1 - p) * (1 - p) * 0.85; // quick in, long ease-out
  });

  return (
    <Circle
      cx={ripple.cx}
      cy={ripple.cy}
      r={r}
      style="stroke"
      strokeWidth={2.5}
      color={ripple.color}
      opacity={opacity}
    >
      <Blur blur={6} />
    </Circle>
  );
}

// A cell: a soft blooming core that pulses, a thin ring outline, and the wave
// glyph (bloom underlay + crisp white). Brightens when on; pops on each sound.
function DuetCell({
  cell,
  d,
  color,
  onV,
  pulse,
}: {
  cell: Cell;
  d: string;
  color: string;
  onV: SharedValue<number>;
  pulse: SharedValue<number>;
}) {
  const transform = useDerivedValue(() => [{ scale: 1 + 0.09 * pulse.value }]);
  const coreOpacity = useDerivedValue(() => (0.1 + 0.32 * onV.value) * (0.75 + 0.25 * pulse.value));
  const ringOpacity = useDerivedValue(() => 0.25 + 0.55 * onV.value);
  const glyphOpacity = useDerivedValue(() => 0.34 + 0.66 * onV.value);
  const glowOpacity = useDerivedValue(() => (0.18 + 0.4 * onV.value) * (0.7 + 0.3 * pulse.value));

  return (
    <Group transform={transform} origin={{ x: cell.cx, y: cell.cy }}>
      {/* blooming core */}
      <Circle cx={cell.cx} cy={cell.cy} r={cell.r * 0.74} color={color} opacity={coreOpacity}>
        <Blur blur={cell.r * 0.34} />
      </Circle>
      {/* ring outline */}
      <Circle
        cx={cell.cx}
        cy={cell.cy}
        r={cell.r}
        style="stroke"
        strokeWidth={2.5}
        color={color}
        opacity={ringOpacity}
      >
        <Blur blur={1.5} />
      </Circle>
      {/* glyph: bloom underlay */}
      <Path
        path={d}
        style="stroke"
        strokeWidth={9}
        strokeJoin="round"
        strokeCap="round"
        color={color}
        opacity={glowOpacity}
      >
        <Blur blur={7} />
      </Path>
      {/* glyph: crisp */}
      <Path
        path={d}
        style="stroke"
        strokeWidth={3.5}
        strokeJoin="round"
        strokeCap="round"
        color="white"
        opacity={glyphOpacity}
      />
    </Group>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  hint: {
    position: 'absolute',
    bottom: 60,
    alignSelf: 'center',
    color: 'rgba(255,255,255,0.3)',
    fontSize: 15,
    letterSpacing: 1,
  },
});
