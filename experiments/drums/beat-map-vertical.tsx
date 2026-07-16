import { Canvas, Group, Line, useClock, vec } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useDerivedValue } from 'react-native-reanimated';
import { useTempo } from '../tempo';

// Drums · Vertical Beat Map — the same territory as Beat Map, rotated: time flows
// top → bottom (matching the vertical kick/Three-Lanes lineage where the playhead
// falls), and the subdivision levels are columns instead of rows. Left to right
// the grid gets finer (bar → 1/4 → 1/8 → 1/16), then the triplet grid (1/8T,
// 1/16T) in amber. Tick length + brightness encode metric strength; a horizontal
// playhead descends the 2-bar loop. Pure visual, no sound.

const BEATS = 8; // 2 bars of 4/4
const TOP = 120;
const BOTTOM = 48;
const LEFT = 40; // beat-number gutter
const RIGHT = 16;

type Level = { label: string; per: number; triplet?: boolean; barsOnly?: boolean };
const LEVELS: Level[] = [
  { label: 'bar', per: 0, barsOnly: true },
  { label: '1/4', per: 1 },
  { label: '1/8', per: 2 },
  { label: '1/16', per: 4 },
  { label: '1/8T', per: 3, triplet: true },
  { label: '1/16T', per: 6, triplet: true },
];

function positionsFor(lvl: Level): number[] {
  if (lvl.barsOnly) return [0, 4];
  const out: number[] = [];
  for (let i = 0; i < BEATS * lvl.per; i++) out.push(i / lvl.per);
  return out;
}

// Metric weight 0..1: bar-aligned strongest, then beat, then finer offbeats.
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

type Tick = { x: number; xEnd: number; y: number; color: string };

export default function VerticalBeatMap() {
  const { width, height } = useWindowDimensions();
  const tempo = useTempo();
  const clock = useClock();

  const usableW = width - LEFT - RIGHT;
  const usableH = height - TOP - BOTTOM;
  const colW = usableW / LEVELS.length;
  const yOf = (beats: number) => TOP + (beats / BEATS) * usableH;
  const colX = (r: number) => LEFT + r * colW;

  // Full-width guides at every beat (brighter at bar lines) — the time skeleton.
  const guides = useMemo(() => {
    const g: { y: number; color: string; bar: boolean }[] = [];
    for (let b = 0; b <= BEATS; b++) {
      const onBar = b % 4 === 0;
      g.push({ y: yOf(b), color: onBar ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.055)', bar: onBar });
    }
    return g;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height]);

  // Every candidate hit position across all levels, as a horizontal tick.
  const ticks = useMemo(() => {
    const out: Tick[] = [];
    LEVELS.forEach((lvl, r) => {
      const x0 = colX(r) + colW * 0.09;
      positionsFor(lvl).forEach((pos) => {
        const w = weight(lvl, pos);
        const len = colW * (0.28 + 0.52 * w);
        const a = 0.14 + 0.82 * w;
        const color = lvl.triplet ? `rgba(255,176,92,${a})` : `rgba(255,255,255,${a})`;
        out.push({ x: x0, xEnd: x0 + len, y: yOf(pos), color });
      });
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height]);

  // Playhead descends: one pass = the 2-bar loop at the current tempo.
  const loopMs = (BEATS * 60000) / tempo;
  const playTransform = useDerivedValue(() => {
    const phase = (clock.value % loopMs) / loopMs;
    return [{ translateY: phase * usableH }];
  });

  const colHeaders = LEVELS.map((lvl, r) => ({
    label: lvl.label,
    x: colX(r) + colW * 0.5 - 22,
    triplet: !!lvl.triplet,
  }));
  const beatNums = Array.from({ length: BEATS }, (_, b) => ({
    n: (b % 4) + 1,
    y: yOf(b) - 7,
    bar: b % 4 === 0,
  }));

  return (
    <View style={styles.fill}>
      <Canvas style={StyleSheet.absoluteFill}>
        {guides.map((g, i) => (
          <Line key={`g${i}`} p1={vec(LEFT - 6, g.y)} p2={vec(width - RIGHT, g.y)} color={g.color} strokeWidth={g.bar ? 1.5 : 1} />
        ))}
        {ticks.map((t, i) => (
          <Line key={`t${i}`} p1={vec(t.x, t.y)} p2={vec(t.xEnd, t.y)} color={t.color} strokeWidth={2} />
        ))}
        <Group transform={playTransform}>
          <Line p1={vec(LEFT - 6, TOP)} p2={vec(width - RIGHT, TOP)} color="rgba(120,220,255,0.85)" strokeWidth={2} />
        </Group>
      </Canvas>

      {colHeaders.map((c, i) => (
        <Text key={`c${i}`} style={[styles.colHeader, { left: c.x, color: c.triplet ? 'rgba(255,176,92,0.8)' : 'rgba(255,255,255,0.6)' }]}>
          {c.label}
        </Text>
      ))}
      {beatNums.map((b, i) => (
        <Text key={`b${i}`} style={[styles.beatNum, { top: b.y, opacity: b.bar ? 0.85 : 0.4 }]}>
          {b.n}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  colHeader: {
    position: 'absolute',
    top: TOP - 24,
    width: 44,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  beatNum: {
    position: 'absolute',
    left: 10,
    width: 20,
    textAlign: 'center',
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});
