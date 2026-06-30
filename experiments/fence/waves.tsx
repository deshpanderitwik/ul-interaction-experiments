import { Canvas, Fill, Shader, Skia, useClock } from '@shopify/react-native-skia';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useDerivedValue, useSharedValue } from 'react-native-reanimated';

// Fence · Waves — a full-screen gradient that UNDULATES (domain warping), with
// TAP-TO-RIPPLE. The ripple adds no new geometry: each tap sends an expanding
// ring that radially displaces the *sampling coordinate* near its wavefront, so
// the gradient itself warps outward like the surface of water.
const N = 8; // max concurrent ripples

const source = Skia.RuntimeEffect.Make(`
uniform float2 u_resolution;
uniform float u_time;
uniform float2 u_taps[${N}];     // tap positions (px); unused slots far away
uniform float u_tapTimes[${N}];  // tap start times (s); -100 = empty slot

// A smooth flow field. Lower frequencies + smaller amplitude → large, soft,
// gently-moving features.
float2 flow(float2 p, float time) {
  return float2(
    0.7 * sin(p.y * 1.5 + time * 0.35) + 0.22 * sin(p.y * 3.0 - time * 0.5),
    0.7 * sin(p.x * 1.3 + time * 0.3) + 0.22 * sin(p.x * 2.6 + time * 0.45)
  );
}

// Base palette: deep indigo→blue, darker, so the green-cyan layer reads distinct.
half3 oceanPalette(float f) {
  half3 deep  = half3(0.02, 0.04, 0.16);
  half3 mid   = half3(0.04, 0.18, 0.40);
  half3 crest = half3(0.08, 0.40, 0.58);
  half3 c = mix(deep, mid, smoothstep(0.05, 0.82, f));
  c = mix(c, crest, smoothstep(0.76, 1.0, f));
  return c;
}

// Sum the radial displacement from every live tap ripple, in pixels.
float2 rippleDisplacement(float2 fragcoord) {
  float2 disp = float2(0.0);
  for (int i = 0; i < ${N}; i++) {
    float age = u_time - u_tapTimes[i];
    if (age < 0.0 || age > 2.0) { continue; }       // empty or expired
    float2 d = fragcoord - u_taps[i];
    float dist = length(d);
    float2 dir = dist > 0.001 ? d / dist : float2(0.0);
    float band = (dist - age * 420.0) / 55.0;        // distance from the expanding wavefront
    float env = exp(-band * band);                   // localize to the ring
    float decay = max(0.0, 1.0 - age / 2.0);         // fade over the ripple's ~2s life
    disp += dir * sin(band * 6.0) * env * decay * 20.0; // a few concentric rings
  }
  return disp;
}

half4 main(float2 fragcoord) {
  // Distort the sampling coordinate by the ripples — this is the whole effect.
  float2 uv = (fragcoord + rippleDisplacement(fragcoord)) / u_resolution;
  uv.x *= u_resolution.x / u_resolution.y; // aspect-correct
  float2 q = uv * 1.7;

  // Warp, then warp the warp — gentle, subtle undulation.
  float2 w1 = flow(q, u_time);
  float2 w2 = flow(q + 0.35 * w1, u_time * 1.05);
  float field = w2.x + w2.y;

  // BASE layer.
  float f = 0.5 + 0.5 * sin(field * 0.9 + u_time * 0.12);
  half3 base = oceanPalette(f);

  // SECOND color layer: an independent slower flow, screen-blended over the base.
  float2 q2 = uv * 2.2 + 7.0;
  float2 v1 = flow(q2, u_time * 0.8);
  float2 v2 = flow(q2 + 0.35 * v1, u_time * 0.85);
  float g = 0.5 + 0.5 * sin((v2.x + v2.y) * 0.8 - u_time * 0.10);
  half3 accent = half3(0.30, 0.95, 0.62);                 // vivid green-cyan
  half3 layer = accent * smoothstep(0.30, 1.0, g) * 0.95;
  half3 col = 1.0 - (1.0 - base) * (1.0 - layer);         // screen blend

  // Tiny dither to hide banding on the smooth gradient.
  float dither = fract(sin(dot(fragcoord, float2(12.9898, 78.233))) * 43758.5453);
  col += half3((dither - 0.5) / 255.0);

  return half4(col, 1.0);
}
`)!;

type Tap = { x: number; y: number; t: number };

export default function FenceWaves() {
  const { width, height } = useWindowDimensions();
  const clock = useClock();
  const taps = useSharedValue<Tap[]>([]);

  // Record each tap (position + the time it happened) into a small ring buffer.
  const tap = Gesture.Tap().onBegin((e) => {
    const list = taps.value.slice(-(N - 1));
    list.push({ x: e.x, y: e.y, t: clock.value / 1000 });
    taps.value = list;
  });

  const uniforms = useDerivedValue(() => {
    const pos: number[] = [];
    const times: number[] = [];
    const ts = taps.value;
    for (let i = 0; i < N; i++) {
      const tp = ts[i];
      if (tp) {
        pos.push(tp.x, tp.y);
        times.push(tp.t);
      } else {
        pos.push(0, 0);
        times.push(-100); // empty slot: forever ago → no ripple
      }
    }
    return {
      u_resolution: [width, height],
      u_time: clock.value / 1000,
      u_taps: pos,
      u_tapTimes: times,
    };
  });

  return (
    <GestureDetector gesture={tap}>
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
