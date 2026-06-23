import { Canvas, Fill, LinearGradient } from '@shopify/react-native-skia';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useExperimentActive } from '../_host';
import { PALETTE, next } from './shared';

// Config-driven Tap Color. Each "variation" is just a preset of this config
// (see registry.ts), so combinations come for free. The axes are orthogonal:
//   fill   — solid | gradient
//   motion — none | flip (tap flips gradient) | drift (gradient auto-rotates)
//   strobe — composable black overlay that square-waves over any fill
// All variations keep the shared tap-to-advance-the-palette mechanic.
export type TapColorConfig = {
  fill?: 'solid' | 'gradient';
  motion?: 'none' | 'flip' | 'drift';
  strobe?: boolean;
};

export default function TapColor({
  fill = 'solid',
  motion = 'none',
  strobe = false,
}: TapColorConfig = {}) {
  const active = useExperimentActive();
  const { width, height } = useWindowDimensions();
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);

  // Gradient drift: rotate the gradient axis around the center.
  const phase = useSharedValue(0);
  const drifting = fill === 'gradient' && motion === 'drift';
  useEffect(() => {
    if (!drifting || !active) {
      cancelAnimation(phase);
      return;
    }
    phase.value = withRepeat(
      withTiming(1, { duration: 9000, easing: Easing.linear }),
      -1,
      false
    );
    return () => cancelAnimation(phase);
  }, [drifting, active, phase]);

  // Strobe: a black overlay whose opacity hard-toggles (~2.9 flashes/sec).
  const flash = useSharedValue(0);
  useEffect(() => {
    if (!strobe || !active) {
      cancelAnimation(flash);
      flash.value = 0;
      return;
    }
    flash.value = 0;
    flash.value = withRepeat(
      withTiming(1, { duration: 170, easing: Easing.linear }),
      -1,
      true
    );
    return () => cancelAnimation(flash);
  }, [strobe, active, flash]);
  const strobeStyle = useAnimatedStyle(() => ({
    opacity: flash.value < 0.5 ? 0 : 1,
  }));

  // Gradient endpoints: drift animates them; flip toggles direction on tap.
  const start = useDerivedValue(() => {
    if (motion === 'drift') {
      const a = phase.value * Math.PI * 2;
      return {
        x: width / 2 + Math.cos(a) * width * 0.45,
        y: height / 2 + Math.sin(a) * height * 0.45,
      };
    }
    return flipped ? { x: width, y: height } : { x: 0, y: 0 };
  }, [width, height, motion, flipped]);
  const end = useDerivedValue(() => {
    if (motion === 'drift') {
      const a = phase.value * Math.PI * 2;
      return {
        x: width / 2 - Math.cos(a) * width * 0.45,
        y: height / 2 - Math.sin(a) * height * 0.45,
      };
    }
    return flipped ? { x: 0, y: 0 } : { x: width, y: height };
  }, [width, height, motion, flipped]);

  const hint =
    motion === 'flip'
      ? 'tap to flip'
      : fill === 'solid' && motion === 'none' && !strobe
        ? 'tap anywhere'
        : 'tap to change color';

  return (
    <Pressable
      style={styles.fill}
      onPress={() => {
        if (!active) return;
        Haptics.selectionAsync();
        setI(next);
        if (fill === 'gradient' && motion === 'flip') setFlipped((f) => !f);
      }}
    >
      {fill === 'gradient' ? (
        <Canvas style={StyleSheet.absoluteFill}>
          <Fill>
            <LinearGradient
              start={start}
              end={end}
              colors={[PALETTE[i], PALETTE[next(i)]]}
            />
          </Fill>
        </Canvas>
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: PALETTE[i] }]} />
      )}

      {strobe ? (
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, styles.black, strobeStyle]}
        />
      ) : null}

      <Text style={styles.hint}>{hint}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  black: { backgroundColor: '#000' },
  hint: { color: 'rgba(255,255,255,0.4)', fontSize: 16, letterSpacing: 1 },
});
