import { Canvas, Circle, Path, Skia } from '@shopify/react-native-skia';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import GlassButton from '../../components/GlassButton';
import { getSketch } from '../../sketches/registry';

// A crisp monochrome eye, drawn with Skia so it needs no icon font and ships
// over-the-air on the existing native build.
//
// Skia's <Canvas> is a native Metal view whose first frame is opaque — against
// the glass bubble that reads as a white flash on mount. We render it
// transparent (opaque={false}) and fade it in once it has painted, so the
// opaque first frame happens while invisible. The fade lives here, on a child
// of the bubble — never on the GlassView, whose effect would vanish at opacity 0.
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

// Back chevron, same font-free Skia treatment as the eye. Replaces the native
// back button, which on iOS 26 carries the flashing Liquid Glass background.
function ChevronIcon({ color = '#e8e8f0', size = 24 }: { color?: string; size?: number }) {
  const path = useMemo(() => {
    const p = Skia.Path.Make();
    p.moveTo(15, 5);
    p.lineTo(8, 12);
    p.lineTo(15, 19);
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
          path={path}
          color={color}
          style="stroke"
          strokeWidth={2}
          strokeJoin="round"
          strokeCap="round"
        />
      </Canvas>
    </Animated.View>
  );
}

export default function SketchScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
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
      <StatusBar style="light" hidden={immersive} animated />

      {/* Own header chrome instead of the native stack bar — see
          components/GlassButton.tsx. The back and eye buttons keep their glass
          bubble, drawn in JS so they appear settled with no entrance bloom. The
          native edge-swipe back gesture still works with the header hidden. */}
      {!immersive && (
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <GlassButton onPress={() => router.back()} style={styles.iconBtn} accessibilityLabel="Back">
            <ChevronIcon />
          </GlassButton>
          <Text numberOfLines={1} style={styles.headerTitle}>
            {title}
          </Text>
          <GlassButton
            onPress={() => setImmersive(true)}
            style={styles.iconBtn}
            accessibilityLabel="Hide controls"
          >
            <EyeIcon />
          </GlassButton>
        </View>
      )}

      <View style={styles.fill}>
        <Component />
      </View>

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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  // perfect circle for the icon buttons (overrides the pill padding)
  iconBtn: { width: 36, paddingHorizontal: 0 },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    color: '#e8e8f0',
    fontSize: 17,
    fontWeight: '600',
    marginHorizontal: 8,
  },
  restoreHotspot: { position: 'absolute', width: 140, height: 120 },
});
