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
import { useTempo } from '../tempo';
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
  quantize: {
    type: 'toggle',
    label: 'Quantize to grid',
    default: 0,
  },
} as const;

// Quantize grid. The global tempo defines the beat; the master clock ticks at
// the finest subdivision (beat / GRID_DIV), and a note fires every `mult` of
// those ticks. Sliding up picks a smaller mult = faster, but every note still
// lands on a grid line, so playback stays rhythmic. Ordered fast → slow.
const GRID_DIV = 8; // finest = a 32nd note (8 per beat)
const GRID_MULTS = [1, 2, 4, 8]; // 32nd, 16th, 8th, quarter

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
  const { fastMs, slowMs, quantize } = useSettings(SETTINGS);
  const bpm = useTempo();
  const { height } = useWindowDimensions();
  const heightRef = useRef(height);
  heightRef.current = height;
  const fastRef = useRef(fastMs);
  fastRef.current = fastMs;
  const slowRef = useRef(slowMs);
  slowRef.current = slowMs;
  const quantizeRef = useRef(quantize);
  quantizeRef.current = quantize;
  const bpmRef = useRef(bpm);
  bpmRef.current = bpm;

  // UI-thread visual: the hint text fade.
  const hint = useSharedValue(1);

  // Sequencer state (JS thread).
  const intervalRef = useRef(250);
  const stepRef = useRef(0); // index into the arp (only advances when a note fires)
  const gridPosRef = useRef(0); // master-clock tick counter (quantize mode)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const posRef = useRef({ x: 0, y: 0 }); // last finger position
  const rippleRefs = useRef<(RippleHandle | null)[]>([]);
  const rippleCursor = useRef(0);

  // Ripple at the finger, colored by the given arp degree.
  const fireRipple = (degree: number, durationMs: number) => {
    const r = rippleRefs.current[rippleCursor.current % RIPPLE_POOL];
    rippleCursor.current += 1;
    r?.trigger(posRef.current.x, posRef.current.y, degree, durationMs);
  };

  // Free-running mode: each note reschedules at the continuous interval-for-y.
  const tickFree = () => {
    const arp = currentArp();
    const i = stepRef.current % arp.length;
    pluck(arp[i].freq);
    // Lifetime tracks tempo so fast runs stay crisp rather than smearing.
    fireRipple(i, Math.min(620, Math.max(280, intervalRef.current * 2.4)));
    stepRef.current += 1;
    timerRef.current = setTimeout(tickFree, intervalRef.current);
  };

  // Quantized mode: a steady master clock at the finest subdivision. The finger
  // height chooses how many master ticks per note (mult); notes only fire on
  // grid lines, so changing speed mid-slide stays phase-locked and rhythmic.
  const tickGrid = () => {
    const beat = 60000 / Math.max(1, bpmRef.current);
    const masterStep = beat / GRID_DIV;
    const h = heightRef.current;
    const t = h > 0 ? Math.max(0, Math.min(1, posRef.current.y / h)) : 0.5;
    const mult = GRID_MULTS[Math.min(GRID_MULTS.length - 1, Math.floor(t * GRID_MULTS.length))];
    if (gridPosRef.current % mult === 0) {
      const arp = currentArp();
      const i = stepRef.current % arp.length;
      pluck(arp[i].freq);
      fireRipple(i, Math.min(620, Math.max(220, mult * masterStep)));
      stepRef.current += 1;
    }
    gridPosRef.current += 1;
    timerRef.current = setTimeout(tickGrid, masterStep);
  };

  const startArp = (x: number, y: number) => {
    posRef.current = { x, y };
    intervalRef.current = intervalForY(y, heightRef.current, fastRef.current, slowRef.current);
    stepRef.current = 0;
    gridPosRef.current = 0;
    if (timerRef.current) clearTimeout(timerRef.current);
    if (quantizeRef.current >= 1) tickGrid();
    else tickFree();
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
