import {
  Blur,
  Canvas,
  Fill,
  Group,
  Path,
  Shader,
  Skia,
  useClock,
} from '@shopify/react-native-skia';
import { useEffect, useMemo, useState } from 'react';
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
  COL_SINE_RGB,
  COL_SQUARE_CSS,
  COL_SQUARE_RGB,
  layout,
  sineSymbolPath,
  squareSymbolPath,
  SHADER,
  type Cell,
} from './shared';
import { playSine, playSquare } from './voice';

// Duet — two "cells", each an instrument you toggle on/off:
//   A (sine):   the scale root, legato — a long-decay sine re-voiced on the
//               quarter-note so it sustains as a held drone.
//   B (square): the fifth above, pulsed — a square-ish buzz (additive odd
//               harmonics) struck every eighth-note.
// Each cell is a shader-rendered circle that shimmers and radiates while on and
// ripples on every sound. The sine cell carries a sine-wave glyph, the square
// cell a square-wave glyph. The only interaction is tapping a cell on/off.

export default function Duet() {
  const live = useExperimentActive();
  const { width, height } = useWindowDimensions();
  const scale = useScale();
  const tempo = useTempo();
  const clock = useClock();

  const cells = useMemo(() => layout(width, height), [width, height]);
  const source = useMemo(() => Skia.RuntimeEffect.Make(SHADER)!, []);
  const sinePath = useMemo(() => sineSymbolPath(cells.a), [cells.a]);
  const squarePath = useMemo(() => squareSymbolPath(cells.b), [cells.b]);

  const [aOn, setAOn] = useState(false);
  const [bOn, setBOn] = useState(false);

  // Eased on-amount (0..1) per cell, plus the timestamp (seconds) of each cell's
  // most recent sound (drives the ripple ring) and a short symbol pulse.
  const aOnV = useSharedValue(0);
  const bOnV = useSharedValue(0);
  const aRip = useSharedValue(-100);
  const bRip = useSharedValue(-100);
  const aPulse = useSharedValue(0);
  const bPulse = useSharedValue(0);

  useEffect(() => {
    aOnV.value = withTiming(aOn ? 1 : 0, { duration: 600, easing: Easing.out(Easing.cubic) });
  }, [aOn, aOnV]);
  useEffect(() => {
    bOnV.value = withTiming(bOn ? 1 : 0, { duration: 600, easing: Easing.out(Easing.cubic) });
  }, [bOn, bOnV]);

  // Root + fifth from the global scale, in a comfortable low-mid register
  // (C3 = MIDI 48). The fifth is +7 semitones in both major and minor.
  const rootMidi = 48 + scale.root;
  const rootFreq = midiToFreq(rootMidi);
  const fifthFreq = midiToFreq(rootMidi + 7);

  // Sine cell: legato root re-voiced on the quarter-note (long overlapping decay
  // → continuous drone).
  useEffect(() => {
    if (!live || !aOn) return;
    const quarterMs = 60000 / tempo;
    const tick = () => {
      playSine(rootFreq);
      aRip.value = clock.value / 1000;
      aPulse.value = 0;
      aPulse.value = withSequence(
        withTiming(1, { duration: 70, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: Math.max(90, quarterMs - 70), easing: Easing.out(Easing.quad) })
      );
    };
    tick();
    const h = setInterval(tick, quarterMs);
    return () => clearInterval(h);
  }, [live, aOn, tempo, rootFreq, clock, aRip, aPulse]);

  // Square cell: fifth struck on every eighth-note pulse.
  useEffect(() => {
    if (!live || !bOn) return;
    const eighthMs = 30000 / tempo;
    const tick = () => {
      playSquare(fifthFreq);
      bRip.value = clock.value / 1000;
      bPulse.value = 0;
      bPulse.value = withSequence(
        withTiming(1, { duration: 50, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: Math.max(80, eighthMs - 50), easing: Easing.out(Easing.quad) })
      );
    };
    tick();
    const h = setInterval(tick, eighthMs);
    return () => clearInterval(h);
  }, [live, bOn, tempo, fifthFreq, clock, bRip, bPulse]);

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

  const uniforms = useDerivedValue(
    () => ({
      u_time: clock.value / 1000,
      u_aC: [cells.a.cx, cells.a.cy],
      u_aR: cells.a.r,
      u_aOn: aOnV.value,
      u_aRip: aRip.value,
      u_aCol: COL_SINE_RGB,
      u_bC: [cells.b.cx, cells.b.cy],
      u_bR: cells.b.r,
      u_bOn: bOnV.value,
      u_bRip: bRip.value,
      u_bCol: COL_SQUARE_RGB,
    }),
    [cells]
  );

  return (
    <GestureDetector gesture={tap}>
      <View style={styles.fill}>
        <Canvas style={StyleSheet.absoluteFill}>
          <Fill>
            <Shader source={source} uniforms={uniforms} />
          </Fill>
          <WaveGlyph cell={cells.a} d={sinePath} glow={COL_SINE_CSS} onV={aOnV} pulse={aPulse} />
          <WaveGlyph cell={cells.b} d={squarePath} glow={COL_SQUARE_CSS} onV={bOnV} pulse={bPulse} />
        </Canvas>
        <Text style={styles.hint} pointerEvents="none">
          tap a cell to play
        </Text>
      </View>
    </GestureDetector>
  );
}

// A wave glyph centered in a cell: a soft blurred glow underlay plus a crisp
// white stroke. Brightens when its cell turns on and gives a small pop on each
// sound.
function WaveGlyph({
  cell,
  d,
  glow,
  onV,
  pulse,
}: {
  cell: Cell;
  d: string;
  glow: string;
  onV: SharedValue<number>;
  pulse: SharedValue<number>;
}) {
  const crispOpacity = useDerivedValue(() => 0.34 + 0.66 * onV.value);
  const glowOpacity = useDerivedValue(() => (0.2 + 0.55 * onV.value) * (0.7 + 0.3 * pulse.value));
  const transform = useDerivedValue(() => [{ scale: 1 + 0.07 * pulse.value }]);

  return (
    <Group transform={transform} origin={{ x: cell.cx, y: cell.cy }}>
      <Path
        path={d}
        style="stroke"
        strokeWidth={10}
        strokeJoin="round"
        strokeCap="round"
        color={glow}
        opacity={glowOpacity}
      >
        <Blur blur={8} />
      </Path>
      <Path
        path={d}
        style="stroke"
        strokeWidth={3.5}
        strokeJoin="round"
        strokeCap="round"
        color="white"
        opacity={crispOpacity}
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
