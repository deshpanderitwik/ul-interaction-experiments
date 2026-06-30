import { Canvas, Fill, Shader, Skia, useClock } from '@shopify/react-native-skia';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { useDerivedValue } from 'react-native-reanimated';

// Fence · Rung 1 — Time.
// The whole lesson: feed a steadily-rising clock into the shader as a uniform,
// and animation falls out for free. The GPU re-runs this per pixel every frame;
// the only thing changing frame to frame is `u_time`, which scrolls the colors
// of a gradient sphere parked in the middle of the screen.
const source = Skia.RuntimeEffect.Make(`
uniform float2 u_resolution;
uniform float u_time;

// A cosine color palette (Inigo Quilez): cheap, always-pretty gradients.
half3 palette(float t) {
  half3 a = half3(0.5);
  half3 b = half3(0.5);
  half3 c = half3(1.0);
  half3 d = half3(0.00, 0.33, 0.67);
  return a + b * cos(6.28318 * (c * t + d));
}

half4 main(float2 fragcoord) {
  // Center the coordinate and make it aspect-correct (units of screen-heights).
  float2 uv = (fragcoord - 0.5 * u_resolution) / u_resolution.y;
  float r = length(uv);

  float radius = 0.32;
  // Soft, anti-aliased disc edge.
  float mask = smoothstep(radius, radius - 0.006, r);
  // A little spherical shading so the disc reads as a ball.
  float sphere = sqrt(max(0.0, 1.0 - (r / radius) * (r / radius)));

  // The gradient: a diagonal ramp that scrolls with time.
  float t = (uv.x + uv.y) * 0.5 + u_time * 0.15;
  half3 col = palette(t) * (0.6 + 0.4 * sphere);

  half3 bg = half3(0.04);
  return half4(mix(bg, col, mask), 1.0);
}
`)!;

export default function FenceTime() {
  const { width, height } = useWindowDimensions();
  const clock = useClock(); // ms since mount, drives the redraw

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
