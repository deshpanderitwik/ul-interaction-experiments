import { useState } from 'react';
import { LayoutRectangle, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { runOnJS } from 'react-native-reanimated';
import { FineHaptics } from '../modules/fine-haptics';
import type { Sketch } from './types';

// XY pad: X -> sharpness (soft..crisp), Y -> intensity (gentle..strong).
// Every time the finger moves enough, we ask the *native* CoreHaptics engine
// for a tap at that exact feel — something the JS-only haptics presets can't do.
function HapticPad() {
  const [pad, setPad] = useState<LayoutRectangle | null>(null);
  const [reading, setReading] = useState({ intensity: 0, sharpness: 0 });

  const dotX = useSharedValue(0);
  const dotY = useSharedValue(0);

  const fire = (px: number, py: number, w: number, h: number) => {
    const sharpness = Math.min(1, Math.max(0, px / w));
    const intensity = Math.min(1, Math.max(0, 1 - py / h)); // top = strong
    setReading({ intensity, sharpness });
    FineHaptics.transient(intensity, sharpness).catch(() => {});
  };

  let lastFireX = -999;
  let lastFireY = -999;
  const maybeFire = (px: number, py: number, w: number, h: number) => {
    if (Math.hypot(px - lastFireX, py - lastFireY) < 18) return; // throttle by distance
    lastFireX = px;
    lastFireY = py;
    fire(px, py, w, h);
  };

  const pan = Gesture.Pan()
    .onBegin((e) => {
      dotX.value = e.x;
      dotY.value = e.y;
      if (pad) runOnJS(fire)(e.x, e.y, pad.width, pad.height);
    })
    .onChange((e) => {
      dotX.value = e.x;
      dotY.value = e.y;
      if (pad) runOnJS(maybeFire)(e.x, e.y, pad.width, pad.height);
    });

  const dotStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: dotX.value - 16 },
      { translateY: dotY.value - 16 },
      { scale: withSpring(1) },
    ],
  }));

  return (
    <View style={styles.fill}>
      <Text style={styles.hint}>Drag the pad — native CoreHaptics follows your finger</Text>
      <GestureDetector gesture={pan}>
        <View
          style={styles.pad}
          onLayout={(e) => setPad(e.nativeEvent.layout)}
        >
          <Text style={[styles.axis, styles.axisTop]}>strong</Text>
          <Text style={[styles.axis, styles.axisBottom]}>gentle</Text>
          <Text style={[styles.axis, styles.axisLeft]}>soft</Text>
          <Text style={[styles.axis, styles.axisRight]}>crisp</Text>
          <Animated.View style={[styles.dot, dotStyle]} />
        </View>
      </GestureDetector>
      <Text style={styles.readout}>
        intensity {reading.intensity.toFixed(2)}   ·   sharpness {reading.sharpness.toFixed(2)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  hint: { color: '#8a8a99', marginBottom: 24, fontSize: 14, textAlign: 'center' },
  pad: {
    width: 300,
    height: 300,
    borderRadius: 24,
    backgroundColor: '#15151d',
    borderWidth: 1,
    borderColor: '#26263a',
    overflow: 'hidden',
  },
  dot: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#00d2a8',
  },
  axis: { position: 'absolute', color: '#3c3c52', fontSize: 12 },
  axisTop: { top: 8, alignSelf: 'center', left: 0, right: 0, textAlign: 'center' },
  axisBottom: { bottom: 8, alignSelf: 'center', left: 0, right: 0, textAlign: 'center' },
  axisLeft: { left: 8, top: '46%' },
  axisRight: { right: 8, top: '46%' },
  readout: { color: '#6c6c85', marginTop: 24, fontSize: 14, fontVariant: ['tabular-nums'] },
});

const sketch: Sketch = {
  id: 'haptic-pad',
  title: 'Haptic XY pad',
  description: 'Native CoreHaptics: drag to dial in intensity × sharpness in real time.',
  order: 50,
  Component: HapticPad,
};

export default sketch;
