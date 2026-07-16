import { Canvas, Group, Line, useClock, vec } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useDerivedValue } from 'react-native-reanimated';
import { useTempo } from '../tempo';

// Drums · Beat Map — a pure visual (no sound). It lays out the *territory* we're
// trying to model: every place a hit can land inside a 2-bar loop, and how strong
// each place is. Reading top to bottom the grid gets finer (bar → 1/4 → 1/8 →
// 1/16), then the triplet grid (1/8T, 1/16T) in amber — the "other" lattice that
// doesn't line up with the straight one. Taller/brighter ticks = metrically
// stronger positions (a downbeat vs the last sixteenth of a beat), which is where
// accents naturally want to fall. A playhead sweeps the loop for time context.

const BEATS = 8; // 2 bars of 4/4
const TOP = 134;
const BOTTOM = 60;
const LEFT = 54;
const RIGHT = 22;

type Level = { label: string; per: number; triplet?: boolean; barsOnly?: boolean };
const LEVELS: Level[] = [
  { label: 'bar', per: 0, barsOnly: true },
  { label: '1/4', per: 1 },
  { label: '1/8', per: 2 },
  { label: '1/16', per: 4 },
  { label: '1/8T', per: 3, triplet: true },
  { label: '1/16T', per: 6, triplet: true },
];

// Positions (in beats, 0 ≤ x < 8) for a level.
function positionsFor(lvl: Level): number[] {
  if (lvl.barsOnly) return [0, 4];
  const out: number[] = [];
  for (let i = 0; i < BEATS * lvl.per; i++) out.push(i / lvl.per);
  return out;
}

// Metric weight 0..1 of a position: bar-aligned strongest, then beat, then the
// finer offbeats. Drives tick height + opacity.
function weight(lvl: Level, x: number): number {
  const onBar = x % 4 === 0;
  const onBeat = Number.isInteger(x);
  if (lvl.barsOnly) return 1;
  if (lvl.label === '1/4') return onBar ? 1 : 0.78;
  if (lvl.label === '1/8') return onBeat ? 0.6 : 0.36;
  if (lvl.label === '1/16') return onBeat ? 0.5 : 0.22;
  if (lvl.label === '1/8T') return onBeat ? 0.62 : 0.32;
  return onBeat ? 0.44 : 0.2; // 1/16T
}

type Tick = { x1: number; y: number; top: number; color: string };

export default function BeatMap() {
  const { width, height } = useWindowDimensions();
  const tempo = useTempo();
  const clock = useClock();

  const usableW = width - LEFT - RIGHT;
  const usableH = height - TOP - BOTTOM;
  const bandH = usableH / LEVELS.length;
  const xOf = (beats: number) => LEFT + (beats / BEATS) * usableW;

  // Full-height guides at every beat (brighter at bar lines) — the skeleton the
  // rows hang on, so vertical alignment reads as metric strength.
  const guides = useMemo(() => {
    const g: { x: number; color: string; bar: boolean }[] = [];
    for (let b = 0; b <= BEATS; b++) {
      const onBar = b % 4 === 0;
      g.push({ x: xOf(b), color: onBar ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.055)', bar: onBar });
    }
    return g;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height]);

  // Every candidate hit position across all levels, as a vertical tick.
  const ticks = useMemo(() => {
    const out: Tick[] = [];
    LEVELS.forEach((lvl, r) => {
      const baseline = TOP + r * bandH + bandH * 0.82;
      positionsFor(lvl).forEach((x) => {
        const w = weight(lvl, x);
        const h = bandH * (0.32 + 0.5 * w);
        const a = 0.14 + 0.82 * w;
        const color = lvl.triplet ? `rgba(255,176,92,${a})` : `rgba(255,255,255,${a})`;
        out.push({ x1: xOf(x), y: baseline, top: baseline - h, color });
      });
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height]);

  // Sweeping playhead: one pass = the 2-bar loop at the current tempo.
  const loopMs = (BEATS * 60000) / tempo;
  const playTransform = useDerivedValue(() => {
    const phase = (clock.value % loopMs) / loopMs;
    return [{ translateX: phase * usableW }];
  });

  // Row labels + beat numbers, positioned with the same geometry (RN text; Skia
  // text would need a bundled font).
  const rowLabels = LEVELS.map((lvl, r) => ({
    label: lvl.label,
    y: TOP + r * bandH + bandH * 0.82 - 13,
    triplet: !!lvl.triplet,
  }));
  const beatNums = Array.from({ length: BEATS }, (_, b) => ({
    n: (b % 4) + 1,
    x: xOf(b),
    bar: b % 4 === 0,
  }));

  return (
    <View style={styles.fill}>
      <Canvas style={StyleSheet.absoluteFill}>
        {guides.map((g, i) => (
          <Line key={`g${i}`} p1={vec(g.x, TOP - 8)} p2={vec(g.x, height - BOTTOM)} color={g.color} strokeWidth={g.bar ? 1.5 : 1} />
        ))}
        {ticks.map((t, i) => (
          <Line key={`t${i}`} p1={vec(t.x1, t.y)} p2={vec(t.x1, t.top)} color={t.color} strokeWidth={2} />
        ))}
        <Group transform={playTransform}>
          <Line p1={vec(LEFT, TOP - 8)} p2={vec(LEFT, height - BOTTOM)} color="rgba(120,220,255,0.85)" strokeWidth={2} />
        </Group>
      </Canvas>

      {beatNums.map((b, i) => (
        <Text
          key={`b${i}`}
          style={[styles.beatNum, { left: b.x - 6, opacity: b.bar ? 0.85 : 0.4 }]}
        >
          {b.n}
        </Text>
      ))}
      {rowLabels.map((r, i) => (
        <Text key={`r${i}`} style={[styles.rowLabel, { top: r.y, color: r.triplet ? 'rgba(255,176,92,0.8)' : 'rgba(255,255,255,0.6)' }]}>
          {r.label}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  beatNum: {
    position: 'absolute',
    top: TOP - 26,
    width: 16,
    textAlign: 'center',
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  rowLabel: {
    position: 'absolute',
    left: 10,
    width: 40,
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
});
