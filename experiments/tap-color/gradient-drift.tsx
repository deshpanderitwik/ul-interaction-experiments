import { Canvas, Fill, LinearGradient } from '@shopify/react-native-skia';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions } from 'react-native';
import {
  Easing,
  cancelAnimation,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useExperimentActive } from '../_host';
import { PALETTE, next } from './shared';

// Variation: the two-stop gradient slowly drifts — its axis rotates around the
// center for subtle, continuous motion. Retains tap-to-change-color. The
// animation runs only while active (stops on blur/background).
export default function TapColorGradientDrift() {
  const active = useExperimentActive();
  const { width, height } = useWindowDimensions();
  const [i, setI] = useState(0);
  const phase = useSharedValue(0);

  useEffect(() => {
    if (!active) {
      cancelAnimation(phase);
      return;
    }
    phase.value = withRepeat(
      withTiming(1, { duration: 9000, easing: Easing.linear }),
      -1,
      false
    );
    return () => cancelAnimation(phase);
  }, [active, phase]);

  const start = useDerivedValue(() => {
    const a = phase.value * Math.PI * 2;
    return {
      x: width / 2 + Math.cos(a) * width * 0.45,
      y: height / 2 + Math.sin(a) * height * 0.45,
    };
  }, [width, height]);

  const end = useDerivedValue(() => {
    const a = phase.value * Math.PI * 2;
    return {
      x: width / 2 - Math.cos(a) * width * 0.45,
      y: height / 2 - Math.sin(a) * height * 0.45,
    };
  }, [width, height]);

  const colors = [PALETTE[i], PALETTE[next(i)]];

  return (
    <Pressable
      style={styles.fill}
      onPress={() => {
        if (!active) return;
        Haptics.selectionAsync();
        setI(next);
      }}
    >
      <Canvas style={StyleSheet.absoluteFill}>
        <Fill>
          <LinearGradient start={start} end={end} colors={colors} />
        </Fill>
      </Canvas>
      <Text style={styles.hint}>tap to change color</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hint: { color: 'rgba(255,255,255,0.4)', fontSize: 16, letterSpacing: 1 },
});
