import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useExperimentActive } from '../_host';
import { PALETTE, next } from './shared';

// Variation: the solid color strobes on/off against black. Rate is kept just
// under ~3 flashes/sec on purpose (photosensitivity); tune `duration` to taste.
// Retains tap-to-change-color. Strobe runs only while active.
export default function TapColorStrobe() {
  const active = useExperimentActive();
  const [i, setI] = useState(0);
  const flash = useSharedValue(0);

  useEffect(() => {
    if (!active) {
      cancelAnimation(flash);
      flash.value = 1; // settle on solid color when not running
      return;
    }
    flash.value = 0;
    flash.value = withRepeat(
      withTiming(1, { duration: 170, easing: Easing.linear }),
      -1,
      true
    );
    return () => cancelAnimation(flash);
  }, [active, flash]);

  // Hard square-wave strobe: black for half the cycle, the color for the other.
  const style = useAnimatedStyle(
    () => ({ backgroundColor: flash.value < 0.5 ? '#000000' : PALETTE[i] }),
    [i]
  );

  return (
    <Pressable
      style={styles.fill}
      onPress={() => {
        if (!active) return;
        Haptics.selectionAsync();
        setI(next);
      }}
    >
      <Animated.View style={[StyleSheet.absoluteFill, style]} />
      <Text style={styles.hint}>tap to change color</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hint: { color: 'rgba(255,255,255,0.45)', fontSize: 16, letterSpacing: 1 },
});
