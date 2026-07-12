import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useExperimentActive } from '../_host';
import { useSettingsActions } from '../settings';
import { useTempo } from '../tempo';
import { playKick } from './voice';

// Drums · hello world — an 8-step kick sequencer, arranged VERTICALLY.
//   tap a step   → place / remove a kick on it
//   the playhead → falls down the column, looping the bar; a lit step thumps
//
// The 8 steps are eighth-notes, so one full pass down the column is one bar of
// 4/4 (at 120 BPM that's 2 s). This is the drum family's first sketch: one
// track, one voice (the faked-from-sines kick in ./voice), leaning straight
// into the thesis's unclaimed frontier — rhythm & accumulation. Tempo lives in
// the shared settings sheet (the gear); a four-on-the-floor pattern is seeded
// so the screen sounds musical the moment you open it.

const STEPS = 8;
const SCHED_MS = 15; // scheduler poll interval — the grid's timing resolution
// Steps that fall on a beat (every other step, since steps are eighth-notes).
const isDownbeat = (i: number) => i % 2 === 0;
// Seed: four-on-the-floor (a kick on every beat) — capture-ready attract state.
const SEED = Array.from({ length: STEPS }, (_, i) => isDownbeat(i));

type Flash = { flash: SharedValue<number> };

export default function DrumSequencer() {
  const live = useExperimentActive();
  const tempo = useTempo();

  const [steps, setSteps] = useState<boolean[]>(SEED);
  const [current, setCurrent] = useState(-1); // lit playhead step, -1 before the loop starts

  // Refs the JS scheduler reads so it sees live state without re-subscribing.
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  const tempoRef = useRef(tempo);
  tempoRef.current = tempo;

  // Per-step flash channel, registered by each StepRow on mount (same pattern as
  // Bodies' fx map) — lets a fired step pop without threading it through state.
  const flashRef = useRef<Map<number, Flash>>(new Map());
  const registerFlash = useCallback((i: number, f: Flash) => {
    flashRef.current.set(i, f);
  }, []);
  const unregisterFlash = useCallback((i: number) => {
    flashRef.current.delete(i);
  }, []);

  const toggleStep = useCallback((i: number) => {
    setSteps((prev) => prev.map((on, j) => (j === i ? !on : on)));
  }, []);

  // Fire a step: thump the kick and pop its bar into a bright flash.
  const fireStep = useCallback((i: number) => {
    playKick();
    const f = flashRef.current.get(i);
    if (f) {
      f.flash.value = 0;
      f.flash.value = withSequence(
        withTiming(1, { duration: 40, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 300, easing: Easing.out(Easing.quad) })
      );
    }
  }, []);

  // One global clock walks the column. We poll fast and fire on the crossing
  // into a new step (not once per tick), so the loop stays phase-locked to a
  // common t0 — the same discipline Bodies uses for its grid.
  const t0Ref = useRef(0);
  const lastStepRef = useRef(-1);
  useEffect(() => {
    if (!live) return;
    t0Ref.current = Date.now(); // start the bar at the top when we come on-screen
    lastStepRef.current = -1;
    setCurrent(-1);
    const handle = setInterval(() => {
      const bpm = tempoRef.current;
      const stepMs = 60000 / bpm / 2; // one eighth-note per step
      const k = Math.floor((Date.now() - t0Ref.current) / stepMs);
      const step = ((k % STEPS) + STEPS) % STEPS;
      if (step !== lastStepRef.current) {
        lastStepRef.current = step;
        setCurrent(step);
        if (stepsRef.current[step]) fireStep(step);
      }
    }, SCHED_MS);
    return () => {
      clearInterval(handle);
      lastStepRef.current = -1;
    };
  }, [live, fireStep]);

  // A "Clear" button in the settings sheet, matching the other experiments.
  const actions = useMemo(
    () => [{ id: 'clear', label: 'Clear', onPress: () => setSteps(Array(STEPS).fill(false)) }],
    []
  );
  useSettingsActions(actions);

  return (
    <View style={styles.fill}>
      <View style={styles.column}>
        {steps.map((on, i) => (
          <StepRow
            key={i}
            index={i}
            active={on}
            isCurrent={i === current}
            downbeat={isDownbeat(i)}
            onToggle={toggleStep}
            register={registerFlash}
            unregister={unregisterFlash}
          />
        ))}
      </View>
    </View>
  );
}

// A single step: a wide rounded bar. Off = a faint outline; On = a dim "armed"
// fill that flashes to full white when it fires (sound-as-light coupling). The
// playhead brightens whichever bar it's currently over.
function StepRow({
  index,
  active,
  isCurrent,
  downbeat,
  onToggle,
  register,
  unregister,
}: {
  index: number;
  active: boolean;
  isCurrent: boolean;
  downbeat: boolean;
  onToggle: (i: number) => void;
  register: (i: number, f: Flash) => void;
  unregister: (i: number) => void;
}) {
  const flash = useSharedValue(0);

  useEffect(() => {
    register(index, { flash });
    return () => unregister(index);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  const barStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + 0.03 * flash.value }],
  }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: flash.value }));

  return (
    <Pressable
      style={styles.rowPress}
      onPress={() => onToggle(index)}
      accessibilityRole="button"
      accessibilityLabel={`Step ${index + 1} ${active ? 'on' : 'off'}`}
    >
      {/* left gutter: a beat dot marks the four downbeats */}
      <View style={styles.gutter}>
        {downbeat ? <View style={styles.beatDot} /> : null}
      </View>
      <Animated.View
        style={[
          styles.bar,
          active ? styles.barOn : styles.barOff,
          isCurrent ? styles.barCurrent : null,
          barStyle,
        ]}
      >
        {/* fire flash: a white wash that pops on the beat, clipped to the bar */}
        <Animated.View pointerEvents="none" style={[styles.barGlow, glowStyle]} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  // The vertical stack of steps. Top inset clears the back/record/gear chrome.
  column: {
    flex: 1,
    paddingTop: 112,
    paddingBottom: 40,
    paddingHorizontal: 24,
    gap: 12,
  },
  rowPress: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  gutter: { width: 22, alignItems: 'center', justifyContent: 'center' },
  beatDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  bar: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1.5,
    overflow: 'hidden',
  },
  barOff: {
    backgroundColor: 'transparent',
    borderColor: 'rgba(255,255,255,0.14)',
  },
  barOn: {
    backgroundColor: 'rgba(255,255,255,0.26)',
    borderColor: 'rgba(255,255,255,0.4)',
  },
  // Playhead: whichever bar the loop is currently over gets a bright rim.
  barCurrent: {
    borderColor: 'rgba(255,255,255,0.9)',
    borderWidth: 2,
  },
  barGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#fff',
  },
});
