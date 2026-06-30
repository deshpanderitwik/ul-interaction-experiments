import { Canvas, Fill, Shader, Skia, useClock } from '@shopify/react-native-skia';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { useDerivedValue } from 'react-native-reanimated';

// Fence · Waves — building an overlapping, ocean-like layered gradient.
// STEP 1: one wave. A horizontal waterline displaced by sin(x + time), with a
// vertical gradient in the water below it (lighter near the surface, deeper and
// darker toward the bottom). This is the wave primitive everything else stacks
// on: displace a coordinate by a sine of position + time.
const source = Skia.RuntimeEffect.Make(`
uniform float2 u_resolution;
uniform float u_time;

half4 main(float2 fragcoord) {
  float2 uv = fragcoord / u_resolution; // 0..1, y is DOWN
  float y = 1.0 - uv.y;                 // flip so y = 0 is the bottom

  // The waterline: a sine of x scrolling with time.
  float waterline = 0.5 + 0.06 * sin(uv.x * 6.2831 * 1.5 + u_time * 1.2);

  // How far below the surface this pixel is (>0 = underwater).
  float below = waterline - y;
  float mask = smoothstep(-0.004, 0.004, below); // soft surface edge

  // Water gradient: 0 at the surface (lighter) → 1 at the bottom (deeper).
  float depth = clamp(below / max(waterline, 0.001), 0.0, 1.0);
  half3 shallow = half3(0.10, 0.45, 0.55);
  half3 deep = half3(0.02, 0.12, 0.22);
  half3 water = mix(shallow, deep, depth);

  half3 sky = half3(0.03, 0.04, 0.07);
  half3 col = mix(sky, water, mask);

  // A faint crest highlight right at the waterline.
  float crest = smoothstep(0.012, 0.0, abs(below));
  col += half3(0.15, 0.25, 0.30) * crest * 0.5;

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
