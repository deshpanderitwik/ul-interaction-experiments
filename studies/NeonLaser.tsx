import {
  BlurMask,
  Circle,
  SweepGradient,
  vec,
} from '@shopify/react-native-skia';
import { useDerivedValue } from 'react-native-reanimated';
import { type BurstProps, LIFE, RAINBOW } from './shared';

// Neon / laser: additive light. A white-hot core, a glowing rainbow ring,
// and a delayed echo ring — all blended with "plus" so overlaps sum toward
// white, and softened with BlurMask so they read as light, not vector art.
const clamp01 = (v: number) => {
  'worklet';
  return Math.min(1, Math.max(0, v));
};
const easeOut = (t: number) => {
  'worklet';
  return 1 - Math.pow(1 - t, 3);
};

export function NeonBurst({ index, waves, clock }: BurstProps) {
  const age = useDerivedValue(() => {
    const wv = waves.value[index];
    return wv.born < 0 ? 2 : (clock.value - wv.born) / LIFE;
  });
  const center = useDerivedValue(() => {
    clock.value; // recompute each frame to read the in-place position
    const wv = waves.value[index];
    return vec(wv.x, wv.y);
  });

  const ringR = useDerivedValue(() => 8 + easeOut(clamp01(age.value)) * 150);
  const ringW = useDerivedValue(() => 1 + (1 - clamp01(age.value)) * 11);
  const ringO = useDerivedValue(() => (age.value < 0 || age.value > 1 ? 0 : 1 - age.value));

  const echoR = useDerivedValue(() => 8 + easeOut(clamp01(age.value - 0.12)) * 165);
  const echoO = useDerivedValue(() => {
    const t = age.value - 0.12;
    return t < 0 || t > 1 ? 0 : (1 - t) * 0.7;
  });

  const coreR = useDerivedValue(() => (1 - clamp01(age.value * 2)) * 24 + 2);
  const coreO = useDerivedValue(() => (age.value < 0 ? 0 : Math.max(0, 1 - age.value * 3)));

  return (
    <>
      <Circle c={center} r={coreR} color="#ffffff" opacity={coreO} blendMode="plus">
        <BlurMask blur={12} style="solid" />
      </Circle>
      <Circle c={center} r={ringR} style="stroke" strokeWidth={ringW} opacity={ringO} blendMode="plus">
        <BlurMask blur={7} style="solid" />
        <SweepGradient c={center} colors={RAINBOW} />
      </Circle>
      <Circle c={center} r={echoR} style="stroke" strokeWidth={2} opacity={echoO} blendMode="plus">
        <BlurMask blur={4} style="solid" />
        <SweepGradient c={center} colors={RAINBOW} />
      </Circle>
    </>
  );
}
