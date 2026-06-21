import { Points, vec } from '@shopify/react-native-skia';
import { useDerivedValue } from 'react-native-reanimated';
import { type BurstProps, LIFE, RAINBOW } from './shared';

// Fireworks / debris: particle shards spray outward from the impact, biased
// inward off the wall (via the stored normal) and pulled by a little gravity.
// Particles are batched into one Points node per color band for efficiency,
// additively blended so the spray glows.
const COLORS = RAINBOW.slice(0, 7);
const PER = 3; // particles per color band → 21 per burst
const REACH = 175;

const clamp01 = (v: number) => {
  'worklet';
  return Math.min(1, Math.max(0, v));
};
const easeOut = (t: number) => {
  'worklet';
  return 1 - Math.pow(1 - t, 2);
};

function Band({ index, waves, clock, k }: BurstProps & { k: number }) {
  const points = useDerivedValue(() => {
    const wv = waves.value[index];
    const t = wv.born < 0 ? 2 : (clock.value - wv.born) / LIFE;
    const out: ReturnType<typeof vec>[] = [];
    if (t < 0 || t > 1) return out;
    const sp = 0.5 + Math.min(wv.speed / 1800, 1);
    for (let j = 0; j < PER; j++) {
      const idx = k * PER + j;
      const a = wv.seed * 6.283 + idx * 2.3994; // golden-angle-ish spread
      let dx = Math.cos(a) * 0.7 + wv.nx;
      let dy = Math.sin(a) * 0.7 + wv.ny;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      const dist = easeOut(t) * REACH * sp * (0.6 + (idx % 3) * 0.2);
      out.push(vec(wv.x + dx * dist, wv.y + dy * dist + 90 * t * t));
    }
    return out;
  });
  const opacity = useDerivedValue(() => {
    const wv = waves.value[index];
    const t = wv.born < 0 ? 2 : (clock.value - wv.born) / LIFE;
    return t < 0 || t > 1 ? 0 : 1 - t;
  });
  const sw = useDerivedValue(() => {
    const wv = waves.value[index];
    const t = clamp01(wv.born < 0 ? 2 : (clock.value - wv.born) / LIFE);
    return 1.5 + (1 - t) * 6;
  });

  return (
    <Points
      points={points}
      mode="points"
      color={COLORS[k]}
      style="stroke"
      strokeWidth={sw}
      strokeCap="round"
      opacity={opacity}
      blendMode="plus"
    />
  );
}

export function FireBurst(props: BurstProps) {
  return (
    <>
      {COLORS.map((_, k) => (
        <Band key={k} {...props} k={k} />
      ))}
    </>
  );
}
