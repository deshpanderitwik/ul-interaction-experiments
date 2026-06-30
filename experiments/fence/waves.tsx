import { Canvas, Fill, Shader, Skia, useClock } from '@shopify/react-native-skia';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { useDerivedValue } from 'react-native-reanimated';

// Fence · Waves — a full-screen gradient that UNDULATES (not literal waves).
// The move is "domain warping": before reading the gradient, we bend the
// coordinate with smooth, time-evolving offsets — and then warp that warped
// coordinate again. Feeding position+time through layered sines makes the whole
// color field flow and ripple like fluid, with no horizon or waterline.
const source = Skia.RuntimeEffect.Make(`
uniform float2 u_resolution;
uniform float u_time;

// A smooth flow field. Lower frequencies + smaller amplitude → large, soft,
// gently-moving features (the "blurred, subtle" look).
float2 flow(float2 p, float time) {
  return float2(
    0.7 * sin(p.y * 1.5 + time * 0.35) + 0.22 * sin(p.y * 3.0 - time * 0.5),
    0.7 * sin(p.x * 1.3 + time * 0.3) + 0.22 * sin(p.x * 2.6 + time * 0.45)
  );
}

// Ocean-ish palette, kept low-contrast so the undulation reads as a soft wash
// rather than sharp bands. Wide smoothstep ranges = gentle, blurred transitions.
half3 oceanPalette(float f) {
  half3 deep  = half3(0.04, 0.13, 0.24);
  half3 mid   = half3(0.07, 0.30, 0.42);
  half3 crest = half3(0.30, 0.55, 0.62);
  half3 c = mix(deep, mid, smoothstep(0.08, 0.85, f));
  c = mix(c, crest, smoothstep(0.78, 1.0, f));
  return c;
}

half4 main(float2 fragcoord) {
  float2 uv = fragcoord / u_resolution;
  uv.x *= u_resolution.x / u_resolution.y; // aspect-correct
  float2 q = uv * 1.7; // lower scale → larger, softer features

  // Warp, then warp the warp — but gently, for a subtle undulation.
  float2 w1 = flow(q, u_time);
  float2 w2 = flow(q + 0.35 * w1, u_time * 1.05);
  float field = w2.x + w2.y;

  // BASE layer: the undulating ocean gradient.
  float f = 0.5 + 0.5 * sin(field * 0.9 + u_time * 0.12);
  half3 base = oceanPalette(f);

  // SECOND color layer: an independent, slower flow at a different scale and a
  // domain offset, so it drifts on its own. We give it ONE luminous color and a
  // soft undulating presence, then SCREEN-blend it over the base — where the two
  // overlap the color builds up (translucent layering, not a hard paint).
  float2 q2 = uv * 2.2 + 7.0;
  float2 v1 = flow(q2, u_time * 0.8);
  float2 v2 = flow(q2 + 0.35 * v1, u_time * 0.85);
  float g = 0.5 + 0.5 * sin((v2.x + v2.y) * 0.8 - u_time * 0.10);
  half3 accent = half3(0.16, 0.46, 0.52);                // luminous aqua
  half3 layer = accent * smoothstep(0.35, 1.0, g) * 0.8; // translucent presence
  half3 col = 1.0 - (1.0 - base) * (1.0 - layer);        // screen blend

  // Tiny dither to hide the banding 8-bit screens show on smooth gradients.
  float dither = fract(sin(dot(fragcoord, float2(12.9898, 78.233))) * 43758.5453);
  col += half3((dither - 0.5) / 255.0);

  return half4(col, 1.0);
}
`)!;

export default function FenceWaves() {
  const { width, height } = useWindowDimensions();
  const clock = useClock();

  const uniforms = useDerivedValue(() => ({
    u_resolution: [width, height],
    u_time: clock.value / 1000,
  }));

  return (
    <View style={styles.fill}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Fill>
          <Shader source={source} uniforms={uniforms} />
        </Fill>
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
});
