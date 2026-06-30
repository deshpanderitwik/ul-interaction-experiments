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

// Fence · Rung 1 — Time.
// A gradient sphere whose colors flow from a single rising clock uniform. The
// button row swaps the GRADIENT DRIVER (`t`, the value the palette reads), and
// swiping up/down ON the sphere grows/shrinks it (u_radius uniform). Caps keep
// the circle fully visible and never filling the screen.
const source = Skia.RuntimeEffect.Make(`
uniform float2 u_resolution;
uniform float u_time;
uniform float u_mode;     // which driver feeds the gradient
uniform float u_radius;   // sphere radius, in screen-heights

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

  float radius = u_radius;
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

  // Radius caps in screen-height units, derived from the SMALLER screen
  // dimension so the circle is always fully on-screen (never clipped) and never
  // fills the screen: max diameter ~86% of the short side, min ~22%.
  const minDim = Math.min(width, height);
  const MIN_R = (0.22 * minDim) / 2 / height;
  const MAX_R = (0.86 * minDim) / 2 / height;

  const [mode, setMode] = useState(0);
  const modeSV = useSharedValue(0);
  const select = (i: number) => {
    setMode(i);
    modeSV.value = i;
  };

  const radiusSV = useSharedValue((MIN_R + MAX_R) / 2);
  const startR = useSharedValue(0);
  const grabbing = useSharedValue(0); // 1 while a swipe started on the sphere

  // Swipe up/down on the sphere to grow/shrink it (1:1 with screen fraction),
  // clamped to the caps.
  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => {
      const dx = e.x - width / 2;
      const dy = e.y - height / 2;
      const distUv = Math.sqrt(dx * dx + dy * dy) / height;
      grabbing.value = distUv <= radiusSV.value ? 1 : 0;
      startR.value = radiusSV.value;
    })
    .onUpdate((e) => {
      if (grabbing.value < 0.5) return;
      const next = startR.value - e.translationY / height; // up = bigger
      radiusSV.value = Math.min(MAX_R, Math.max(MIN_R, next));
    });

  const uniforms = useDerivedValue(() => ({
    u_resolution: [width, height],
    u_time: clock.value / 1000,
    u_mode: modeSV.value,
    u_radius: Math.min(MAX_R, Math.max(MIN_R, radiusSV.value)),
  }));

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
