import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

// A reusable, controlled slider built on gesture-handler (no native slider dep,
// so it ships OTA). Touch or drag anywhere on the track to set the value;
// emits stepped values live. Colors are parameterized for reuse elsewhere.
export type SliderProps = {
  value: number;
  minimumValue: number;
  maximumValue: number;
  step?: number;
  onValueChange: (value: number) => void;
  trackColor?: string;
  fillColor?: string;
  thumbColor?: string;
};

const THUMB = 20;

export function Slider({
  value,
  minimumValue,
  maximumValue,
  step = 0,
  onValueChange,
  trackColor = 'rgba(255,255,255,0.18)',
  fillColor = '#5b8cff',
  thumbColor = '#ffffff',
}: SliderProps) {
  const [width, setWidth] = useState(0);
  const lastRef = useRef(value);
  const range = maximumValue - minimumValue || 1;
  const ratio = Math.max(0, Math.min(1, (value - minimumValue) / range));
  const x = ratio * width;

  const emit = (px: number) => {
    if (width <= 0) return;
    const r = Math.max(0, Math.min(1, px / width));
    let v = minimumValue + r * range;
    if (step > 0) v = Math.round(v / step) * step;
    v = Math.max(minimumValue, Math.min(maximumValue, v));
    if (v !== lastRef.current) {
      lastRef.current = v;
      onValueChange(v);
    }
  };

  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => runOnJS(emit)(e.x))
    .onUpdate((e) => runOnJS(emit)(e.x));

  return (
    <GestureDetector gesture={pan}>
      <View
        style={styles.touch}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      >
        <View style={[styles.track, { backgroundColor: trackColor }]} />
        <View style={[styles.fill, { width: x, backgroundColor: fillColor }]} />
        <View
          style={[
            styles.thumb,
            {
              left: Math.max(0, Math.min(width - THUMB, x - THUMB / 2)),
              backgroundColor: thumbColor,
            },
          ]}
        />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  touch: { height: 40, justifyContent: 'center' },
  track: { position: 'absolute', left: 0, right: 0, height: 4, borderRadius: 2 },
  fill: { position: 'absolute', left: 0, height: 4, borderRadius: 2 },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    top: 10,
  },
});
