import { useClock } from '@shopify/react-native-skia';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useFrameCallback, useSharedValue, runOnJS } from 'react-native-reanimated';
import { useExperimentActive } from '../_host';
import { useSharedClock } from '../combinations/clock';
import { useTempo } from '../tempo';

// Time · Sixteen Step — one bar of sixteenths wrapped onto the ring, sixteen stops
// in all. Each dot is sized by its metric weight: the downbeat is biggest, then
// beat 3 (the half-bar), then beats 2 & 4, then the 8th-note "ands," then the weak
// 16ths smallest — so the metric skeleton is legible before anything is even
// placed. Same carry-forward clock (accumulated phase); the hand sweeps once per
// bar, lighting each stop as it passes.

const STEPS = 16;
const BEATS_PER_BAR = 4;
const ACCENT = '#a0b4ff';

// Metric strength of a 16th position (0 weakest … 4 strongest) and its dot size.
function metricLevel(p: number) {
  if (p % 16 === 0) return 4; // bar downbeat (beat 1)
  if (p % 8 === 0) return 3; // beat 3 (half-bar)
  if (p % 4 === 0) return 2; // beats 2 & 4
  if (p % 2 === 0) return 1; // 8th-note offbeats ("ands")
  return 0; // weak 16ths
}
const SIZE = [11, 15, 20, 26, 34]; // by level

export default function SixteenStep() {
  const live = useExperimentActive();
  const tempo = useTempo();
  const localClock = useClock();
  const sharedClock = useSharedClock();
  const clock = sharedClock ?? localClock;
  const { width, height } = useWindowDimensions();

  const cx = width / 2;
  const cy = height * 0.42;
  const R = Math.min(width * 0.37, height * 0.27);

  const [loopStep, setLoopStep] = useState(0);
  const [curBeat, setCurBeat] = useState(1);

  const tempoSV = useSharedValue(tempo);
  const phase = useSharedValue(0); // 0..1 across one bar (accumulated)
  const prevNow = useSharedValue(0);
  const started = useSharedValue(0);
  const lastStep = useSharedValue(-1);
  const lastBeat = useSharedValue(-1);
  useEffect(() => {
    tempoSV.value = tempo;
  }, [tempo, tempoSV]);

  const frame = useFrameCallback(() => {
    'worklet';
    const now = clock.value;
    const beatMs = 60000 / tempoSV.value;
    const loopMs = BEATS_PER_BAR * beatMs; // one bar
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
    const step = Math.floor(ph * STEPS) % STEPS;
    if (step !== lastStep.value) {
      lastStep.value = step;
      runOnJS(setLoopStep)(step);
    }
    const beat = (Math.floor(ph * BEATS_PER_BAR) % BEATS_PER_BAR) + 1;
    if (beat !== lastBeat.value) {
      lastBeat.value = beat;
      runOnJS(setCurBeat)(beat);
    }
  }, false);

  useEffect(() => {
    started.value = 0;
    frame.setActive(live);
    return () => frame.setActive(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, frame]);

  const dots = useMemo(() => {
    return Array.from({ length: STEPS }, (_, i) => {
      const ang = (i / STEPS) * 2 * Math.PI - Math.PI / 2;
      return { x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang), size: SIZE[metricLevel(i)] };
    });
  }, [cx, cy, R]);

  const handStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${phase.value * 360}deg` }] }));

  return (
    <View style={styles.fill}>
      {/* ring outline */}
      <View
        style={{ position: 'absolute', left: cx - R, top: cy - R, width: 2 * R, height: 2 * R, borderRadius: R, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)' }}
        pointerEvents="none"
      />

      {/* sixteen step dots, sized by metric weight */}
      {dots.map((d, i) => {
        const current = i === loopStep;
        const passed = i <= loopStep;
        return (
          <View
            key={i}
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: d.x - d.size / 2,
              top: d.y - d.size / 2,
              width: d.size,
              height: d.size,
              borderRadius: d.size / 2,
              borderWidth: 1.5,
              borderColor: current ? ACCENT : passed ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.2)',
              backgroundColor: current ? ACCENT : passed ? 'rgba(255,255,255,0.9)' : 'transparent',
            }}
          />
        );
      })}

      {/* sweeping hand */}
      <Animated.View style={[{ position: 'absolute', left: cx, top: cy, width: 0, height: 0 }, handStyle]} pointerEvents="none">
        <View style={{ position: 'absolute', left: -1.5, top: -R, width: 3, height: R, borderRadius: 1.5, backgroundColor: '#fff' }} />
      </Animated.View>
      <View style={{ position: 'absolute', left: cx - 4, top: cy - 4, width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.5)' }} pointerEvents="none" />

      {/* readout below the clock */}
      <View style={{ position: 'absolute', left: cx - 80, top: cy + R + 34, width: 160, alignItems: 'center' }} pointerEvents="none">
        <Text style={styles.stepNum}>{loopStep + 1}</Text>
        <View style={{ flexDirection: 'row', marginTop: 6 }}>
          {Array.from({ length: BEATS_PER_BAR }, (_, i) => (
            <View
              key={i}
              style={{ width: 7, height: 7, borderRadius: 3.5, marginHorizontal: 3, backgroundColor: i + 1 === curBeat ? '#fff' : 'rgba(255,255,255,0.2)' }}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  stepNum: { color: '#fff', fontSize: 56, fontWeight: '200', fontVariant: ['tabular-nums'], lineHeight: 60 },
});
