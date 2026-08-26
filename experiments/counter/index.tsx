import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

// Counter — the smallest possible experiment: one number, and tapping
// anywhere increments it. Exists to prove the OTA pipeline end-to-end.

const ACCENT = '#ffe08a';

export default function Counter() {
  const [count, setCount] = useState(0);

  return (
    <Pressable
      style={styles.fill}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setCount((c) => c + 1);
      }}
    >
      <Text style={styles.number}>{count}</Text>
      <Text style={styles.hint}>tap anywhere</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  number: {
    color: ACCENT,
    fontSize: 120,
    fontVariant: ['tabular-nums'],
    fontWeight: '200',
  },
  hint: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 13,
    marginTop: 12,
    letterSpacing: 1,
  },
});
