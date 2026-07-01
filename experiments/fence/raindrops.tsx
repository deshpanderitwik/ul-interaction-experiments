import { Canvas, Fill, Shader, Skia, useClock } from '@shopify/react-native-skia';
import { useEffect, useRef } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useDerivedValue, useSharedValue } from 'react-native-reanimated';
import { NoteSynth } from '../../modules/note-synth';
import { useExperimentActive } from '../_host';
import { recordNote } from '../recorder/recorder';
import { scaleFrequencies, useScale } from '../scale';

// Fence · Raindrops — a fork of Waves back to the plucked arp. A calm dark pond;
// each note is a raindrop impact that flashes and sends an expanding ring across
// the surface. It rains on its own (each drop plinks the next note up the scale)
// and tapping/holding adds heavier rain where you touch.
const N = 24; // max concurrent droplets

const source = Skia.RuntimeEffect.Make(`
uniform float2 u_resolution;
uniform float u_time;
uniform float2 u_taps[${N}];
uniform float u_tapTimes[${N}];
uniform float u_tapSeed[${N}];

half4 main(float2 fragcoord) {
  float2 uv = fragcoord / u_resolution;
  // Calm dark pond: a subtle vertical gradient.
  half3 col = mix(half3(0.015, 0.03, 0.06), half3(0.03, 0.06, 0.11), uv.y);

  for (int i = 0; i < ${N}; i++) {
    float age = u_time - u_tapTimes[i];
    if (age < 0.0 || age > 1.9) { continue; }       // empty or expired
    float seed = u_tapSeed[i];
    float dist = length(fragcoord - u_taps[i]);

    float speed = 200.0 + seed * 70.0;
    float r = age * speed;                            // ring radius
    float width = 5.0 + seed * 4.0;
    float decay = 1.0 - age / 1.9;

    // Main expanding ring + a fainter one trailing inside it.
    float band = dist - r;
    float ring = exp(-(band * band) / (width * width));
    float band2 = dist - r * 0.6;
    float ring2 = exp(-(band2 * band2) / (width * width)) * 0.4;

    // A bright impact flash at the moment the drop lands.
    float flash = exp(-dist * dist / 420.0) * exp(-age * 16.0);

    col += half3(0.35, 0.6, 0.95) * (ring + ring2) * decay * 0.7;
    col += half3(0.7, 0.85, 1.0) * flash * 0.5;
  }

  // Tiny dither to hide banding on the dark gradient.
  float dither = fract(sin(dot(fragcoord, float2(12.9898, 78.233))) * 43758.5453);
  col += half3((dither - 0.5) / 255.0);
  return half4(col, 1.0);
}
`)!;

type Drop = { x: number; y: number; t: number; seed: number };

export default function FenceRaindrops() {
  const live = useExperimentActive();
  const { width, height } = useWindowDimensions();
  const clock = useClock();
  const taps = useSharedValue<Drop[]>([]);
  const holdPos = useRef({ x: 0, y: 0 });
  const streamRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rainRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  const spawnRef = useRef(spawn);
  spawnRef.current = spawn;

  // Ambient rain: a self-scheduling drop at a random spot while on-screen.
  const dimsRef = useRef({ width, height });
  dimsRef.current = { width, height };
  useEffect(() => {
    if (!live) return;
    const tick = () => {
      const { width: w, height: h } = dimsRef.current;
      spawnRef.current(Math.random() * w, Math.random() * h);
      rainRef.current = setTimeout(tick, 240 + Math.random() * 520);
    };
    rainRef.current = setTimeout(tick, 300);
    return () => {
      if (rainRef.current) clearTimeout(rainRef.current);
      rainRef.current = null;
    };
  }, [live]);

  // Touch: heavier rain where you hold.
  const scheduleStream = () => {
    streamRef.current = setTimeout(() => {
      spawnRef.current(
        holdPos.current.x + (Math.random() - 0.5) * 28,
        holdPos.current.y + (Math.random() - 0.5) * 28
      );
      scheduleStream();
    }, 80 + Math.random() * 140);
  };
  const startHold = (x: number, y: number) => {
    holdPos.current = { x, y };
    spawnRef.current(x, y);
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
