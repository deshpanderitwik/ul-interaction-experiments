import { useClock } from '@shopify/react-native-skia';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useFrameCallback, useSharedValue, runOnJS } from 'react-native-reanimated';
import { useExperimentActive } from '../_host';
import { useSharedClock } from '../combinations/clock';
import { useTempo } from '../tempo';

// Time · Loop — the most primitive thing: a chunk of time you can watch. A hand
// sweeps a ring once per loop while a dot per beat fills in behind it; the center
// counts the bar and beat. At the end of the specified number of bars it snaps
// back to 0 and counts up again. Set the loop length with − / +. It rides the
// shared clock, so this same loop can later phase-lock everything else.

const BEATS_PER_BAR = 4;
const MIN_BARS = 1;
const MAX_BARS = 8;
const ACCENT = '#a0b4ff';

export default function TimeLoop() {
  const live = useExperimentActive();
  const tempo = useTempo();
  const localClock = useClock();
  const sharedClock = useSharedClock();
  const clock = sharedClock ?? localClock;
  const { width, height } = useWindowDimensions();

  const cx = width / 2;
  const cy = height * 0.42;
  const R = Math.min(width * 0.36, height * 0.26);

  const [bars, setBars] = useState(4);
  const [loopBeat, setLoopBeat] = useState(0); // beat index within the loop
  const total = bars * BEATS_PER_BAR;

  const tempoSV = useSharedValue(tempo);
  const barsSV = useSharedValue(bars);
  const progress = useSharedValue(0);
  const lastBeat = useSharedValue(-1);
  useEffect(() => {
    tempoSV.value = tempo;
    barsSV.value = bars;
  }, [tempo, bars, tempoSV, barsSV]);

  const frame = useFrameCallback(() => {
    'worklet';
    const now = clock.value;
    const beatMs = 60000 / tempoSV.value;
    const t = barsSV.value * BEATS_PER_BAR;
    const loopMs = t * beatMs;
    progress.value = (now % loopMs) / loopMs;
    const gBeat = Math.floor(now / beatMs);
    const lb = ((gBeat % t) + t) % t;
    if (lb !== lastBeat.value) {
      lastBeat.value = lb;
      runOnJS(setLoopBeat)(lb);
    }
  }, false);

  useEffect(() => {
    lastBeat.value = -1;
    frame.setActive(live);
    return () => frame.setActive(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, frame]);

  // Beat dots around the ring (larger at bar boundaries).
  const dots = useMemo(() => {
    return Array.from({ length: total }, (_, i) => {
      const ang = (i / total) * 2 * Math.PI - Math.PI / 2;
      return { x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang), bar: i % BEATS_PER_BAR === 0 };
    });
  }, [total, cx, cy, R]);

  const handStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${progress.value * 360}deg` }] }));

  const curBar = Math.floor(loopBeat / BEATS_PER_BAR) + 1;
  const curBeat = (loopBeat % BEATS_PER_BAR) + 1;

  return (
    <View style={styles.fill}>
      <Text style={styles.title}>TIME · LOOP</Text>

      {/* ring outline */}
      <View
        style={{ position: 'absolute', left: cx - R, top: cy - R, width: 2 * R, height: 2 * R, borderRadius: R, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)' }}
        pointerEvents="none"
      />

      {/* beat dots (fill as the loop counts up) */}
      {dots.map((d, i) => {
        const lit = i <= loopBeat;
        const size = d.bar ? 10 : 6;
        return (
          <View
            key={i}
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: d.x - size / 2,
              top: d.y - size / 2,
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: lit ? (d.bar ? ACCENT : '#fff') : 'rgba(255,255,255,0.16)',
            }}
          />
        );
      })}

      {/* sweeping hand */}
      <Animated.View style={[{ position: 'absolute', left: cx, top: cy, width: 0, height: 0 }, handStyle]} pointerEvents="none">
        <View style={{ position: 'absolute', left: -1.5, top: -R, width: 3, height: R, borderRadius: 1.5, backgroundColor: '#fff' }} />
        <View style={{ position: 'absolute', left: -4.5, top: -R - 4.5, width: 9, height: 9, borderRadius: 4.5, backgroundColor: '#fff' }} />
      </Animated.View>
      <View style={{ position: 'absolute', left: cx - 4, top: cy - 4, width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.5)' }} pointerEvents="none" />

      {/* readout below the clock so it's never hidden by the hand */}
      <View style={{ position: 'absolute', left: cx - 80, top: cy + R + 24, width: 160, alignItems: 'center' }} pointerEvents="none">
        <Text style={styles.barNum}>{curBar}</Text>
        <View style={{ flexDirection: 'row', marginTop: 6 }}>
          {Array.from({ length: BEATS_PER_BAR }, (_, i) => (
            <View
              key={i}
              style={{ width: 7, height: 7, borderRadius: 3.5, marginHorizontal: 3, backgroundColor: i + 1 === curBeat ? '#fff' : 'rgba(255,255,255,0.2)' }}
            />
          ))}
        </View>
      </View>

      {/* loop length control */}
      <View style={styles.controls}>
        <Pressable
          onPress={() => setBars((b) => Math.max(MIN_BARS, b - 1))}
          style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
        >
          <Text style={styles.btnText}>−</Text>
        </Pressable>
        <View style={styles.barsReadout}>
          <Text style={styles.barsNum}>{bars}</Text>
          <Text style={styles.barsLabel}>{bars === 1 ? 'BAR' : 'BARS'}</Text>
        </View>
        <Pressable
          onPress={() => setBars((b) => Math.min(MAX_BARS, b + 1))}
          style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
        >
          <Text style={styles.btnText}>+</Text>
        </Pressable>
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
  barNum: { color: '#fff', fontSize: 56, fontWeight: '200', fontVariant: ['tabular-nums'], lineHeight: 60 },
  controls: {
    position: 'absolute',
    bottom: 90,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  btn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPressed: { backgroundColor: 'rgba(255,255,255,0.1)' },
  btnText: { color: '#fff', fontSize: 26, fontWeight: '300', lineHeight: 30 },
  barsReadout: { width: 96, alignItems: 'center' },
  barsNum: { color: ACCENT, fontSize: 28, fontWeight: '600', fontVariant: ['tabular-nums'] },
  barsLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: '700', letterSpacing: 1.5 },
});
