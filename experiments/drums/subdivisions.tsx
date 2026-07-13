import { useClock } from '@shopify/react-native-skia';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useExperimentActive } from '../_host';
import { useSharedClock } from '../combinations/clock';
import { useSettingsActions } from '../settings';
import { useTempo } from '../tempo';
import { playKick } from './voice';

// Drums · Subdivisions — the kick sequencer, but each step can *ratchet*: instead
// of a single hit it fires N evenly-spaced sub-hits inside its own slot (a drum
// roll / fill). The gesture is vertical:
//   tap a step        → toggle it on/off (off ↔ a single hit)
//   press + drag UP   → fewer subdivisions (down toward off)
//   press + drag DOWN → more subdivisions (2, 3, 4, 6, 8 — a tighter roll)
//
// The step you grab keeps adjusting even as your finger travels over its
// neighbors, so the vertical stack doesn't fight the vertical drag. Each bar
// splits into that many cells and lights them left-to-right as the sub-hits
// fire, so you *see* the subdivision you hear — the family's coupling, at the
// rhythm layer. Built straight off the base sequencer (same kick, same
// phase-locked clock).

const STEPS = 8;
const SCHED_MS = 12; // poll interval — finer than the base to resolve dense ratchets
// Subdivision ladder: 0 = off (silent), 1 = a single hit, then ratchets. A drag
// steps through these by index, so the rungs feel evenly spaced under the finger.
const LEVELS = [0, 1, 2, 3, 4, 6, 8] as const;
const MAX_LEVEL = LEVELS.length - 1;
const DRAG_PX = 30; // finger travel (px) per subdivision rung
const isDownbeat = (i: number) => i % 2 === 0;
// Seed: a hit on each beat with a 4-stroke roll on the last step (a fill into
// the loop) — capture-ready and immediately shows what subdivisions do.
const SEED = Array.from({ length: STEPS }, (_, i) => (i === STEPS - 1 ? 4 : isDownbeat(i) ? 1 : 0));

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const levelIndex = (sub: number) => {
  const i = (LEVELS as readonly number[]).indexOf(sub);
  return i < 0 ? 0 : i;
};

// A row's fire channel: `flash` pops on each sub-hit; `activeHit` says which cell
// is the one currently firing (so only that segment lights).
type Fire = { flash: SharedValue<number>; activeHit: SharedValue<number> };

export default function DrumSubdivisions() {
  const live = useExperimentActive();
  const tempo = useTempo();
  // Combined: use the host's shared clock so we phase-lock with the partner
  // experiment; standalone, use our own. Either way it's a monotonic ms clock.
  const localClock = useClock();
  const sharedClock = useSharedClock();
  const clock = sharedClock ?? localClock;

  const [subs, setSubs] = useState<number[]>(SEED);
  const [current, setCurrent] = useState(-1);

  const subsRef = useRef(subs);
  subsRef.current = subs;
  const tempoRef = useRef(tempo);
  tempoRef.current = tempo;

  const fireRef = useRef<Map<number, Fire>>(new Map());
  const registerFire = useCallback((i: number, f: Fire) => {
    fireRef.current.set(i, f);
  }, []);
  const unregisterFire = useCallback((i: number) => {
    fireRef.current.delete(i);
  }, []);

  // Level index captured when a drag begins, so drag distance is relative to
  // where the step started (not absolute screen position).
  const dragStartRef = useRef(0);
  const onGrab = useCallback((i: number) => {
    dragStartRef.current = levelIndex(subsRef.current[i]);
  }, []);
  const onDrag = useCallback((i: number, translationY: number) => {
    // Down (positive Y) → more subdivisions; up (negative Y) → fewer.
    const delta = Math.round(translationY / DRAG_PX);
    const idx = clamp(dragStartRef.current + delta, 0, MAX_LEVEL);
    const sub = LEVELS[idx];
    setSubs((prev) => (prev[i] === sub ? prev : prev.map((v, j) => (j === i ? sub : v))));
  }, []);
  const onTap = useCallback((i: number) => {
    setSubs((prev) => prev.map((v, j) => (j === i ? (v > 0 ? 0 : 1) : v)));
  }, []);

  // Fire one sub-hit of a step: thump the kick and light that step's cell.
  const fireHit = useCallback((step: number, subIdx: number) => {
    playKick();
    const ch = fireRef.current.get(step);
    if (ch) {
      ch.activeHit.value = subIdx;
      ch.flash.value = 0;
      ch.flash.value = withSequence(
        withTiming(1, { duration: 30, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 220, easing: Easing.out(Easing.quad) })
      );
    }
  }, []);

  // One global clock walks the column; within a lit step it subdivides the slot
  // into `sub` equal sub-hits and fires on each crossing. Polling fast and firing
  // on the crossing keeps every hit phase-locked to the shared t0.
  const t0Ref = useRef(0);
  const lastStepRef = useRef(-1);
  const lastSubRef = useRef(-1);
  useEffect(() => {
    if (!live) return;
    // Combined: anchor at the shared clock's origin (t0 = 0) to line up with the
    // partner; standalone: anchor at the first tick.
    t0Ref.current = sharedClock ? 0 : clock.value;
    lastStepRef.current = -1;
    lastSubRef.current = -1;
    setCurrent(-1);
    const handle = setInterval(() => {
      const now = clock.value;
      const bpm = tempoRef.current;
      const stepMs = 60000 / bpm / 2; // one eighth-note per step
      const k = Math.floor((now - t0Ref.current) / stepMs);
      const step = ((k % STEPS) + STEPS) % STEPS;
      const stepStart = t0Ref.current + k * stepMs;
      const s = subsRef.current[step];
      // Which sub-hit are we in? -1 when the step is off (nothing to fire).
      const subIdx =
        s > 0 ? Math.min(s - 1, Math.floor((now - stepStart) / (stepMs / s))) : -1;

      if (step !== lastStepRef.current) {
        lastStepRef.current = step;
        lastSubRef.current = -1; // new step: let its first sub-hit fire
        setCurrent(step);
      }
      if (subIdx >= 0 && subIdx !== lastSubRef.current) {
        lastSubRef.current = subIdx;
        fireHit(step, subIdx);
      }
    }, SCHED_MS);
    return () => {
      clearInterval(handle);
      lastStepRef.current = -1;
      lastSubRef.current = -1;
    };
  }, [live, fireHit, clock, sharedClock]);

  const actions = useMemo(
    () => [{ id: 'clear', label: 'Clear', onPress: () => setSubs(Array(STEPS).fill(0)) }],
    []
  );
  useSettingsActions(actions);

  return (
    <View style={styles.fill}>
      <View style={styles.column}>
        {subs.map((sub, i) => (
          <StepRow
            key={i}
            index={i}
            sub={sub}
            isCurrent={i === current}
            downbeat={isDownbeat(i)}
            onGrab={onGrab}
            onDrag={onDrag}
            onTap={onTap}
            register={registerFire}
            unregister={unregisterFire}
          />
        ))}
      </View>
    </View>
  );
}

// A single step: a bar split into `sub` cells. Off = a faint empty outline; a lit
// step's cells sit dim and flash to full white as each sub-hit fires. Vertical
// drag on the bar sets its subdivision count.
function StepRow({
  index,
  sub,
  isCurrent,
  downbeat,
  onGrab,
  onDrag,
  onTap,
  register,
  unregister,
}: {
  index: number;
  sub: number;
  isCurrent: boolean;
  downbeat: boolean;
  onGrab: (i: number) => void;
  onDrag: (i: number, translationY: number) => void;
  onTap: (i: number) => void;
  register: (i: number, f: Fire) => void;
  unregister: (i: number) => void;
}) {
  const flash = useSharedValue(0);
  const activeHit = useSharedValue(-1);

  useEffect(() => {
    register(index, { flash, activeHit });
    return () => unregister(index);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  const barStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + 0.03 * flash.value }],
  }));

  const pan = Gesture.Pan()
    .minDistance(6)
    .onStart(() => runOnJS(onGrab)(index))
    .onUpdate((e) => runOnJS(onDrag)(index, e.translationY));
  const tap = Gesture.Tap()
    .maxDuration(250)
    .onStart(() => runOnJS(onTap)(index));
  const gesture = Gesture.Race(pan, tap);

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.rowPress}>
        <View style={styles.gutter}>{downbeat ? <View style={styles.beatDot} /> : null}</View>
        <Animated.View
          style={[
            styles.bar,
            sub > 0 ? styles.barOn : styles.barOff,
            isCurrent ? styles.barCurrent : null,
            barStyle,
          ]}
        >
          {sub > 0 ? (
            <View style={styles.cells}>
              {Array.from({ length: sub }, (_, c) => (
                <Cell key={c} cellIndex={c} flash={flash} activeHit={activeHit} />
              ))}
            </View>
          ) : null}
        </Animated.View>
        <View style={styles.count}>
          {sub > 1 ? <Text style={styles.countText}>×{sub}</Text> : null}
        </View>
      </View>
    </GestureDetector>
  );
}

// One sub-hit segment: dim while armed, flashes to full white on the frame its
// own sub-hit fires (activeHit points at it).
function Cell({
  cellIndex,
  flash,
  activeHit,
}: {
  cellIndex: number;
  flash: SharedValue<number>;
  activeHit: SharedValue<number>;
}) {
  const style = useAnimatedStyle(() => {
    const lit = activeHit.value === cellIndex ? flash.value : 0;
    return { opacity: 0.2 + 0.8 * lit };
  });
  return <Animated.View style={[styles.cell, style]} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  column: {
    flex: 1,
    paddingTop: 112,
    paddingBottom: 40,
    paddingHorizontal: 24,
    gap: 12,
  },
  rowPress: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  gutter: { width: 22, alignItems: 'center', justifyContent: 'center' },
  beatDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.5)' },
  bar: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1.5,
    overflow: 'hidden',
    padding: 3,
  },
  barOff: { backgroundColor: 'transparent', borderColor: 'rgba(255,255,255,0.14)' },
  barOn: { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.4)' },
  barCurrent: { borderColor: 'rgba(255,255,255,0.9)', borderWidth: 2 },
  // The row of sub-hit cells filling the bar.
  cells: { flex: 1, flexDirection: 'row', gap: 3 },
  cell: { flex: 1, borderRadius: 10, backgroundColor: '#fff' },
  // Right gutter shows the current subdivision count.
  count: { width: 30, alignItems: 'center', justifyContent: 'center' },
  countText: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 13,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});
