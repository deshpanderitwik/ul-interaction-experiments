import { Rect, Shader, Skia } from '@shopify/react-native-skia';
import { useDerivedValue } from 'react-native-reanimated';
import { type BurstProps, LIFE } from './shared';

// Procedural plasma: an SkSL runtime shader. An fbm-noise shell expands from
// the impact, hue-cycled and chromatic, drawn additively. The most organic
// and GPU-driven of the studies. Bounded to a box around the impact so we
// don't shade the whole screen per burst.
const RB = 180; // half-size of the shader box

const SOURCE = Skia.RuntimeEffect.Make(`
uniform float2 u_center;
uniform float  u_age;   // 0..1
uniform float  u_seed;

float hash(float2 p){ return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453); }
float noise(float2 p){
  float2 i = floor(p), f = fract(p);
  float2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + float2(1.0, 0.0)), u.x),
             mix(hash(i + float2(0.0, 1.0)), hash(i + float2(1.0, 1.0)), u.x), u.y);
}
float fbm(float2 p){
  float v = 0.0; float a = 0.5;
  for (int i = 0; i < 5; i++){ v += a * noise(p); p *= 2.0; a *= 0.5; }
  return v;
}
float3 hue(float h){
  float3 p = abs(mod(h * 6.0 + float3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0;
  return clamp(p, 0.0, 1.0);
}
half4 main(float2 pos){
  float2 d = pos - u_center;
  float r = length(d);
  float radius = mix(10.0, 165.0, u_age);
  float shell = smoothstep(radius, radius * 0.55, r) * smoothstep(radius * 0.18, radius * 0.55, r);
  float n = fbm(d * 0.04 + float2(u_seed * 17.0, u_age * 3.0));
  float intensity = shell * (0.35 + 0.9 * n) * (1.0 - u_age);
  float h = fract(u_seed + r * 0.0035 + u_age * 0.25);
  float3 col = hue(h) * intensity * 2.2;
  return half4(half3(col), half(intensity));
}
`);

export function PlasmaBurst({ index, waves, clock }: BurstProps) {
  const x = useDerivedValue(() => {
    clock.value;
    return waves.value[index].x - RB;
  });
  const y = useDerivedValue(() => {
    clock.value;
    return waves.value[index].y - RB;
  });
  // collapse the box to 0 when inactive so we don't shade for nothing
  const size = useDerivedValue(() => {
    const wv = waves.value[index];
    const t = wv.born < 0 ? 2 : (clock.value - wv.born) / LIFE;
    return t < 0 || t > 1 ? 0 : RB * 2;
  });
  const uniforms = useDerivedValue(() => {
    const wv = waves.value[index];
    const t = wv.born < 0 ? 2 : (clock.value - wv.born) / LIFE;
    return { u_center: [wv.x, wv.y], u_age: Math.min(t, 1), u_seed: wv.seed };
  });

  if (!SOURCE) return null;
  return (
    <Rect x={x} y={y} width={size} height={size} blendMode="plus">
      <Shader source={SOURCE} uniforms={uniforms} />
    </Rect>
  );
}
