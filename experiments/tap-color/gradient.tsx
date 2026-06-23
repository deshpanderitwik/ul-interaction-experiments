import { Canvas, Fill, LinearGradient, vec } from '@shopify/react-native-skia';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions } from 'react-native';
import { useExperimentActive } from '../_host';
import { PALETTE, next } from './shared';

// Variation of Tap Color: renders a two-stop gradient instead of a solid
// fill, and each tap flips the gradient's direction (and advances the palette,
// the mechanic it inherits from the base).
export default function TapColorGradient() {
  const active = useExperimentActive();
  const { width, height } = useWindowDimensions();
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);

  const colors = [PALETTE[i], PALETTE[next(i)]];
  const start = flipped ? vec(width, height) : vec(0, 0);
  const end = flipped ? vec(0, 0) : vec(width, height);

  return (
    <Pressable
      style={styles.fill}
      onPress={() => {
        if (!active) return;
        Haptics.selectionAsync();
        setFlipped((f) => !f);
        setI(next);
      }}
    >
      <Canvas style={StyleSheet.absoluteFill}>
        <Fill>
          <LinearGradient start={start} end={end} colors={colors} />
        </Fill>
      </Canvas>
      <Text style={styles.hint}>tap to flip</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hint: { color: 'rgba(255,255,255,0.4)', fontSize: 16, letterSpacing: 1 },
});
