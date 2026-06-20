import { useState } from 'react';
import * as Haptics from 'expo-haptics';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import type { Sketch } from './types';

type Drop = { key: number; x: number; y: number };

// Tap anywhere: a ring blooms from the touch point and fades, with a light
// haptic tick. The simplest possible "did the OTA update land?" canary —
// pure JS over reanimated + expo-haptics, no native rebuild needed.
function Ripple({ x, y, onDone }: { x: number; y: number; onDone: () => void }) {
  const progress = useSharedValue(0);

  // animate once on mount, then ask the parent to drop us from the list
  if (progress.value === 0) {
    progress.value = withTiming(1, { duration: 700 }, (finished) => {
      if (finished) runOnJS(onDone)();
    });
  }

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: 0.2 + progress.value * 2.6 }],
    opacity: 1 - progress.value,
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.ring, { left: x - 40, top: y - 40 }, style]}
    />
  );
}

function TapRipple() {
  const [drops, setDrops] = useState<Drop[]>([]);

  const spawn = (x: number, y: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setDrops((d) => [...d, { key: Date.now() + Math.random(), x, y }]);
  };

  const tap = Gesture.Tap().onEnd((e) => {
    runOnJS(spawn)(e.x, e.y);
  });

  return (
    <GestureDetector gesture={tap}>
      <View style={styles.fill}>
        <Text style={styles.hint}>Tap anywhere — it ripples</Text>
        {drops.map((d) => (
          <Ripple
            key={d.key}
            x={d.x}
            y={d.y}
            onDone={() =>
              setDrops((list) => list.filter((r) => r.key !== d.key))
            }
          />
        ))}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#0b0b0f' },
  hint: {
    color: '#8a8a99',
    fontSize: 15,
    textAlign: 'center',
    marginTop: 48,
  },
  ring: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2,
    borderColor: '#00d2a8',
  },
});

const sketch: Sketch = {
  id: 'tap-ripple',
  title: 'Tap ripple',
  description: 'Tap anywhere — a ring blooms and fades, with a light haptic tick.',
  Component: TapRipple,
};

export default sketch;
