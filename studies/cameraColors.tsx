import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';
import type { Frame } from 'react-native-vision-camera';

// Dominant-colors study: a frame processor that buckets the frame's pixels
// into a coarse 4×4×4 RGB histogram, then surfaces the three fullest buckets
// (averaged back to real colors) as the camera's three dominant colors. Runs
// on vision-camera's frame-output worklet thread; results are handed to the UI
// through a reanimated shared value so the swatches update without React renders.

const LEVELS = 4; // quantization levels per channel → 4×4×4 = 64 buckets
const SHIFT = 6; // 8-bit channel >> 6 maps 0..255 → 0..3
const NB = LEVELS * LEVELS * LEVELS; // 64
const GRID = 32; // sample a 32×32 grid of pixels per processed frame
const EVERY = 4; // process every Nth frame to keep the pipeline cheap

function hex2(n: number) {
  'worklet';
  const h = '0123456789abcdef';
  return h[(n >> 4) & 0xf] + h[n & 0xf];
}

/**
 * Build the `onFrame` worklet. `colorsSV` receives three hex strings (fullest
 * bucket first); `tickSV` is scratch state for frame-skipping.
 */
export function makeColorProcessor(
  colorsSV: SharedValue<string[]>,
  tickSV: SharedValue<number>,
) {
  return (frame: Frame) => {
    'worklet';
    try {
      tickSV.value = (tickSV.value + 1) % EVERY;
      if (tickSV.value !== 0) return; // skip frames between samples

      const w = frame.width;
      const h = frame.height;
      if (w <= 0 || h <= 0) return;

      const bytes = new Uint8Array(frame.getPixelBuffer());
      const len = bytes.length;
      if (len < 4) return;

      // 'rgb' was requested; on iOS that resolves to BGRA 8-bit — 4 bytes/pixel
      // in B,G,R,A order. Derive the row stride from the buffer in case rows
      // are padded for alignment.
      const bytesPerRow = Math.floor(len / h);

      const counts = new Int32Array(NB);
      const rs = new Float64Array(NB);
      const gs = new Float64Array(NB);
      const bs = new Float64Array(NB);

      for (let gy = 0; gy < GRID; gy++) {
        const py = Math.min(h - 1, Math.floor(((gy + 0.5) / GRID) * h));
        const rowOff = py * bytesPerRow;
        for (let gx = 0; gx < GRID; gx++) {
          const px = Math.min(w - 1, Math.floor(((gx + 0.5) / GRID) * w));
          const idx = rowOff + px * 4;
          if (idx + 2 >= len) continue;
          const b = bytes[idx];
          const g = bytes[idx + 1];
          const r = bytes[idx + 2];
          const key =
            ((r >> SHIFT) * LEVELS + (g >> SHIFT)) * LEVELS + (b >> SHIFT);
          counts[key]++;
          rs[key] += r;
          gs[key] += g;
          bs[key] += b;
        }
      }

      // top three buckets by population
      const top = [-1, -1, -1];
      const topC = [0, 0, 0];
      for (let i = 0; i < NB; i++) {
        const c = counts[i];
        if (c > topC[0]) {
          top[2] = top[1]; topC[2] = topC[1];
          top[1] = top[0]; topC[1] = topC[0];
          top[0] = i; topC[0] = c;
        } else if (c > topC[1]) {
          top[2] = top[1]; topC[2] = topC[1];
          top[1] = i; topC[1] = c;
        } else if (c > topC[2]) {
          top[2] = i; topC[2] = c;
        }
      }

      const out: string[] = [];
      for (let k = 0; k < 3; k++) {
        const i = top[k];
        if (i < 0 || topC[k] === 0) {
          out.push('');
          continue;
        }
        const n = counts[i];
        const r = Math.round(rs[i] / n);
        const g = Math.round(gs[i] / n);
        const b = Math.round(bs[i] / n);
        out.push('#' + hex2(r) + hex2(g) + hex2(b));
      }
      colorsSV.value = out;
    } finally {
      frame.dispose();
    }
  };
}

/** The three dominant-color swatches, bottom-center over the preview. */
export function ColorSwatches({ colorsSV }: { colorsSV: SharedValue<string[]> }) {
  return (
    <View style={styles.row} pointerEvents="none">
      <Swatch colorsSV={colorsSV} index={0} />
      <Swatch colorsSV={colorsSV} index={1} />
      <Swatch colorsSV={colorsSV} index={2} />
    </View>
  );
}

function Swatch({
  colorsSV,
  index,
}: {
  colorsSV: SharedValue<string[]>;
  index: number;
}) {
  const style = useAnimatedStyle(() => {
    const c = colorsSV.value[index];
    return { backgroundColor: c && c.length === 7 ? c : 'transparent' };
  });
  return <Animated.View style={[styles.swatch, style]} />;
}

const styles = StyleSheet.create({
  row: {
    position: 'absolute',
    bottom: 44,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  swatch: {
    width: 56,
    height: 56,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.65)',
    backgroundColor: 'transparent',
  },
});
