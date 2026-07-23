import { useClock } from '@shopify/react-native-skia';
import { useEffect } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { runOnJS, useAnimatedStyle, useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { useExperimentActive } from '../_host';
import { useSharedClock } from '../combinations/clock';
import { useTempo } from '../tempo';
import { playClap, playHat, playKick, playSnare, playTom } from './voice';

// Drums · Analysis — reverse-engineering a real sequenced drum part. This is a
// transcription of a deadmau5-style electro-house drop groove (Ghosts 'n' Stuff
// territory): four-on-the-floor kick, backbeat clap, the signature off-beat open
// hats, a 16th closed-hat pattern woven around them, ghost snares, and a bar-4
// snare-roll fill. It plays locked to the clock and draws itself as a vertical
// piano-roll (time flows down, velocity = brightness) so we can study the shape
// and work backwards to the interactions that would let someone *build* this.
// The pattern is a plain data structure — swap in a real .mid transcription and
// the renderer is unchanged.

const STEPS_PER_BAR = 16; // 1/16 resolution
const BARS = 4;
const STEPS = STEPS_PER_BAR * BARS;

type Lanes = { kick: number[]; snare: number[]; clap: number[]; chat: number[]; ohat: number[]; perc: number[] };

function buildPattern(): Lanes {
  const z = () => new Array(STEPS).fill(0);
  const kick = z();
  const snare = z();
  const clap = z();
  const chat = z();
  const ohat = z();
  const perc = z();
  for (let bar = 0; bar < BARS; bar++) {
    const o = bar * STEPS_PER_BAR;
    // Four-on-the-floor kick (a touch stronger on the "1").
    [0, 4, 8, 12].forEach((s) => (kick[o + s] = s === 0 ? 1.0 : 0.92));
    // Backbeat clap on 2 & 4.
    clap[o + 4] = 0.85;
    clap[o + 12] = 0.85;
    // Signature off-beat open hats on the "and" of every beat.
    [2, 6, 10, 14].forEach((s) => (ohat[o + s] = 0.62));
    // Driving 16th closed hats around the open hats, accented on the beats.
    for (let s = 0; s < 16; s++) {
      if (s === 2 || s === 6 || s === 10 || s === 14) continue;
      chat[o + s] = s % 4 === 0 ? 0.5 : s % 2 === 0 ? 0.38 : 0.28;
    }
    // Ghost snares add syncopation in the non-fill bars.
    if (bar < 3) {
      snare[o + 7] = 0.26;
      snare[o + 15] = 0.3;
    }
    // A syncopated perc hit every other bar for movement.
    if (bar === 1 || bar === 3) {
      perc[o + 6] = 0.45;
      perc[o + 11] = 0.4;
    }
  }
  // Bar 4 = a fill: clear the late open hats and lay a crescendo snare roll.
  const f = 3 * STEPS_PER_BAR;
  ohat[f + 10] = 0;
  ohat[f + 14] = 0;
  for (let s = 8; s < 16; s++) {
    const t = (s - 8) / 7;
    snare[f + s] = 0.35 + 0.6 * t;
  }
  return { kick, snare, clap, chat, ohat, perc };
}

const PATTERN = buildPattern();

const LANES: { key: keyof Lanes; name: string; color: string }[] = [
  { key: 'kick', name: 'KICK', color: '#ffffff' },
  { key: 'snare', name: 'SNR', color: '#ffd166' },
  { key: 'clap', name: 'CLAP', color: '#ff9db0' },
  { key: 'chat', name: 'CH', color: '#7ad0ff' },
  { key: 'ohat', name: 'OH', color: '#54f2b0' },
  { key: 'perc', name: 'PERC', color: '#c9a0ff' },
];

function fireStep(ls: number) {
  const p = PATTERN;
  if (p.kick[ls]) playKick(p.kick[ls]);
  if (p.snare[ls]) playSnare(0.15 + 0.7 * p.snare[ls]);
  if (p.clap[ls]) playClap(0.2 + 0.6 * p.clap[ls]);
  if (p.chat[ls]) playHat(false, 0.08 + 0.42 * p.chat[ls]);
  if (p.ohat[ls]) playHat(true, 0.1 + 0.4 * p.ohat[ls]);
  if (p.perc[ls]) playTom(200, 0.2 + 0.6 * p.perc[ls]);
}

export default function Analysis() {
  const live = useExperimentActive();
  const tempo = useTempo();
  const localClock = useClock();
  const sharedClock = useSharedClock();
  const clock = sharedClock ?? localClock;
  const { width, height } = useWindowDimensions();

  const HEADER = 58;
  const BOTTOM = 64;
  const gridLeft = 10;
  const gridTop = HEADER;
  const gridW = width - gridLeft * 2;
  const gridH = height - HEADER - BOTTOM;
  const colW = gridW / LANES.length;
  const rowH = gridH / STEPS;

  const tempoSV = useSharedValue(tempo);
  useEffect(() => {
    tempoSV.value = tempo;
  }, [tempo, tempoSV]);

  const playPos = useSharedValue(0);
  const lastStep = useSharedValue(-1);
  const started = useSharedValue(0);

  const frame = useFrameCallback(() => {
    'worklet';
    const now = clock.value;
    const stepMs = 60000 / tempoSV.value / 4;
    const loopMs = STEPS * stepMs;
    playPos.value = (now % loopMs) / loopMs;
    const g = Math.floor(now / stepMs);
    if (started.value === 0) {
      lastStep.value = g;
      started.value = 1;
      return;
    }
    if (g !== lastStep.value) {
      lastStep.value = g;
      const ls = ((g % STEPS) + STEPS) % STEPS;
      runOnJS(fireStep)(ls);
    }
  }, false);

  useEffect(() => {
    started.value = 0;
    frame.setActive(live);
    return () => frame.setActive(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, frame]);

  const playheadStyle = useAnimatedStyle(() => ({ transform: [{ translateY: playPos.value * gridH }] }));

  return (
    <View style={styles.fill}>
      <Text style={styles.title}>ANALYSIS · electro-house drop (transcribed)</Text>
      {/* lane headers */}
      {LANES.map((l, i) => (
        <Text key={l.key} style={[styles.laneName, { color: l.color, left: gridLeft + i * colW, width: colW }]}>
          {l.name}
        </Text>
      ))}

      <View style={{ position: 'absolute', left: gridLeft, top: gridTop, width: gridW, height: gridH }}>
        {/* beat / bar gridlines */}
        {Array.from({ length: STEPS / 4 + 1 }, (_, i) => {
          const s = i * 4;
          const isBar = s % STEPS_PER_BAR === 0;
          return (
            <View
              key={`h${i}`}
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: s * rowH,
                height: StyleSheet.hairlineWidth,
                backgroundColor: isBar ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.08)',
              }}
            />
          );
        })}
        {/* lane separators */}
        {LANES.map((_, i) => (
          <View
            key={`v${i}`}
            style={{ position: 'absolute', top: 0, bottom: 0, left: i * colW, width: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.06)' }}
          />
        ))}
        {/* hits */}
        {LANES.map((l, li) =>
          PATTERN[l.key].map((v, s) =>
            v > 0 ? (
              <View
                key={`${l.key}-${s}`}
                style={{
                  position: 'absolute',
                  left: li * colW + 1.5,
                  top: s * rowH + 0.5,
                  width: colW - 3,
                  height: Math.max(2, rowH - 1.5),
                  borderRadius: 2,
                  backgroundColor: l.color,
                  opacity: 0.22 + 0.78 * v,
                }}
              />
            ) : null
          )
        )}
        {/* playhead */}
        <Animated.View
          style={[{ position: 'absolute', left: 0, right: 0, top: 0, height: 2, backgroundColor: 'rgba(255,255,255,0.9)' }, playheadStyle]}
          pointerEvents="none"
        />
      </View>

      <Text style={styles.footnote}>4 bars · 1/16 grid · brightness = velocity · bar 4 is a fill</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  title: {
    position: 'absolute',
    top: 16,
    left: 10,
    right: 10,
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  laneName: {
    position: 'absolute',
    top: 38,
    textAlign: 'center',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  footnote: {
    position: 'absolute',
    bottom: 22,
    left: 10,
    right: 10,
    textAlign: 'center',
    color: 'rgba(255,255,255,0.35)',
    fontSize: 10,
    letterSpacing: 0.4,
  },
});
