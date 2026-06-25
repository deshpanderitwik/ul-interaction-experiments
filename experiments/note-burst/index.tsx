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
import { DOT_COLORS, F_MINOR, pluck, randItem } from './shared';

// Note Burst — tap anywhere to fire a burst of notes randomly sampled from the
// F minor scale, with a matching shower of tiny dots exploding from the tap.
// Particle motion runs on the UI thread: each dot's position/size/opacity is a
// derived value off a single shared Skia clock, so the React tree only changes
// when dots spawn or expire (not every frame).

const MAX_DOTS = 500; // safety cap across overlapping bursts

type Dot = {
  id: number;
  x0: number;
  y0: number;
  dx: number;
  dy: number;
  gravity: number;
  size: number;
  color: string;
  born: number; // clock ms at spawn
  life: number; // ms
};

export default function NoteBurst() {
  const live = useExperimentActive();
  const clock = useClock();
  const [dots, setDots] = useState<Dot[]>([]);
  const nextId = useRef(0);

  const spawnBurst = (x: number, y: number) => {
    const count = 5 + ((Math.random() * 4) | 0); // 5..8 notes

    // Audio: notes sampled from F minor, lightly staggered into a burst.
    for (let k = 0; k < count; k++) {
      const freq = randItem(F_MINOR);
      const gain = 0.5 + Math.random() * 0.4;
      setTimeout(() => pluck(freq, gain), Math.random() * 90);
    }

    // Visual: a cloud of tiny dots flung radially from the tap point.
    const now = clock.value;
    const dotCount = count * 4;
    const fresh: Dot[] = [];
    for (let k = 0; k < dotCount; k++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 40 + Math.random() * 130;
      fresh.push({
        id: nextId.current++,
        x0: x,
        y0: y,
        dx: Math.cos(angle) * dist,
        dy: Math.sin(angle) * dist,
        gravity: 30 + Math.random() * 50,
        size: 2 + Math.random() * 3,
        color: randItem(DOT_COLORS),
        born: now,
        life: 600 + Math.random() * 300,
      });
    }
    setDots((prev) => [...prev, ...fresh].slice(-MAX_DOTS));

    const ids = new Set(fresh.map((d) => d.id));
    setTimeout(() => setDots((prev) => prev.filter((d) => !ids.has(d.id))), 1000);
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
  const cy = useDerivedValue(
    () => dot.y0 + dot.dy * prog.value + dot.gravity * prog.value * prog.value
  );
  const r = useDerivedValue(() => Math.max(0, dot.size * (1 - 0.25 * prog.value)));
  const opacity = useDerivedValue(() => Math.max(0, 1 - prog.value));

  return <Circle cx={cx} cy={cy} r={r} color={dot.color} opacity={opacity} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  hint: { color: 'rgba(255,255,255,0.3)', fontSize: 16, letterSpacing: 1 },
});
