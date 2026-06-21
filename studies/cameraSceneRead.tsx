import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import Animated, {
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import {
  Camera,
  useFrameOutput,
  useObjectOutput,
  type CameraDevice,
  type Frame,
  type ScannedObject,
  type ScannedObjectType,
} from 'react-native-vision-camera';

// Scene read study: three signals fused over one preview.
//  1. Salient subject — Apple Vision's attention model boxes what it thinks the
//     main subject is (native object output, JS callback — no worklets).
//  2. Motion energy — mean frame-to-frame luma change drives a pulsing ring
//     and a percentage readout (frame processor).
//  3. Brightest-point reticle — chases the frame's brightest region (same pass).
const SALIENT_TYPES: ScannedObjectType[] = ['salient-object'];
const GRID = 20; // luma sample grid for motion + brightest point
const RETICLE = 60;

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

function makeSceneProcessor(
  energySV: SharedValue<number>,
  bxSV: SharedValue<number>,
  bySV: SharedValue<number>,
  prevSV: SharedValue<number[]>,
  tickSV: SharedValue<number>,
) {
  return (frame: Frame) => {
    'worklet';
    try {
      tickSV.value = (tickSV.value + 1) % 2;
      if (tickSV.value !== 0) return;

      const w = frame.width;
      const h = frame.height;
      if (w <= 0 || h <= 0) return;

      const bytes = new Uint8Array(frame.getPixelBuffer());
      const len = bytes.length;
      if (len < 4) return;
      const bytesPerRow = Math.floor(len / h); // 'rgb' → BGRA, 4 bytes/px

      const cur: number[] = [];
      let maxL = -1;
      let mx = 0.5;
      let my = 0.5;

      for (let gy = 0; gy < GRID; gy++) {
        const fy = (gy + 0.5) / GRID;
        const py = Math.min(h - 1, Math.floor(fy * h));
        const rowOff = py * bytesPerRow;
        for (let gx = 0; gx < GRID; gx++) {
          const fx = (gx + 0.5) / GRID;
          const px = Math.min(w - 1, Math.floor(fx * w));
          const idx = rowOff + px * 4;
          let l = 0;
          if (idx + 2 < len) {
            const b = bytes[idx];
            const g = bytes[idx + 1];
            const r = bytes[idx + 2];
            l = r * 0.299 + g * 0.587 + b * 0.114;
          }
          cur.push(l);
          if (l > maxL) {
            maxL = l;
            mx = fx;
            my = fy;
          }
        }
      }

      const prev = prevSV.value;
      if (prev.length === cur.length) {
        let diff = 0;
        for (let i = 0; i < cur.length; i++) diff += Math.abs(cur[i] - prev[i]);
        const e = diff / cur.length / 255; // 0..1 mean change
        energySV.value = Math.min(1, e * 5); // amplify for sensitivity
      }
      prevSV.value = cur;

      bxSV.value = mx;
      bySV.value = my;
    } finally {
      frame.dispose();
    }
  };
}

type Box = { x: number; y: number; width: number; height: number } | null;

export function SceneReadStudy({ device }: { device: CameraDevice }) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [box, setBox] = useState<Box>(null);

  const energySV = useSharedValue(0);
  const bxSV = useSharedValue(0.5);
  const bySV = useSharedValue(0.5);
  const prevSV = useSharedValue<number[]>([]);
  const tickSV = useSharedValue(0);

  const frameOutput = useFrameOutput({
    pixelFormat: 'rgb',
    targetResolution: { width: 320, height: 240 },
    onFrame: makeSceneProcessor(energySV, bxSV, bySV, prevSV, tickSV),
  });
  const objectOutput = useObjectOutput({
    types: SALIENT_TYPES,
    onObjectsScanned: (objects: ScannedObject[]) => {
      const o = objects[0];
      setBox(o ? { ...o.boundingBox } : null);
    },
  });

  const reticleStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: bxSV.value * size.w - RETICLE / 2 },
      { translateY: bySV.value * size.h - RETICLE / 2 },
    ],
  }));
  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 0.6 + energySV.value * 0.9 }],
    opacity: 0.12 + energySV.value * 0.6,
  }));
  const motionProps = useAnimatedProps(
    () => ({ text: `Motion ${Math.round(energySV.value * 100)}%` }) as any,
  );

  return (
    <View
      style={styles.fill}
      onLayout={(e) =>
        setSize({
          w: e.nativeEvent.layout.width,
          h: e.nativeEvent.layout.height,
        })
      }
    >
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive
        outputs={[frameOutput, objectOutput]}
      />

      {/* motion pulse (center) */}
      <View style={styles.pulseWrap} pointerEvents="none">
        <Animated.View style={[styles.pulse, pulseStyle]} />
      </View>

      {/* salient subject box */}
      {box && size.w > 0 && (
        <View
          pointerEvents="none"
          style={[
            styles.salient,
            {
              left: box.x * size.w,
              top: box.y * size.h,
              width: box.width * size.w,
              height: box.height * size.h,
            },
          ]}
        />
      )}

      {/* brightest-point reticle */}
      <Animated.View style={[styles.reticle, reticleStyle]} pointerEvents="none" />

      {/* motion readout */}
      <View style={styles.pill} pointerEvents="none">
        <AnimatedTextInput
          style={styles.pillText}
          editable={false}
          underlineColorAndroid="transparent"
          defaultValue=""
          animatedProps={motionProps}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pulseWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulse: {
    width: 220,
    height: 220,
    borderRadius: 110,
    borderWidth: 4,
    borderColor: '#6c5ce7',
  },
  salient: {
    position: 'absolute',
    borderWidth: 2.5,
    borderColor: 'rgba(80,255,170,0.95)',
    borderRadius: 10,
  },
  reticle: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: RETICLE,
    height: RETICLE,
    borderRadius: RETICLE / 2,
    borderWidth: 3,
    borderColor: 'rgba(255,255,80,0.95)',
  },
  pill: {
    position: 'absolute',
    bottom: 52,
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  pillText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    padding: 0,
    minWidth: 110,
    textAlign: 'center',
  },
});
