import { Canvas, Fill, Shader, Skia, useClock } from '@shopify/react-native-skia';
import { useEffect, useRef } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useDerivedValue, useSharedValue } from 'react-native-reanimated';
import { NoteSynth } from '../../modules/note-synth';
import { recordNote } from '../recorder/recorder';
import { scaleFrequencies, useScale } from '../scale';

// Fence · Waves — a full-screen gradient that UNDULATES (domain warping), with
// TAP-TO-RIPPLE. The ripple adds no new geometry: each tap sends an expanding
// ring that radially displaces the *sampling coordinate* near its wavefront, so
// the gradient itself warps outward like the surface of water.
const N = 16; // max concurrent ripples (a held finger emits a stream)

const source = Skia.RuntimeEffect.Make(`
uniform float2 u_resolution;
uniform float u_time;
uniform float2 u_taps[${N}];     // tap positions (px); unused slots far away
uniform float u_tapTimes[${N}];  // tap start times (s); -100 = empty slot
uniform float u_tapSeed[${N}];   // per-ripple random seed → unique shape

// A smooth flow field. Lower frequencies + smaller amplitude → large, soft,
// gently-moving features.
float2 flow(float2 p, float time) {
  return float2(
    0.7 * sin(p.y * 1.5 + time * 0.35) + 0.22 * sin(p.y * 3.0 - time * 0.5),
    0.7 * sin(p.x * 1.3 + time * 0.3) + 0.22 * sin(p.x * 2.6 + time * 0.45)
  );
}

// The undulating surface as a single scalar "height" — same warp the color uses.
// Sampling it at small offsets gives the slope, hence a normal we can light.
float heightAt(float2 uv) {
  float2 q = uv * 1.7;
  float2 w1 = flow(q, u_time);
  float2 w2 = flow(q + 0.35 * w1, u_time * 1.05);
  return w2.x + w2.y;
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
    if (age < 0.0 || age > 2.6) { continue; }        // empty or expired
    float seed = u_tapSeed[i];

    float2 d = fragcoord - u_taps[i];
    float len = length(d);
    float2 dir = len > 0.001 ? d / len : float2(0.0);

    // Deform each ripple organically (not star-like): perturb the radius with a
    // smooth flow field sampled around the ring, offset per-ripple by the seed.
    // Because it's a smooth 2-D field rather than an integer angular sine, the
    // wavefront wobbles irregularly instead of forming symmetric star points.
    float bump = flow(d * 0.012 + float2(seed * 21.0, seed * 13.0), u_time * 0.15).x;
    float dist = len * (1.0 + 0.07 * bump);

    // Per-ripple speed / width / ring frequency / amplitude. Slow travel for a
    // calm radiation, but wider rings and a bigger amplitude → larger, stronger.
    float speed = 210.0 + seed * 90.0;
    float width = 84.0 + seed * 28.0;
    float ringFreq = 5.5 + fract(seed * 9.0) * 2.5;
    float amp = 62.0 + seed * 26.0;

    float band = (dist - age * speed) / width;
    float env = exp(-band * band);
    float decay = max(0.0, 1.0 - age / 2.6);
    disp += dir * sin(band * ringFreq) * env * decay * amp;
  }
  return disp;
}

half4 main(float2 fragcoord) {
  // Distort the sampling coordinate by the ripples — this is the whole effect.
  float2 uv = (fragcoord + rippleDisplacement(fragcoord)) / u_resolution;
  uv.x *= u_resolution.x / u_resolution.y; // aspect-correct

  // Treat the warped flow as a height field — used for color AND for light.
  float hC = heightAt(uv);

  // BASE layer.
  float f = 0.5 + 0.5 * sin(hC * 0.9 + u_time * 0.12);
  half3 base = oceanPalette(f);

  // SECOND color layer: an independent slower flow, screen-blended over the base.
  float2 q2 = uv * 2.2 + 7.0;
  float2 v1 = flow(q2, u_time * 0.8);
  float2 v2 = flow(q2 + 0.35 * v1, u_time * 0.85);
  float g = 0.5 + 0.5 * sin((v2.x + v2.y) * 0.8 - u_time * 0.10);
  half3 accent = half3(0.30, 0.95, 0.62);                 // vivid green-cyan
  half3 layer = accent * smoothstep(0.30, 1.0, g) * 0.95;
  half3 col = 1.0 - (1.0 - base) * (1.0 - layer);         // screen blend

  // LIGHT: specular glints. Finite-difference the height field for a normal,
  // then a tight Blinn-Phong highlight against a fixed light → moving sparkle.
  float e = 0.0016;
  float2 grad = float2(heightAt(uv + float2(e, 0.0)) - hC,
                       heightAt(uv + float2(0.0, e)) - hC) / e;
  float3 n = normalize(float3(-grad * 0.12, 1.0));
  float3 H = normalize(float3(0.45, 0.6, 0.7) + float3(0.0, 0.0, 1.0)); // light + view
  float spec = pow(max(dot(n, H), 0.0), 42.0);
  col += half3(0.75, 0.88, 1.0) * spec * 0.55;

  // A second, warmer light: a broad, low-exponent reddish-pink sheen from the
  // opposite side, so it gently catches the wave slopes facing it as they move.
  float3 Hp = normalize(float3(-0.55, -0.25, 0.55) + float3(0.0, 0.0, 1.0));
  float pinkLit = pow(max(dot(n, Hp), 0.0), 5.0);
  col += half3(1.0, 0.34, 0.44) * pinkLit * 0.62;

  // Tiny dither to hide banding on the smooth gradient.
  float dither = fract(sin(dot(fragcoord, float2(12.9898, 78.233))) * 43758.5453);
  col += half3((dither - 0.5) / 255.0);

  return half4(col, 1.0);
}
`)!;

type Tap = { x: number; y: number; t: number; seed: number };

export default function FenceWaves() {
  const { width, height } = useWindowDimensions();
  const clock = useClock();
  const taps = useSharedValue<Tap[]>([]);
  const holdPos = useRef({ x: 0, y: 0 });
  const intervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ascending scale ladder (two octaves from the root) and a climbing index, so
  // each ripple sounds the next note up; it wraps back to the bottom at the top.
  // Rebuilt when the global scale (settings picker) changes; the climb restarts.
  const scale = useScale();
  const arpIndex = useRef(0);
  const ladderRef = useRef<number[]>([]);
  const scaleKey = `${scale.root}-${scale.type}`;
  const prevScaleKey = useRef('');
  if (prevScaleKey.current !== scaleKey) {
    prevScaleKey.current = scaleKey;
    ladderRef.current = scaleFrequencies(scale, 48 + scale.root, 48 + scale.root + 24);
    arpIndex.current = 0;
  }

  // Push one ripple (position, time, and a random seed) into the ring buffer,
  // and trigger its note — the ripple and the sound share this one moment.
  const spawn = (x: number, y: number) => {
    const list = taps.value.slice(-(N - 1));
    list.push({ x, y, t: clock.value / 1000, seed: Math.random() });
    taps.value = list;

    const ladder = ladderRef.current;
    if (ladder.length > 0) {
      const freq = ladder[arpIndex.current % ladder.length];
      recordNote(freq, 0.5); // so the REC control captures the arp
      NoteSynth?.pluck(freq, 0.5, 0.4).catch(() => {});
      arpIndex.current = (arpIndex.current + 1) % ladder.length;
    }
  };
  // While held, re-emit on a jittered interval so the rhythm feels organic, and
  // nudge the position a touch so the stream doesn't stack on one exact point.
  const scheduleNext = () => {
    const delay = 90 + Math.random() * 140; // ~90..230ms
    intervalRef.current = setTimeout(() => {
      const j = 16;
      spawn(
        holdPos.current.x + (Math.random() - 0.5) * j,
        holdPos.current.y + (Math.random() - 0.5) * j
      );
      scheduleNext();
    }, delay);
  };
  // Touch down: ripple now, then keep emitting at the finger while it's held.
  const startHold = (x: number, y: number) => {
    holdPos.current = { x, y };
    spawn(x, y);
    if (intervalRef.current) clearTimeout(intervalRef.current);
    scheduleNext();
  };
  const moveHold = (x: number, y: number) => {
    holdPos.current = { x, y };
  };
  const stopHold = () => {
    if (intervalRef.current) {
      clearTimeout(intervalRef.current);
      intervalRef.current = null;
    }
  };
  useEffect(() => stopHold, []);

  const gesture = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => {
      runOnJS(startHold)(e.x, e.y);
    })
    .onUpdate((e) => {
      runOnJS(moveHold)(e.x, e.y);
    })
    .onFinalize(() => {
      runOnJS(stopHold)();
    });

  const uniforms = useDerivedValue(() => {
    const pos: number[] = [];
    const times: number[] = [];
    const seeds: number[] = [];
    const ts = taps.value;
    for (let i = 0; i < N; i++) {
      const tp = ts[i];
      if (tp) {
        pos.push(tp.x, tp.y);
        times.push(tp.t);
        seeds.push(tp.seed);
      } else {
        pos.push(0, 0);
        times.push(-100); // empty slot: forever ago → no ripple
        seeds.push(0);
      }
    }
    return {
      u_resolution: [width, height],
      u_time: clock.value / 1000,
      u_taps: pos,
      u_tapTimes: times,
      u_tapSeed: seeds,
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
