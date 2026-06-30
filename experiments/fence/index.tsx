import { Canvas, Fill, Shader, Skia } from '@shopify/react-native-skia';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useDerivedValue, useSharedValue } from 'react-native-reanimated';

// Fence — a study in shaders (visual only). This first step is the simplest
// interactive thing: a full-screen SkSL fragment shader painting a UV field,
// with a soft glow that tracks the finger. Everything here will grow from this
// seed — uniforms in, a color out, driven on the UI thread.
const source = Skia.RuntimeEffect.Make(`
uniform float2 u_resolution; // canvas size in px
uniform float2 u_touch;      // finger position in px

half4 main(float2 fragcoord) {
  float2 uv = fragcoord / u_resolution;            // 0..1 across the screen
  float d = distance(fragcoord, u_touch) / u_resolution.y;
  float glow = smoothstep(0.4, 0.0, d);            // bright near the finger
  half3 col = half3(uv.x, uv.y, 0.6) + half3(glow);
  return half4(col, 1.0);
}
`)!;

export default function Fence() {
  const { width, height } = useWindowDimensions();
  const touchX = useSharedValue(width / 2);
  const touchY = useSharedValue(height / 2);

  const uniforms = useDerivedValue(() => ({
    u_resolution: [width, height],
    u_touch: [touchX.value, touchY.value],
  }));

  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => {
      touchX.value = e.x;
      touchY.value = e.y;
    })
    .onUpdate((e) => {
      touchX.value = e.x;
      touchY.value = e.y;
    });

  return (
    <GestureDetector gesture={pan}>
      <View style={styles.fill}>
        <Canvas style={StyleSheet.absoluteFill}>
          <Fill>
            <Shader source={source} uniforms={uniforms} />
          </Fill>
        </Canvas>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
});
