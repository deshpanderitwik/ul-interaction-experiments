import { Canvas, Fill, Shader, Skia, useClock } from '@shopify/react-native-skia';
import { useRef } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useDerivedValue, useSharedValue } from 'react-native-reanimated';

// Fence · Disintegrating Circle — a solid disc that MELTS where you hold. Each
// finger is an erosion source: a "melt" value ramps up while held and eats the
// disc through a churning noise field, so the hole crumbles open grain-by-grain
// with a warm ember glow at the dissolving front. Release and the melt value
// ramps back down — the disc reassembles the same grainy way. Multitouch; drag
// to smear the hole across the surface (the trail heals behind the finger).
const N = 8; // max concurrent erosion sources

const source = Skia.RuntimeEffect.Make(`
uniform float2 u_resolution;
uniform float u_time;
uniform float2 u_center;
uniform float u_radius;
uniform float2 u_taps[${N}];  // erosion source positions (px)
uniform float u_melt[${N}];   // 0..1 erosion strength (ramps up held, down on release)

float hash(float2 p) { return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453); }
float vnoise(float2 p) {
  float2 i = floor(p), f = fract(p);
  float2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + float2(1.0, 0.0));
  float c = hash(i + float2(0.0, 1.0)), d = hash(i + float2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(float2 p) {
  float v = 0.0, amp = 0.5;
  for (int k = 0; k < 4; k++) { v += amp * vnoise(p); p *= 2.0; amp *= 0.5; }
  return v;
}

half4 main(float2 fragcoord) {
  float2 p = fragcoord;
  half3 bg = half3(0.02, 0.02, 0.035);

  float dist = length(p - u_center);
  // Anti-aliased disc coverage (1 inside, soft 1px edge).
  float disc = smoothstep(u_radius + 1.0, u_radius - 1.0, dist);
  if (disc <= 0.001) { return half4(bg, 1.0); }

  // Erosion field: the strongest melt source reaching this pixel.
  float e = 0.0;
  for (int i = 0; i < ${N}; i++) {
    float m = u_melt[i];
    if (m <= 0.0) { continue; }
    float dd = length(p - u_taps[i]);
    float infl = (1.0 - smoothstep(0.0, 120.0, dd)) * m; // peak m at the finger
    e = max(e, infl);
  }

  // Churning dissolve noise. A pixel clears once the (over-driven) erosion
  // exceeds the local noise threshold — low-noise grains go first, so the hole
  // opens with a crumbling, granular edge instead of a clean circle.
  float n = fbm(p * 0.06 + float2(u_time * 0.35, -u_time * 0.25));
  float w = 0.16;
  float cleared = smoothstep(n, n + w, e * 1.3); // 0 = intact, 1 = gone
  float mask = 1.0 - cleared;

  // Disc color: a cool purple→indigo radial gradient with a bright rim.
  float t = dist / u_radius;
  half3 core = half3(0.60, 0.55, 1.0);
  half3 rim = half3(0.16, 0.20, 0.52);
  half3 col = mix(core, rim, t);
  col += half3(0.35, 0.32, 0.5) * smoothstep(0.82, 1.0, t); // rim light

  // Ember glow at the dissolving front (where clearing is mid-transition).
  float front = 1.0 - abs(cleared * 2.0 - 1.0); // peaks at cleared = 0.5
  col = mix(col, half3(1.0, 0.5, 0.16), front * step(0.01, e) * 0.85);

  half3 outc = mix(bg, col, disc * mask);
  return half4(outc, 1.0);
}
`)!;

type Touch = { id: number; x: number; y: number; down: number; up: number };

export default function FenceDisintegrate() {
  const { width, height } = useWindowDimensions();
  const clock = useClock();
  const radius = Math.min(width, height) * 0.32;

  const taps = useSharedValue<Touch[]>([]);
  const listRef = useRef<Touch[]>([]);
  const now = () => clock.value / 1000;
  const sync = () => {
    taps.value = listRef.current.slice();
  };

  // A finger touched down: a fresh erosion source that starts melting now.
  const onDown = (id: number, x: number, y: number) => {
    listRef.current = [
      ...listRef.current.filter((t) => t.id !== id),
      { id, x, y, down: now(), up: -1 },
    ].slice(-N);
    sync();
  };
  // Drag: move the (still-held) source so the hole follows the finger.
  const onMove = (id: number, x: number, y: number) => {
    listRef.current = listRef.current.map((t) => (t.id === id && t.up < 0 ? { ...t, x, y } : t));
    sync();
  };
  // Release: stamp the release time so it ramps back down and reassembles.
  const onUp = (id: number) => {
    listRef.current = listRef.current.map((t) => (t.id === id && t.up < 0 ? { ...t, up: now() } : t));
    sync();
  };

  const gesture = Gesture.Pan()
    .minDistance(0)
    .onTouchesDown((e) => {
      for (const t of e.changedTouches) runOnJS(onDown)(t.id, t.x, t.y);
    })
    .onTouchesMove((e) => {
      for (const t of e.changedTouches) runOnJS(onMove)(t.id, t.x, t.y);
    })
    .onTouchesUp((e) => {
      for (const t of e.changedTouches) runOnJS(onUp)(t.id);
    })
    .onTouchesCancelled((e) => {
      for (const t of e.changedTouches) runOnJS(onUp)(t.id);
    });

  const RISE = 0.6; // seconds to fully melt while held
  const FALL = 1.0; // seconds to fully reassemble after release

  const uniforms = useDerivedValue(() => {
    const t = clock.value / 1000;
    const pos: number[] = [];
    const melt: number[] = [];
    const arr = taps.value;
    for (let i = 0; i < N; i++) {
      const tp = arr[i];
      if (tp) {
        let m: number;
        if (tp.up < 0) {
          m = Math.min(1, (t - tp.down) / RISE);
        } else {
          const held = Math.min(1, (tp.up - tp.down) / RISE);
          m = held * Math.max(0, 1 - (t - tp.up) / FALL);
        }
        pos.push(tp.x, tp.y);
        melt.push(m);
      } else {
        pos.push(-1000, -1000);
        melt.push(0);
      }
    }
    return {
      u_resolution: [width, height],
      u_time: t,
      u_center: [width / 2, height / 2],
      u_radius: radius,
      u_taps: pos,
      u_melt: melt,
    };
  });

  return (
    <GestureDetector gesture={gesture}>
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
