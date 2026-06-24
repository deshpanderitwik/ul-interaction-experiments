import { useEffect, useRef } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useExperimentActive } from '../_host';
import { ARP, ARP_COLORS, intervalForY, pluck } from './shared';

// Tempo Slide — touch the screen to start an F major arpeggio (root, third,
// fifth, octave; F3→F4) and slide vertically to scrub its tempo: up = faster,
// down = slower. The notes aren't drawn; instead the whole screen flashes a
// different hue each time a note hits. Lift to stop.
//
// The arp is a self-rescheduling timer (setTimeout) that reads the current
// interval each tick, so tempo tracks the finger smoothly. The flash hue/opacity
// run on the UI thread off shared values, so each note's color is crisp.
export default function TempoSlide() {
  const live = useExperimentActive();
  const { height } = useWindowDimensions();
  const heightRef = useRef(height);
  heightRef.current = height;

  // UI-thread visuals: which degree is flashing, the flash envelope, the hint.
  const deg = useSharedValue(0);
  const flash = useSharedValue(0);
  const hint = useSharedValue(1);

  // Sequencer state (JS thread).
  const intervalRef = useRef(250);
  const stepRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tick = () => {
    const i = stepRef.current % ARP.length;
    pluck(ARP[i].freq);
    deg.value = i;
    flash.value = withSequence(
      withTiming(0.92, { duration: 22 }),
      withTiming(0, { duration: Math.max(70, intervalRef.current - 22) })
    );
    stepRef.current += 1;
    timerRef.current = setTimeout(tick, intervalRef.current);
  };

  const startArp = (y: number) => {
    intervalRef.current = intervalForY(y, heightRef.current);
    stepRef.current = 0;
    if (timerRef.current) clearTimeout(timerRef.current);
    tick();
  };
  const setTempo = (y: number) => {
    intervalRef.current = intervalForY(y, heightRef.current);
  };
  const stopArp = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  // Stop and reset when the experiment goes off-screen/backgrounded, and on
  // unmount, so the timer never outlives the screen.
  useEffect(() => {
    if (!live) {
      stopArp();
      flash.value = 0;
      hint.value = 1;
    }
    return stopArp;
  }, [live]);

  const pan = Gesture.Pan()
    .minDistance(0)
    .onStart((e) => {
      if (!live) return;
      hint.value = withTiming(0, { duration: 250 });
      runOnJS(startArp)(e.y);
    })
    .onUpdate((e) => {
      runOnJS(setTempo)(e.y);
    })
    .onFinalize(() => {
      hint.value = withTiming(1, { duration: 600 });
      runOnJS(stopArp)();
    });

  const flashStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(deg.value, [0, 1, 2, 3], ARP_COLORS),
    opacity: flash.value,
  }));
  const hintStyle = useAnimatedStyle(() => ({ opacity: hint.value * 0.5 }));

  return (
    <GestureDetector gesture={pan}>
      <View style={styles.fill}>
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, flashStyle]}
        />
        <Animated.Text style={[styles.hint, hintStyle]}>
          touch & slide — up faster, down slower
        </Animated.Text>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: { color: '#fff', fontSize: 16, letterSpacing: 1 },
});
