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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDerivedValue, useSharedValue } from 'react-native-reanimated';

// Fence · Rung 1 — Time.
// A gradient sphere whose colors flow from a single rising clock uniform. The
// button row swaps the GRADIENT DRIVER — the value `t` that the color palette
// reads — so you can feel how the *same* time+palette looks under different
// gradient geometries (directional / radial / angular / spiral).
const source = Skia.RuntimeEffect.Make(`
uniform float2 u_resolution;
uniform float u_time;
uniform float u_mode;   // which driver feeds the gradient

// A cosine color palette (Inigo Quilez): cheap, always-pretty gradients.
half3 palette(float t) {
  half3 a = half3(0.5);
  half3 b = half3(0.5);
  half3 c = half3(1.0);
  half3 d = half3(0.00, 0.33, 0.67);
  return a + b * cos(6.28318 * (c * t + d));
}

// The driver: turn a position (+ time) into the 1-D value the palette reads.
// This is section A — the *geometry* of the gradient.
float driver(float2 uv, float time, float mode) {
  float ang = atan(uv.y, uv.x) * 0.159155; // -0.5..0.5 around the center
  float rad = length(uv);
  if (mode < 0.5) {
    return (uv.x + uv.y) * 1.2 + time * 0.15;        // directional ramp
  } else if (mode < 1.5) {
    return rad * 3.0 - time * 0.25;                  // radial rings
  } else if (mode < 2.5) {
    return ang + time * 0.06;                        // angular / conic sweep
  } else {
    return ang + rad * 3.0 - time * 0.12;            // spiral (angular + radial)
  }
}

half4 main(float2 fragcoord) {
  // Center the coordinate and make it aspect-correct (units of screen-heights).
  float2 uv = (fragcoord - 0.5 * u_resolution) / u_resolution.y;
  float r = length(uv);

  float radius = 0.32;
  float mask = smoothstep(radius, radius - 0.006, r);          // soft disc edge
  float sphere = sqrt(max(0.0, 1.0 - (r / radius) * (r / radius))); // ball shading

  float t = driver(uv, u_time, u_mode);
  half3 col = palette(t) * (0.6 + 0.4 * sphere);

  half3 bg = half3(0.04);
  return half4(mix(bg, col, mask), 1.0);
}
`)!;

const MODES = ['Directional', 'Radial', 'Angular', 'Spiral'];

export default function FenceTime() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const clock = useClock(); // ms since mount, drives the redraw

  const [mode, setMode] = useState(0);
  const modeSV = useSharedValue(0);
  const select = (i: number) => {
    setMode(i);
    modeSV.value = i;
  };

  const uniforms = useDerivedValue(() => ({
    u_resolution: [width, height],
    u_time: clock.value / 1000,
    u_mode: modeSV.value,
  }));

  return (
    <View style={styles.fill}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Fill>
          <Shader source={source} uniforms={uniforms} />
        </Fill>
      </Canvas>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.bar, { bottom: insets.bottom + 12 }]}
        contentContainerStyle={styles.barContent}
      >
        {MODES.map((label, i) => {
          const on = i === mode;
          return (
            <Pressable
              key={label}
              onPress={() => select(i)}
              style={[styles.btn, on && styles.btnOn]}
            >
              <Text style={[styles.btnText, on && styles.btnTextOn]}>{label}</Text>
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
  btn: {
    paddingHorizontal: 16,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(20,20,24,0.85)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  btnOn: { backgroundColor: '#9b8cff', borderColor: '#9b8cff' },
  btnText: { color: '#cfd0e6', fontSize: 14, fontWeight: '600' },
  btnTextOn: { color: '#0b0b14' },
});
