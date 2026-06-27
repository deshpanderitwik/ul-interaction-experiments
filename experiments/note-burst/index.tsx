import { Canvas, Circle, useClock } from '@shopify/react-native-skia';
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
import { F_MINOR, colorForFreq, pitchNorm, pluck, randItem } from './shared';

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
// visual is driven directly by the notes: each note, the moment it sounds,
// emits its own puff of dots whose
//   - horizontal position encodes WHEN it fires (so gaps between puffs == the
//     time spacing between notes; the spacing slider visibly stretches it),
//   - vertical position encodes its pitch (higher note = higher), and
//   - color encodes pitch, size encodes loudness.
// Particle motion runs on the UI thread off a shared Skia clock, so the React
// tree only changes when dots spawn or expire.

const MAX_DOTS = 500; // safety cap across overlapping bursts
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
  color: string;
  born: number; // clock ms at spawn
  life: number; // ms
};

export default function NoteBurst() {
  const live = useExperimentActive();
  const { spacing } = useSettings(SETTINGS);
  const clock = useClock();
  const [dots, setDots] = useState<Dot[]>([]);
  const nextId = useRef(0);

  // One note's worth of dots: a small radial puff at the note's (x, y), colored
  // and sized by the note, spawned at the instant the note sounds.
  const spawnNoteDots = (ox: number, oy: number, color: string, baseSize: number) => {
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
        color,
        born: now,
        life: 650 + Math.random() * 300,
      });
    }
    setDots((prev) => [...prev, ...fresh].slice(-MAX_DOTS));
    const ids = new Set(fresh.map((p) => p.id));
    setTimeout(() => setDots((prev) => prev.filter((p) => !ids.has(p.id))), 1100);
  };

  const spawnBurst = (x: number, y: number) => {
    const count = 5 + ((Math.random() * 4) | 0); // 5..8 notes
    // Center the time-sequence horizontally on the tap so it stays on-screen.
    const centerDelay = ((count - 1) * spacing) / 2;

    for (let k = 0; k < count; k++) {
      const freq = randItem(F_MINOR);
      const gain = 0.5 + Math.random() * 0.4;
      const delay = k * spacing + Math.random() * 25;

      // Position derived from the note: X from its onset time, Y from its pitch.
      const ox = x + (delay - centerDelay) * PX_PER_MS;
      const oy = y - (pitchNorm(freq) - 0.5) * PITCH_SPAN;
      const color = colorForFreq(freq);
      const size = 2 + gain * 4;

      setTimeout(() => {
        pluck(freq, gain);
        spawnNoteDots(ox, oy, color, size);
      }, delay);
    }
  };

  // Clear any lingering dots when the screen goes off/background.
  useEffect(() => {
    if (!live) setDots([]);
  }, [live]);

  const tap = Gesture.Tap().onBegin((e) => {
    if (!live) return;
    runOnJS(spawnBurst)(e.x, e.y);
  });

  return (
    <GestureDetector gesture={tap}>
      <View style={styles.fill}>
        <Canvas style={StyleSheet.absoluteFill}>
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

  return <Circle cx={cx} cy={cy} r={r} color={dot.color} opacity={opacity} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  hint: { color: 'rgba(255,255,255,0.3)', fontSize: 16, letterSpacing: 1 },
});
