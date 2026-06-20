import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getSketch } from '../../sketches/registry';

export default function SketchScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const sketch = getSketch(id);
  // "Immersive" = chrome hidden, ready for a clean iOS screen recording.
  const [immersive, setImmersive] = useState(false);
  const insets = useSafeAreaInsets();

  if (!sketch) {
    return (
      <View style={styles.missing}>
        <Text style={styles.missingText}>No sketch “{id}”.</Text>
      </View>
    );
  }

  const { Component, title } = sketch;
  return (
    <View style={styles.fill}>
      {/* Hide the nav header and status bar in immersive mode. Pure JS — ships OTA. */}
      <Stack.Screen options={{ title, headerShown: !immersive }} />
      <StatusBar style="light" hidden={immersive} animated />

      <Component />

      {/* Chrome toggle. Visible pill when off; a transparent corner hotspot when
          on, so it never shows up in the recording but a tap still brings UI back.
          Lives in the top-right safe area, away from center-stage interactions. */}
      <Pressable
        onPress={() => setImmersive((v) => !v)}
        hitSlop={12}
        style={[
          styles.toggle,
          { top: insets.top + 8, right: insets.right + 12 },
          immersive ? styles.toggleHidden : styles.toggleVisible,
        ]}
      >
        {!immersive && <Text style={styles.toggleLabel}>Hide UI</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#0b0b0f' },
  missing: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0b0b0f',
  },
  missingText: { color: '#8a8a99', fontSize: 16 },
  toggle: {
    position: 'absolute',
    minWidth: 44,
    minHeight: 32,
    paddingHorizontal: 12,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleVisible: { backgroundColor: 'rgba(255,255,255,0.10)' },
  // Transparent but still tappable: invisible in the recording, taps still land.
  toggleHidden: { backgroundColor: 'transparent' },
  toggleLabel: { color: '#cfcfe0', fontSize: 13, fontWeight: '600' },
});
