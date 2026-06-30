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

// A smooth flow field: two stacked sines per axis → organic, non-repetitive.
float2 flow(float2 p, float time) {
  return float2(
    sin(p.y * 2.5 + time * 0.6) + 0.5 * sin(p.y * 4.7 - time * 0.9),
    sin(p.x * 2.0 + time * 0.5) + 0.5 * sin(p.x * 4.1 + time * 0.8)
  );
}

// Ocean-ish palette: mostly deep→mid water, with brighter crests near the top.
half3 oceanPalette(float f) {
  half3 deep  = half3(0.02, 0.09, 0.20);
  half3 mid   = half3(0.04, 0.33, 0.48);
  half3 crest = half3(0.55, 0.86, 0.88);
  half3 c = mix(deep, mid, smoothstep(0.0, 0.55, f));
  c = mix(c, crest, smoothstep(0.62, 1.0, f));
  return c;
}

half4 main(float2 fragcoord) {
  float2 uv = fragcoord / u_resolution;
  uv.x *= u_resolution.x / u_resolution.y; // aspect-correct
  float2 q = uv * 3.0;

  // Warp, then warp the warp — the heart of the undulation.
  float2 w1 = flow(q, u_time);
  float2 w2 = flow(q + 0.6 * w1, u_time * 1.15);
  float field = w2.x + w2.y;

  // A smooth 0..1 value from the warped field, drifting with time.
  float f = 0.5 + 0.5 * sin(field * 1.3 + u_time * 0.2);
  half3 col = oceanPalette(f);

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
