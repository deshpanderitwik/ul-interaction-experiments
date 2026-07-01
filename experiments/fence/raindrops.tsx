import { Canvas, Fill, Shader, Skia, useClock } from '@shopify/react-native-skia';
import { useEffect, useRef } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useDerivedValue, useSharedValue } from 'react-native-reanimated';
import { NoteSynth } from '../../modules/note-synth';
import { recordNote } from '../recorder/recorder';
import { scaleFrequencies, useScale } from '../scale';

// Fence · Raindrops — the SAME undulating substrate as Waves (domain-warped
// gradient + cool/pink light), but touch drops raindrop ripples onto it instead
// of rolling waves: tighter, quicker concentric rings plus a bright surface
// highlight at each wavefront. Sound (a climbing plucked arp) only plays while
// you touch and hold — no ambient rain.
const N = 16; // max concurrent ripples

const source = Skia.RuntimeEffect.Make(`
uniform float2 u_resolution;
uniform float u_time;
uniform float2 u_taps[${N}];
uniform float u_tapTimes[${N}];
uniform float u_tapSeed[${N}];

// --- shared substrate (identical to Waves) ---
float2 flow(float2 p, float time) {
  return float2(
    0.7 * sin(p.y * 1.5 + time * 0.35) + 0.22 * sin(p.y * 3.0 - time * 0.5),
    0.7 * sin(p.x * 1.3 + time * 0.3) + 0.22 * sin(p.x * 2.6 + time * 0.45)
  );
}
float heightAt(float2 uv) {
  float2 q = uv * 1.7;
  float2 w1 = flow(q, u_time);
  float2 w2 = flow(q + 0.35 * w1, u_time * 1.05);
  return w2.x + w2.y;
}
half3 oceanPalette(float f) {
  half3 deep  = half3(0.02, 0.04, 0.16);
  half3 mid   = half3(0.04, 0.18, 0.40);
  half3 crest = half3(0.08, 0.40, 0.58);
  half3 c = mix(deep, mid, smoothstep(0.05, 0.82, f));
  c = mix(c, crest, smoothstep(0.76, 1.0, f));
  return c;
}

half4 main(float2 fragcoord) {
  // Raindrop ripples: accumulate a coordinate distortion AND a surface highlight
  // at each expanding ring. Tighter/quicker than Waves' rolling swells.
  float2 disp = float2(0.0);
  float ringLight = 0.0;
  for (int i = 0; i < ${N}; i++) {
    float age = u_time - u_tapTimes[i];
    if (age < 0.0 || age > 1.6) { continue; }
    float seed = u_tapSeed[i];
    float2 d = fragcoord - u_taps[i];
    float len = length(d);
    float2 dir = len > 0.001 ? d / len : float2(0.0);
    // organic (non-star) radius perturbation, same trick as Waves
    float bump = flow(d * 0.012 + float2(seed * 21.0, seed * 13.0), u_time * 0.15).x;
    float dist = len * (1.0 + 0.06 * bump);

    // 1) IMPACT DENT: a quick inward pinch localized right at the landing point,
    //    strongest at age 0 and gone within ~0.3s.
    float dentEnv = exp(-(len * len) / (23.0 * 23.0));
    float dent = -dentEnv * exp(-age * 8.0) * 26.0;

    // 2) RIPPLES emanating from that point: small, tight, quick rings.
    float speed = 165.0 + seed * 55.0;
    float width = 20.0 + seed * 8.0;
    float r = age * speed;
    float band = (dist - r) / width;
    float env = exp(-band * band);
    float decay = max(0.0, 1.0 - age / 1.6);
    float ring = sin(band * 6.0) * env * decay * 17.0;

    disp += dir * (dent + ring);
    ringLight += (env * decay + dentEnv * exp(-age * 8.0) * 0.6);
  }

  float2 uv = (fragcoord + disp) / u_resolution;
  uv.x *= u_resolution.x / u_resolution.y;

  float hC = heightAt(uv);
  float f = 0.5 + 0.5 * sin(hC * 0.9 + u_time * 0.12);
  half3 base = oceanPalette(f);

  float2 q2 = uv * 2.2 + 7.0;
  float2 v1 = flow(q2, u_time * 0.8);
  float2 v2 = flow(q2 + 0.35 * v1, u_time * 0.85);
  float g = 0.5 + 0.5 * sin((v2.x + v2.y) * 0.8 - u_time * 0.10);
  half3 accent = half3(0.30, 0.95, 0.62);
  half3 layer = accent * smoothstep(0.30, 1.0, g) * 0.95;
  half3 col = 1.0 - (1.0 - base) * (1.0 - layer);

  // Light: cool specular + warm pink (same as Waves).
  float e = 0.0016;
  float2 grad = float2(heightAt(uv + float2(e, 0.0)) - hC,
                       heightAt(uv + float2(0.0, e)) - hC) / e;
  float3 n = normalize(float3(-grad * 0.12, 1.0));
  float3 H = normalize(float3(0.45, 0.6, 0.7) + float3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(n, H), 0.0), 42.0);
  col += half3(0.75, 0.88, 1.0) * spec * 0.55;
  float3 Hp = normalize(float3(-0.55, -0.25, 0.55) + float3(0.0, 0.0, 1.0));
  float pinkLit = pow(max(dot(n, Hp), 0.0), 5.0);
  col += half3(1.0, 0.34, 0.44) * pinkLit * 0.62;

  // Raindrop ring highlight on the surface.
  col += half3(0.55, 0.75, 1.0) * ringLight * 0.22;

  float dither = fract(sin(dot(fragcoord, float2(12.9898, 78.233))) * 43758.5453);
  col += half3((dither - 0.5) / 255.0);
  return half4(col, 1.0);
}
`)!;

type Drop = { x: number; y: number; t: number; seed: number };

export default function FenceRaindrops() {
  const { width, height } = useWindowDimensions();
  const clock = useClock();
  const taps = useSharedValue<Drop[]>([]);
  const holdPos = useRef({ x: 0, y: 0 });
  const streamRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ascending scale ladder + climbing index — each droplet plinks the next note.
  const scale = useScale();
  const ladderRef = useRef<number[]>([]);
  const arpIndex = useRef(0);
  const scaleKey = `${scale.root}-${scale.type}`;
  const prevScaleKey = useRef('');
  if (prevScaleKey.current !== scaleKey) {
    prevScaleKey.current = scaleKey;
    ladderRef.current = scaleFrequencies(scale, 48 + scale.root, 48 + scale.root + 24);
    arpIndex.current = 0;
  }

  // A droplet: push to the ring buffer and plink its note.
  const spawn = (x: number, y: number) => {
    const list = taps.value.slice(-(N - 1));
    list.push({ x, y, t: clock.value / 1000, seed: Math.random() });
    taps.value = list;

    const ladder = ladderRef.current;
    if (ladder.length > 0) {
      const freq = ladder[arpIndex.current % ladder.length];
      recordNote(freq, 0.5);
      NoteSynth?.pluck(freq, 0.45, 0.5).catch(() => {});
      arpIndex.current = (arpIndex.current + 1) % ladder.length;
    }
  };

  // Touch/hold: a stream of drops where you touch (with a little scatter).
  const scheduleStream = () => {
    streamRef.current = setTimeout(() => {
      // Drops land scattered AROUND the finger, not on it.
      spawn(
        holdPos.current.x + (Math.random() - 0.5) * 90,
        holdPos.current.y + (Math.random() - 0.5) * 90
      );
      scheduleStream();
    }, 70 + Math.random() * 130);
  };
  const startHold = (x: number, y: number) => {
    holdPos.current = { x, y };
    spawn(x, y);
    if (streamRef.current) clearTimeout(streamRef.current);
    scheduleStream();
  };
  const moveHold = (x: number, y: number) => {
    holdPos.current = { x, y };
  };
  const stopHold = () => {
    if (streamRef.current) {
      clearTimeout(streamRef.current);
      streamRef.current = null;
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
        times.push(-100);
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
