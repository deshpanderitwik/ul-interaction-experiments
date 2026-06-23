import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useExperimentActive } from './_host';

// Sample experiment: tap anywhere to step the canvas through a palette.
// Demonstrates the experiment contract — a self-contained, full-screen,
// default-exported component that reads useExperimentActive() (here it simply
// ignores taps while inactive; a camera/sensor experiment would start/stop).
const PALETTE = ['#000000', '#11162e', '#2a1140', '#451126', '#0f4030', '#5b8cff'];

export default function TapColor() {
  const active = useExperimentActive();
  const [i, setI] = useState(0);

  return (
    <Pressable
      style={[styles.fill, { backgroundColor: PALETTE[i] }]}
      onPress={() => {
        if (!active) return;
        Haptics.selectionAsync();
        setI((prev) => (prev + 1) % PALETTE.length);
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
