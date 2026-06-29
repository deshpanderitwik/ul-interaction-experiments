import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useExperimentActive } from '../_host';
import { useSettings } from '../settings';
import { ARP_COLORS, currentArp, intervalForY, pluck } from './shared';

// Fastest (top of screen) and slowest (bottom) step intervals are adjustable.
const SETTINGS = {
  fastMs: {
    type: 'slider',
    label: 'Fastest (top)',
    min: 40,
    max: 300,
    step: 5,
    unit: 'ms',
    default: 90,
  },
  slowMs: {
    type: 'slider',
    label: 'Slowest (bottom)',
    min: 200,
    max: 1000,
    step: 10,
    unit: 'ms',
    default: 520,
  },
} as const;

// Diameter of a fully-expanded ripple ring.
const RIPPLE_D = 240;
// How many ripple views to cycle through. A fast arp can overlap several at
// once; reusing the oldest just restarts it (reads as a tighter pulse).
const RIPPLE_POOL = 8;

// Tempo Slide — touch the screen to start an F major arpeggio (root, third,
// fifth, octave; F3→F4) and slide vertically to scrub its tempo: up = faster,
// down = slower. The screen color stays put; instead each note sends a colored
// ripple out from wherever the finger currently is. Lift to stop.
//
// The arp is a self-rescheduling timer (setTimeout) that reads the current
// interval each tick, so tempo tracks the finger smoothly. Each tick fires a
// ripple at the finger's last position; the ripple's grow/fade runs on the UI
// thread off shared values.
export default function TempoSlide() {
  const live = useExperimentActive();
  const { fastMs, slowMs } = useSettings(SETTINGS);
  const { height } = useWindowDimensions();
  const heightRef = useRef(height);
  heightRef.current = height;
  const fastRef = useRef(fastMs);
  fastRef.current = fastMs;
  const slowRef = useRef(slowMs);
  slowRef.current = slowMs;

  // UI-thread visual: the hint text fade.
  const hint = useSharedValue(1);

  // Sequencer state (JS thread).
  const intervalRef = useRef(250);
  const stepRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const posRef = useRef({ x: 0, y: 0 }); // last finger position
  const rippleRefs = useRef<(RippleHandle | null)[]>([]);
  const rippleCursor = useRef(0);

  const tick = () => {
    const arp = currentArp();
    const i = stepRef.current % arp.length;
    pluck(arp[i].freq);
    // Ripple at the finger, colored by this degree. Tie its lifetime loosely to
    // tempo so fast runs stay crisp rather than smearing.
    const dur = Math.min(620, Math.max(280, intervalRef.current * 2.4));
    const r = rippleRefs.current[rippleCursor.current % RIPPLE_POOL];
    rippleCursor.current += 1;
    r?.trigger(posRef.current.x, posRef.current.y, i, dur);
    stepRef.current += 1;
    timerRef.current = setTimeout(tick, intervalRef.current);
  };

  const startArp = (x: number, y: number) => {
    posRef.current = { x, y };
    intervalRef.current = intervalForY(y, heightRef.current, fastRef.current, slowRef.current);
    stepRef.current = 0;
    if (timerRef.current) clearTimeout(timerRef.current);
    tick();
  };
  const moveArp = (x: number, y: number) => {
    posRef.current = { x, y };
    intervalRef.current = intervalForY(y, heightRef.current, fastRef.current, slowRef.current);
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
      hint.value = 1;
    }
    return stopArp;
  }, [live]);

  const pan = Gesture.Pan()
    .minDistance(0)
    .onStart((e) => {
      if (!live) return;
      hint.value = withTiming(0, { duration: 250 });
      runOnJS(startArp)(e.x, e.y);
    })
    .onUpdate((e) => {
      runOnJS(moveArp)(e.x, e.y);
    })
    .onFinalize(() => {
      hint.value = withTiming(1, { duration: 600 });
      runOnJS(stopArp)();
    });

  const hintStyle = useAnimatedStyle(() => ({ opacity: hint.value * 0.5 }));

  return (
    <GestureDetector gesture={pan}>
      <View style={styles.fill}>
        {Array.from({ length: RIPPLE_POOL }).map((_, i) => (
          <Ripple
            key={i}
            ref={(h) => {
              rippleRefs.current[i] = h;
            }}
          />
        ))}
        <Animated.Text style={[styles.hint, hintStyle]}>
          touch & slide — up faster, down slower
        </Animated.Text>
      </View>
    </GestureDetector>
  );
}

type RippleHandle = {
  trigger: (x: number, y: number, colorIndex: number, durationMs: number) => void;
};

// One reusable ripple: a colored ring that springs out from a point and fades.
// Driven imperatively so the JS-thread sequencer can fire it on each note.
const Ripple = forwardRef<RippleHandle>(function Ripple(_, ref) {
  const p = useSharedValue(0); // 0 → 1 over the ripple's life
  const cx = useSharedValue(0);
  const cy = useSharedValue(0);
  const colorIdx = useSharedValue(0);

  useImperativeHandle(
    ref,
    () => ({
      trigger(x, y, ci, durationMs) {
        cx.value = x;
        cy.value = y;
        colorIdx.value = ci;
        p.value = 0;
        p.value = withTiming(1, { duration: durationMs, easing: Easing.out(Easing.quad) });
      },
    }),
    [cx, cy, colorIdx, p]
  );

  const style = useAnimatedStyle(() => ({
    left: cx.value - RIPPLE_D / 2,
    top: cy.value - RIPPLE_D / 2,
    opacity: (1 - p.value) * (p.value > 0 ? 1 : 0), // invisible until first fired
    transform: [{ scale: 0.12 + p.value * 0.88 }],
    borderColor: interpolateColor(colorIdx.value, [0, 1, 2, 3], ARP_COLORS),
  }));

  return <Animated.View pointerEvents="none" style={[styles.ripple, style]} />;
});

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ripple: {
    position: 'absolute',
    width: RIPPLE_D,
    height: RIPPLE_D,
    borderRadius: RIPPLE_D / 2,
    borderWidth: 6,
  },
  hint: { color: '#fff', fontSize: 16, letterSpacing: 1 },
});
