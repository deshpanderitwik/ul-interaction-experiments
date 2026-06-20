import { Canvas, Circle, Path, Skia } from '@shopify/react-native-skia';
import { Stack, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { getSketch } from '../../sketches/registry';

// A crisp monochrome eye, drawn with Skia so it needs no icon font and ships
// over-the-air on the existing native build.
//
// Skia's <Canvas> is a native Metal view whose first frame is opaque — against
// the dark header that reads as a white flash on every mount. We render it
// transparent (opaque={false}) and fade it in once it has painted, so the
// opaque first frame happens while invisible.
function EyeIcon({ color = '#e8e8f0', size = 24 }: { color?: string; size?: number }) {
  const outline = useMemo(() => {
    const p = Skia.Path.Make();
    p.moveTo(3, 12);
    p.quadTo(12, 4, 21, 12);
    p.quadTo(12, 20, 3, 12);
    p.close();
    return p;
  }, []);

  const opacity = useSharedValue(0);
  useEffect(() => {
    opacity.value = withTiming(1, { duration: 120 });
  }, [opacity]);
  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View style={[{ width: size, height: size }, fade]}>
      <Canvas style={{ flex: 1 }} opaque={false}>
        <Path
          path={outline}
          color={color}
          style="stroke"
          strokeWidth={2}
          strokeJoin="round"
          strokeCap="round"
        />
        <Circle cx={12} cy={12} r={3.4} color={color} style="stroke" strokeWidth={2} />
      </Canvas>
    </Animated.View>
  );
}

export default function SketchScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const sketch = getSketch(id);
  // "Immersive" = chrome hidden, ready for a clean iOS screen recording.
  const [immersive, setImmersive] = useState(false);
  const insets = useSafeAreaInsets();
  // Double-tap (top-right) to bring the chrome back, so a stray single tap
  // mid-recording doesn't reveal the UI. Implemented with gesture-handler so it
  // reliably wins over any touch handling inside the sketch underneath.
  const restoreGesture = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(2)
        .maxDuration(600)
        .runOnJS(true)
        .onEnd(() => setImmersive(false)),
    [],
  );

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
      <Stack.Screen
        options={{
          title,
          headerShown: !immersive,
          // Just the back chevron, no "Sketches" label.
          headerBackButtonDisplayMode: 'minimal',
          // Eye toggle lives on the top bar; tap to hide all chrome.
          headerRight: () => (
            <Pressable onPress={() => setImmersive(true)} hitSlop={12} style={styles.eyeBtn}>
              <EyeIcon />
            </Pressable>
          ),
        }}
      />
      <StatusBar style="light" hidden={immersive} animated />

      <Component />

      {/* In immersive mode the eye is gone with the header; a transparent
          top-right hotspot restores the chrome on a double-tap. */}
      {immersive && (
        <GestureDetector gesture={restoreGesture}>
          <View style={[styles.restoreHotspot, { top: insets.top, right: insets.right }]} />
        </GestureDetector>
      )}
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
  eyeBtn: { paddingHorizontal: 4, paddingVertical: 4 },
  restoreHotspot: { position: 'absolute', width: 140, height: 120 },
});
