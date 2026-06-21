import {
  BlurMask,
  Circle,
  RadialGradient,
  vec,
} from '@shopify/react-native-skia';
import { useDerivedValue } from 'react-native-reanimated';
import { type BurstProps, LIFE, RAINBOW } from './shared';

// Soft dreamy bloom: gauzy radial-gradient glows that bloom outward and fade.
// Additively ("plus") blended so they actually read as light on the near-black
// background — like the neon/fireworks/plasma treatments — while staying soft
// via a blur that scales with the current radius (crisp when small, gauzy when
// large), so the bright early frames aren't smeared into nothing. Three
// staggered hues give depth. The gradient radius is fixed (matching the working
// pattern in app/index.tsx) and only the clipping Circle expands, which reveals
// white core → colour → transparent edge as each glow grows.
const clamp01 = (v: number) => {
  'worklet';
  return Math.min(1, Math.max(0, v));
};
const easeOut = (t: number) => {
  'worklet';
  return 1 - Math.pow(1 - t, 2);
};

// fixed gradient radii — the max radius each layer's circle reaches
const G0 = 140;
const G1 = 200;
const G2 = 96;
const BLUR = 0.26; // BlurMask radius as a fraction of the current glow radius

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
    return t < 0 || t > 1 ? 0 : (1 - t) * 0.45;
  });
  const b0 = useDerivedValue(() => r0.value * BLUR);

  const r1 = useDerivedValue(() => 10 + easeOut(clamp01(ageAt(0))) * 190);
  const o1 = useDerivedValue(() => {
    const t = ageAt(0);
    return t < 0 || t > 1 ? 0 : (1 - t) * 0.3;
  });
  const b1 = useDerivedValue(() => r1.value * BLUR);

  const r2 = useDerivedValue(() => 6 + easeOut(clamp01(ageAt(90))) * 90);
  const o2 = useDerivedValue(() => {
    const t = ageAt(90);
    return t < 0 || t > 1 ? 0 : (1 - t) * 0.4;
  });
  const b2 = useDerivedValue(() => r2.value * BLUR);

  return (
    <>
      <Circle c={center} r={r1} opacity={o1} blendMode="plus">
        <BlurMask blur={b1} style="normal" />
        <RadialGradient c={center} r={G1} colors={['#ffffffaa', RAINBOW[5], '#3b5bff00']} />
      </Circle>
      <Circle c={center} r={r0} opacity={o0} blendMode="plus">
        <BlurMask blur={b0} style="normal" />
        <RadialGradient c={center} r={G0} colors={['#ffffffcc', RAINBOW[1], '#ff7a0000']} />
      </Circle>
      <Circle c={center} r={r2} opacity={o2} blendMode="plus">
        <BlurMask blur={b2} style="normal" />
        <RadialGradient c={center} r={G2} colors={['#ffffffdd', RAINBOW[6], '#b14bff00']} />
      </Circle>
    </>
  );
}
