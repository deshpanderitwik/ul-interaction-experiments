import { Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { getSketch } from '../../sketches/registry';

export default function SketchScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const sketch = getSketch(id);

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
      <Stack.Screen options={{ title }} />
      <Component />
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
});
