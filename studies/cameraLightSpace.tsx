import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, {
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import {
  Camera,
  useDepthOutput,
  useFrameOutput,
  type CameraDevice,
  type Depth,
  type Frame,
} from 'react-native-vision-camera';

// Light & space study: three signals fused over one preview.
//  1. Color temperature — warm↔cool estimate from the frame's R/B balance.
//  2. Brightest-point tracker — a reticle chasing the frame's brightest region.
//  3. Depth distance — nearest object in metres (LiDAR/TrueDepth only; degrades
//     to "No depth" on cameras without a depth stream).
// (1) and (2) share a single frame-processor pass; (3) is a separate depth
// output, only attached when the device reports a depth media type.

const RGB_GRID = 28; // sample grid for the colour/brightness pass
const DEPTH_GRID = 20; // sample grid for the depth pass
const RETICLE = 64;

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

function hex2(n: number) {
  'worklet';
  const h = '0123456789abcdef';
  const v = n < 0 ? 0 : n > 255 ? 255 : n;
  return h[(v >> 4) & 0xf] + h[v & 0xf];
}

// IEEE-754 half-float (16-bit) → number, for depth-16-bit / disparity-16-bit.
function halfToFloat(h: number) {
  'worklet';
  const s = (h & 0x8000) >> 15;
  const e = (h & 0x7c00) >> 10;
  const f = h & 0x03ff;
  if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
  if (e === 31) return f ? NaN : (s ? -1 : 1) * Infinity;
  return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
}

function makeLightProcessor(
  kelvinSV: SharedValue<number>,
  tintSV: SharedValue<string>,
  bxSV: SharedValue<number>,
  bySV: SharedValue<number>,
  tickSV: SharedValue<number>,
) {
  return (frame: Frame) => {
    'worklet';
    try {
      tickSV.value = (tickSV.value + 1) % 3;
      if (tickSV.value !== 0) return;

      const w = frame.width;
      const h = frame.height;
      if (w <= 0 || h <= 0) return;

      const bytes = new Uint8Array(frame.getPixelBuffer());
      const len = bytes.length;
      if (len < 4) return;
      const bytesPerRow = Math.floor(len / h); // 'rgb' → BGRA, 4 bytes/px

      let sumR = 0;
      let sumB = 0;
      let cnt = 0;
      let maxL = -1;
      let mx = 0.5;
      let my = 0.5;

      for (let gy = 0; gy < RGB_GRID; gy++) {
        const fy = (gy + 0.5) / RGB_GRID;
        const py = Math.min(h - 1, Math.floor(fy * h));
        const rowOff = py * bytesPerRow;
        for (let gx = 0; gx < RGB_GRID; gx++) {
          const fx = (gx + 0.5) / RGB_GRID;
          const px = Math.min(w - 1, Math.floor(fx * w));
          const idx = rowOff + px * 4;
          if (idx + 2 >= len) continue;
          const b = bytes[idx];
          const g = bytes[idx + 1];
          const r = bytes[idx + 2];
          sumR += r;
          sumB += b;
          cnt++;
          const l = r * 0.299 + g * 0.587 + b * 0.114;
          if (l > maxL) {
            maxL = l;
            mx = fx;
            my = fy;
          }
        }
      }
      if (cnt === 0) return;

      const avgR = sumR / cnt;
      const avgB = sumB / cnt;
      const ratio = (avgR - avgB) / (avgR + avgB + 1); // -1 cool .. +1 warm
      let k = Math.round(5500 - ratio * 3000);
      if (k < 2200) k = 2200;
      if (k > 9000) k = 9000;
      kelvinSV.value = k;

      // warm → amber, cool → blue
      const t = (ratio + 1) / 2; // 0 cool .. 1 warm
      const tr = Math.round(110 + t * 145);
      const tg = Math.round(150 + (1 - Math.abs(ratio)) * 55);
      const tb = Math.round(255 - t * 185);
      tintSV.value = '#' + hex2(tr) + hex2(tg) + hex2(tb);

      bxSV.value = mx;
      bySV.value = my;
    } finally {
      frame.dispose();
    }
  };
}

function makeDepthProcessor(
  distSV: SharedValue<number>,
  tickSV: SharedValue<number>,
) {
  return (depth: Depth) => {
    'worklet';
    try {
      tickSV.value = (tickSV.value + 1) % 3;
      if (tickSV.value !== 0) return;

      const w = depth.width;
      const h = depth.height;
      if (w <= 0 || h <= 0) {
        distSV.value = -1;
        return;
      }

      const fmt = depth.pixelFormat;
      const is32 = fmt === 'depth-32-bit' || fmt === 'disparity-32-bit';
      const isDisparity =
        fmt === 'disparity-16-bit' || fmt === 'disparity-32-bit';
      const bpr = depth.bytesPerRow;
      const buf = depth.getDepthData();
      const v32 = is32 ? new Float32Array(buf) : null;
      const v16 = is32 ? null : new Uint16Array(buf);
      const rowStride = is32 ? bpr >> 2 : bpr >> 1;

      let nearest = Infinity;
      for (let gy = 0; gy < DEPTH_GRID; gy++) {
        const py = Math.min(h - 1, Math.floor(((gy + 0.5) / DEPTH_GRID) * h));
        for (let gx = 0; gx < DEPTH_GRID; gx++) {
          const px = Math.min(w - 1, Math.floor(((gx + 0.5) / DEPTH_GRID) * w));
          const i = py * rowStride + px;
          let v: number;
          if (is32) {
            if (v32 == null || i >= v32.length) continue;
            v = v32[i];
          } else {
            if (v16 == null || i >= v16.length) continue;
            v = halfToFloat(v16[i]);
          }
          if (!(v > 0) || !isFinite(v)) continue;
          const meters = isDisparity ? 1 / v : v;
          if (meters > 0 && meters < nearest) nearest = meters;
        }
      }
      distSV.value = isFinite(nearest) ? nearest : -1;
    } finally {
      depth.dispose();
    }
  };
}

export function LightSpaceStudy({ device }: { device: CameraDevice }) {
  const supportsDepth = device.mediaTypes?.includes?.('depth') ?? false;
  const [size, setSize] = useState({ w: 0, h: 0 });

  const kelvinSV = useSharedValue(5500);
  const tintSV = useSharedValue('#888888');
  const bxSV = useSharedValue(0.5);
  const bySV = useSharedValue(0.5);
  const distSV = useSharedValue(-1);
  const tickSV = useSharedValue(0);
  const depthTickSV = useSharedValue(0);

  const frameOutput = useFrameOutput({
    pixelFormat: 'rgb',
    targetResolution: { width: 320, height: 240 },
    onFrame: makeLightProcessor(kelvinSV, tintSV, bxSV, bySV, tickSV),
  });
  const depthOutput = useDepthOutput({
    targetResolution: { width: 160, height: 120 },
    onDepth: makeDepthProcessor(distSV, depthTickSV),
  });

  const reticleStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: bxSV.value * size.w - RETICLE / 2 },
      { translateY: bySV.value * size.h - RETICLE / 2 },
    ],
  }));
  const dotStyle = useAnimatedStyle(() => ({ backgroundColor: tintSV.value }));
  const tempProps = useAnimatedProps(() => {
    const k = Math.round(kelvinSV.value);
    const label = k < 4200 ? 'Warm' : k > 6500 ? 'Cool' : 'Neutral';
    return { text: `~${k}K · ${label}` } as any;
  });
  const distProps = useAnimatedProps(() => {
    const d = distSV.value;
    return { text: d > 0 ? `${d.toFixed(2)} m` : '—' } as any;
  });

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
        outputs={supportsDepth ? [frameOutput, depthOutput] : [frameOutput]}
      />

      {/* brightest-point reticle */}
      <Animated.View
        style={[styles.reticle, reticleStyle]}
        pointerEvents="none"
      />

      {/* color temperature */}
      <View style={styles.topPill} pointerEvents="none">
        <Animated.View style={[styles.dot, dotStyle]} />
        <AnimatedTextInput
          style={styles.pillText}
          editable={false}
          underlineColorAndroid="transparent"
          defaultValue=""
          animatedProps={tempProps}
        />
      </View>

      {/* depth distance */}
      <View style={styles.bottomPill} pointerEvents="none">
        {supportsDepth ? (
          <AnimatedTextInput
            style={styles.pillText}
            editable={false}
            underlineColorAndroid="transparent"
            defaultValue=""
            animatedProps={distProps}
          />
        ) : (
          <Text style={styles.pillText}>No depth on this camera</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
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
  topPill: {
    position: 'absolute',
    top: 56,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  bottomPill: {
    position: 'absolute',
    bottom: 52,
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  dot: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#888' },
  pillText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    padding: 0,
    minWidth: 60,
    textAlign: 'center',
  },
});
