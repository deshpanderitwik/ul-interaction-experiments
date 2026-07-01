import { Canvas, Fill, Shader, Skia, useClock } from '@shopify/react-native-skia';
import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useDerivedValue, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Fence · Rung 2 — Toolbox.
// The literacy rung: a shader visual is a number pushed through a CURVE. We take
// x = uv.x (0..1 across the screen), run it through a chosen shaping function
// f(x), and show it two ways at once: the whole screen TINTED by f(x), and the
// bright CURVE of y = f(x) plotted over it. Chips switch the tool; drag left/
// right to scrub that tool's one parameter.
const source = Skia.RuntimeEffect.Make(`
uniform float2 u_resolution;
uniform float u_time;
uniform float u_tool;   // which shaping function
uniform float u_param;  // 0..1 scrubber, meaning depends on the tool

float shape(float x, float tool, float p, float time) {
  if (tool < 0.5) {
    return x;                                     // linear
  } else if (tool < 1.5) {
    return step(mix(0.15, 0.85, p), x);           // step — p = threshold
  } else if (tool < 2.5) {
    float w = 0.02 + p * 0.4;                      // smoothstep — p = edge width
    return smoothstep(0.5 - w, 0.5 + w, x);
  } else if (tool < 3.5) {
    return fract(x * (1.0 + p * 7.0));            // fract — p = frequency
  } else if (tool < 4.5) {
    float fr = 0.5 + p * 5.5;                      // sin — p = frequency
    return 0.5 + 0.5 * sin(x * fr * 6.2831 + time);
  } else if (tool < 5.5) {
    return pow(x, mix(0.25, 4.0, p));            // pow — p = exponent
  } else {
    return abs(x * 2.0 - 1.0);                    // abs — a V (ignores p)
  }
}

half4 main(float2 fragcoord) {
  float2 uv = fragcoord / u_resolution;
  float x = uv.x;
  float y = 1.0 - uv.y;                            // 0 at the bottom
  float fx = clamp(shape(x, u_tool, u_param, u_time), 0.0, 1.0);

  // FIELD: tint the screen by f(x) (varies with x → vertical bands/gradient).
  half3 col = mix(half3(0.04, 0.06, 0.11), half3(0.30, 0.66, 0.92), fx);

  // Faint axes at the middle, plus the parameter scrubber position.
  float axes = smoothstep(0.004, 0.0, abs(x - 0.5)) + smoothstep(0.004, 0.0, abs(y - 0.5));
  col += half3(0.05, 0.06, 0.09) * axes;
  float pline = smoothstep(0.004, 0.0, abs(x - u_param));
  col += half3(0.10, 0.10, 0.14) * pline;

  // CURVE: bright line where y ≈ f(x).
  float d = abs(y - fx);
  float line = smoothstep(0.016, 0.0, d);
  col = mix(col, half3(1.0, 0.94, 0.6), line);

  return half4(col, 1.0);
}
`)!;

const TOOLS = ['Linear', 'Step', 'Smoothstep', 'Fract', 'Sin', 'Pow', 'Abs'];

export default function FenceToolbox() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const clock = useClock();

  const [tool, setTool] = useState(0);
  const toolSV = useSharedValue(0);
  const param = useSharedValue(0.5);
  const select = (i: number) => {
    setTool(i);
    toolSV.value = i;
  };

  const uniforms = useDerivedValue(() => ({
    u_resolution: [width, height],
    u_time: clock.value / 1000,
    u_tool: toolSV.value,
    u_param: param.value,
  }));

  // Drag left/right anywhere to scrub the current tool's parameter.
  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => {
      param.value = Math.max(0, Math.min(1, e.x / width));
    })
    .onUpdate((e) => {
      param.value = Math.max(0, Math.min(1, e.x / width));
    });

  return (
    <View style={styles.fill}>
      <GestureDetector gesture={pan}>
        <View style={StyleSheet.absoluteFill}>
          <Canvas style={StyleSheet.absoluteFill}>
            <Fill>
              <Shader source={source} uniforms={uniforms} />
            </Fill>
          </Canvas>
        </View>
      </GestureDetector>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.bar, { bottom: insets.bottom + 12 }]}
        contentContainerStyle={styles.barContent}
      >
        {TOOLS.map((label, i) => {
          const on = i === tool;
          return (
            <Pressable
              key={label}
              onPress={() => select(i)}
              style={[styles.chip, on && styles.chipOn]}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  bar: { position: 'absolute', left: 0, right: 0, maxHeight: 48 },
  barContent: { paddingHorizontal: 16, gap: 10, alignItems: 'center' },
  chip: {
    paddingHorizontal: 16,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(20,20,24,0.85)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  chipOn: { backgroundColor: '#9b8cff', borderColor: '#9b8cff' },
  chipText: { color: '#cfd0e6', fontSize: 14, fontWeight: '600' },
  chipTextOn: { color: '#0b0b14' },
});
