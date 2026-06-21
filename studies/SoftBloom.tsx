import {
  BlurMask,
  Circle,
  RadialGradient,
  vec,
} from '@shopify/react-native-skia';
import { useDerivedValue } from 'react-native-reanimated';
import { type BurstProps, LIFE, RAINBOW } from './shared';

// Soft dreamy bloom: gauzy radial-gradient glows, heavily blurred, low
// opacity, "screen" blended so they wash together like aurora/watercolor.
// Three staggered layers in different hues give depth without hard edges.
const clamp01 = (v: number) => {
  'worklet';
  return Math.min(1, Math.max(0, v));
};
const easeOut = (t: number) => {
  'worklet';
  return 1 - Math.pow(1 - t, 2);
};

export function BloomBurst({ index, waves, clock }: BurstProps) {
  const center = useDerivedValue(() => {
    clock.value;
    const wv = waves.value[index];
    return vec(wv.x, wv.y);
  });

  const ageAt = (delay: number) => {
    'worklet';
    const wv = waves.value[index];
    return wv.born < 0 ? 2 : (clock.value - wv.born - delay) / LIFE;
  };

  const r0 = useDerivedValue(() => 10 + easeOut(clamp01(ageAt(0))) * 130);
  const o0 = useDerivedValue(() => {
    const t = ageAt(0);
    return t < 0 || t > 1 ? 0 : (1 - t) * 0.55;
  });
  const r1 = useDerivedValue(() => 10 + easeOut(clamp01(ageAt(0))) * 190);
  const o1 = useDerivedValue(() => {
    const t = ageAt(0);
    return t < 0 || t > 1 ? 0 : (1 - t) * 0.4;
  });
  const r2 = useDerivedValue(() => 6 + easeOut(clamp01(ageAt(90))) * 90);
  const o2 = useDerivedValue(() => {
    const t = ageAt(90);
    return t < 0 || t > 1 ? 0 : (1 - t) * 0.5;
  });

  return (
    <>
      <Circle c={center} r={r1} opacity={o1} blendMode="screen">
        <BlurMask blur={42} style="normal" />
        <RadialGradient c={center} r={r1} colors={['#ffffffaa', RAINBOW[5], '#3b5bff00']} />
      </Circle>
      <Circle c={center} r={r0} opacity={o0} blendMode="screen">
        <BlurMask blur={28} style="normal" />
        <RadialGradient c={center} r={r0} colors={['#ffffffcc', RAINBOW[1], '#ff7a0000']} />
      </Circle>
      <Circle c={center} r={r2} opacity={o2} blendMode="screen">
        <BlurMask blur={20} style="normal" />
        <RadialGradient c={center} r={r2} colors={['#ffffffdd', RAINBOW[6], '#b14bff00']} />
      </Circle>
    </>
  );
}
