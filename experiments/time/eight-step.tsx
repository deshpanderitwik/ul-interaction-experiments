import { useClock } from '@shopify/react-native-skia';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useFrameCallback, useSharedValue, runOnJS } from 'react-native-reanimated';
import { useExperimentActive } from '../_host';
import { useSharedClock } from '../combinations/clock';
import { useTempo } from '../tempo';

// Time · Eight Step — the loop clock locked to 8 bars, so the ring is divided into
// eight big steps (one per bar). Same carry-forward clock (accumulated phase, no
// pause/jump), but the stops are large and button-like — the first hint that these
// steps want to be tapped. The hand sweeps once per 8 bars; a step lights as it's
// reached and the current one glows.

const STEPS = 8; // 8 bars, one step per bar
const BEATS_PER_BAR = 4;
const DOT = 30; // large, tappable-feeling step
const ACCENT = '#a0b4ff';

export default function EightStep() {
  const live = useExperimentActive();
  const tempo = useTempo();
  const localClock = useClock();
  const sharedClock = useSharedClock();
  const clock = sharedClock ?? localClock;
  const { width, height } = useWindowDimensions();

  const cx = width / 2;
  const cy = height * 0.42;
  const R = Math.min(width * 0.36, height * 0.26);

  const [loopStep, setLoopStep] = useState(0); // which of the 8 steps is playing
  const [curBeat, setCurBeat] = useState(1); // beat within the current bar

  const tempoSV = useSharedValue(tempo);
  const phase = useSharedValue(0); // 0..1 across the 8-bar loop (accumulated)
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
    const loopMs = STEPS * BEATS_PER_BAR * beatMs; // 8 bars
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
    const beat = (Math.floor(ph * STEPS * BEATS_PER_BAR) % BEATS_PER_BAR) + 1;
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
      return { x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang) };
    });
  }, [cx, cy, R]);

  const handStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${phase.value * 360}deg` }] }));

  return (
    <View style={styles.fill}>
      <Text style={styles.title}>TIME · EIGHT STEP</Text>

      {/* ring outline */}
      <View
        style={{ position: 'absolute', left: cx - R, top: cy - R, width: 2 * R, height: 2 * R, borderRadius: R, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)' }}
        pointerEvents="none"
      />

      {/* eight large step dots */}
      {dots.map((d, i) => {
        const current = i === loopStep;
        const passed = i <= loopStep;
        return (
          <View
            key={i}
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: d.x - DOT / 2,
              top: d.y - DOT / 2,
              width: DOT,
              height: DOT,
              borderRadius: DOT / 2,
              borderWidth: 1.5,
              borderColor: current ? ACCENT : passed ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.22)',
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

      <View style={styles.footer} pointerEvents="none">
        <Text style={styles.barsNum}>
          8 <Text style={styles.barsLabel}>STEPS</Text>
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  title: {
    position: 'absolute',
    top: 54,
    left: 0,
    right: 0,
    textAlign: 'center',
    color: 'rgba(255,255,255,0.45)',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2,
  },
  stepNum: { color: '#fff', fontSize: 56, fontWeight: '200', fontVariant: ['tabular-nums'], lineHeight: 60 },
  footer: { position: 'absolute', bottom: 84, left: 0, right: 0, alignItems: 'center' },
  barsNum: { color: ACCENT, fontSize: 30, fontWeight: '600', fontVariant: ['tabular-nums'] },
  barsLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 12, fontWeight: '700', letterSpacing: 1.5 },
});
