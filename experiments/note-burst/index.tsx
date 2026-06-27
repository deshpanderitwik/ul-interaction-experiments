import { Canvas, Circle, Path, useClock } from '@shopify/react-native-skia';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  runOnJS,
  useDerivedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { useExperimentActive } from '../_host';
import { useSettings } from '../settings';
import { pitchNorm, pluck, randItem, scalePool } from './shared';

// Note spacing is user-adjustable: 0 ms = all notes at once, up to 240 ms apart.
const SETTINGS = {
  spacing: {
    type: 'slider',
    label: 'Note spacing',
    min: 0,
    max: 240,
    step: 10,
    unit: 'ms',
    default: 80,
  },
} as const;

// Note Burst — tap to fire a burst of notes randomly sampled from F minor. The
// visual is driven directly by the notes: each note, the moment it sounds, emits
// a white puff whose horizontal position encodes WHEN it fires (gaps between
// puffs == time spacing between notes) and vertical position encodes its pitch.
// A faint white line threads the note points in time order, so the burst reads
// as a melodic contour. Motion runs on the UI thread off a shared Skia clock.

const MAX_DOTS = 500; // safety cap across overlapping bursts
const MAX_LINES = 12;
const PX_PER_MS = 0.22; // horizontal pixels per ms of note timing
const PITCH_SPAN = 220; // vertical pixels across the pitch range
const DOTS_PER_NOTE = 5;

type Dot = {
  id: number;
  x0: number;
  y0: number;
  dx: number;
  dy: number;
  size: number;
  born: number; // clock ms at spawn
  life: number; // ms
};

type BurstLine = {
  id: number;
  born: number;
  life: number;
  pts: { x: number; y: number }[];
};

export default function NoteBurst() {
  const live = useExperimentActive();
  const { spacing } = useSettings(SETTINGS);
  const clock = useClock();
  const [dots, setDots] = useState<Dot[]>([]);
  const [lines, setLines] = useState<BurstLine[]>([]);
  const nextId = useRef(0);
  const nextLineId = useRef(0);

  // One note's worth of dots: a small white radial puff at the note's (x, y),
  // sized by loudness, spawned the instant the note sounds.
  const spawnNoteDots = (ox: number, oy: number, baseSize: number) => {
    const now = clock.value;
    const fresh: Dot[] = [];
    for (let j = 0; j < DOTS_PER_NOTE; j++) {
      const a = Math.random() * Math.PI * 2;
      const d = 8 + Math.random() * 26;
      fresh.push({
        id: nextId.current++,
        x0: ox,
        y0: oy,
        dx: Math.cos(a) * d,
        dy: Math.sin(a) * d,
        size: baseSize * (0.7 + Math.random() * 0.6),
        born: now,
        life: 650 + Math.random() * 300,
      });
    }
    setDots((prev) => [...prev, ...fresh].slice(-MAX_DOTS));
    const ids = new Set(fresh.map((p) => p.id));
    setTimeout(() => setDots((prev) => prev.filter((p) => !ids.has(p.id))), 1100);
  };

  const spawnBurst = (x: number, y: number) => {
    const pool = scalePool();
    if (pool.length === 0) return;
    const lo = pool[0];
    const hi = pool[pool.length - 1];

    const count = 5 + ((Math.random() * 4) | 0); // 5..8 notes
    // Center the time-sequence horizontally on the tap so it stays on-screen.
    const centerDelay = ((count - 1) * spacing) / 2;

    const lineId = nextLineId.current++;
    const lineLife = (count - 1) * spacing + 1200;
    setLines((prev) =>
      [...prev, { id: lineId, born: clock.value, life: lineLife, pts: [] }].slice(-MAX_LINES)
    );

    for (let k = 0; k < count; k++) {
      const freq = randItem(pool);
      const gain = 0.5 + Math.random() * 0.4;
      const delay = k * spacing + Math.random() * 25;

      // Position derived from the note: X from its onset time, Y from its pitch.
      const ox = x + (delay - centerDelay) * PX_PER_MS;
      const oy = y - (pitchNorm(freq, lo, hi) - 0.5) * PITCH_SPAN;
      const size = 2 + gain * 4;

      setTimeout(() => {
        pluck(freq, gain);
        spawnNoteDots(ox, oy, size);
        setLines((prev) =>
          prev.map((l) => (l.id === lineId ? { ...l, pts: [...l.pts, { x: ox, y: oy }] } : l))
        );
      }, delay);
    }

    setTimeout(() => setLines((prev) => prev.filter((l) => l.id !== lineId)), lineLife);
  };

  // Clear anything lingering when the screen goes off/background.
  useEffect(() => {
    if (!live) {
      setDots([]);
      setLines([]);
    }
  }, [live]);

  const tap = Gesture.Tap().onBegin((e) => {
    if (!live) return;
    runOnJS(spawnBurst)(e.x, e.y);
  });

  return (
    <GestureDetector gesture={tap}>
      <View style={styles.fill}>
        <Canvas style={StyleSheet.absoluteFill}>
          {lines.map((l) => (
            <BurstLineView key={l.id} line={l} clock={clock} />
          ))}
          {dots.map((d) => (
            <Particle key={d.id} dot={d} clock={clock} />
          ))}
        </Canvas>
        <Text style={styles.hint}>tap to burst</Text>
      </View>
    </GestureDetector>
  );
}

function Particle({ dot, clock }: { dot: Dot; clock: SharedValue<number> }) {
  // Ease-out progress 0→1 over the dot's life.
  const prog = useDerivedValue(() => {
    const t = Math.min(1, (clock.value - dot.born) / dot.life);
    return 1 - (1 - t) * (1 - t);
  });
  const cx = useDerivedValue(() => dot.x0 + dot.dx * prog.value);
  const cy = useDerivedValue(() => dot.y0 + dot.dy * prog.value);
  const r = useDerivedValue(() => Math.max(0, dot.size * (1 - 0.25 * prog.value)));
  const opacity = useDerivedValue(() => Math.max(0, 1 - prog.value));

  return <Circle cx={cx} cy={cy} r={r} color="white" opacity={opacity} />;
}

function BurstLineView({ line, clock }: { line: BurstLine; clock: SharedValue<number> }) {
  // Faint fade-in then fade-out over the burst's life.
  const opacity = useDerivedValue(() => {
    const age = clock.value - line.born;
    const t = age / line.life;
    if (t >= 1) return 0;
    const fadeIn = Math.min(1, age / 140);
    const fadeOut = t > 0.6 ? Math.max(0, 1 - (t - 0.6) / 0.4) : 1;
    return 0.3 * fadeIn * fadeOut;
  });

  if (line.pts.length < 2) return null;
  // Order points left-to-right (i.e. by time) so the contour reads cleanly even
  // if onset jitter reorders adjacent notes.
  const sorted = [...line.pts].sort((a, b) => a.x - b.x);
  const d = sorted.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  return (
    <Path
      path={d}
      style="stroke"
      color="white"
      strokeWidth={1.5}
      strokeJoin="round"
      strokeCap="round"
      opacity={opacity}
    />
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  hint: { color: 'rgba(255,255,255,0.3)', fontSize: 16, letterSpacing: 1 },
});
