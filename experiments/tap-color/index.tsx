import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useExperimentActive } from '../_host';
import { PALETTE, next } from './shared';

// Base experiment: tap anywhere to step the canvas through a palette.
// Reads useExperimentActive() so it ignores taps while off-screen/backgrounded
// (the pattern a camera/sensor experiment would use to start/stop hardware).
export default function TapColor() {
  const active = useExperimentActive();
  const [i, setI] = useState(0);

  return (
    <Pressable
      style={[styles.fill, { backgroundColor: PALETTE[i] }]}
      onPress={() => {
        if (!active) return;
        Haptics.selectionAsync();
        setI(next);
      }}
    >
      <Text style={styles.hint}>tap anywhere</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hint: { color: 'rgba(255,255,255,0.35)', fontSize: 16, letterSpacing: 1 },
});
