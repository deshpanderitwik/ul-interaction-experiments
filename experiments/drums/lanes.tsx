import { useClock } from '@shopify/react-native-skia';
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
import { useSharedClock } from '../combinations/clock';
import { useHostBottomInset } from '../combinations/insets';
import { useSettingsActions } from '../settings';
import { useTempo } from '../tempo';
import { playHat, playKick, playSnare } from './voice';

// Drums · Three Lanes — the vertical kick sequencer, widened to three parallel
// lanes (kick, snare, hi-hat) and lengthened to 16 steps. Each lane is its own
// column of steps; the playhead falls down all three together, so they run in
// lockstep on one bar. Tap a cell to add or remove that lane's hit. Snare and hat
// are the noise-approximation voices (stacked inharmonic sine plucks). Same
// phase-locked clock as the rest of the family, so it locks to Paths in a
// combination.

const STEPS = 16; // sixteenth-notes: one pass down = one bar of 4/4
const SCHED_MS = 10;
const isBeat = (s: number) => s % 4 === 0; // downbeats: every quarter

type Lane = { id: string; label: string; play: () => void };
const LANES: Lane[] = [
  { id: 'kick', label: 'K', play: () => playKick() },
  { id: 'snare', label: 'S', play: () => playSnare() },
  { id: 'hat', label: 'H', play: () => playHat(false) },
];

// Seed a basic backbeat across the 16-step grid: kick on 1 & 3, snare on 2 & 4,
// closed hat on every eighth.
const SEED: boolean[][] = [
  Array.from({ length: STEPS }, (_, s) => s === 0 || s === 8), // kick
  Array.from({ length: STEPS }, (_, s) => s === 4 || s === 12), // snare
  Array.from({ length: STEPS }, (_, s) => s % 2 === 0), // hat
];

const cellKey = (lane: number, step: number) => lane * STEPS + step;
type Flash = { flash: SharedValue<number> };

export default function DrumLanes() {
  const live = useExperimentActive();
  const tempo = useTempo();
  const localClock = useClock();
  const sharedClock = useSharedClock();
  const clock = sharedClock ?? localClock;
  const hostBottomInset = useHostBottomInset();

  const [grid, setGrid] = useState<boolean[][]>(() => SEED.map((row) => row.slice()));
  const [current, setCurrent] = useState(-1);

  const gridRef = useRef(grid);
  gridRef.current = grid;
  const tempoRef = useRef(tempo);
  tempoRef.current = tempo;

  const flashRef = useRef<Map<number, Flash>>(new Map());
  const registerFlash = useCallback((k: number, f: Flash) => flashRef.current.set(k, f), []);
  const unregisterFlash = useCallback((k: number) => flashRef.current.delete(k), []);

  const toggle = useCallback((lane: number, step: number) => {
    setGrid((prev) => prev.map((row, l) => (l === lane ? row.map((on, s) => (s === step ? !on : on)) : row)));
  }, []);

  // Fire every lane that has a hit on this step, and pop those cells.
  const fireStep = useCallback((step: number) => {
    const g = gridRef.current;
    for (let lane = 0; lane < LANES.length; lane++) {
      if (!g[lane][step]) continue;
      LANES[lane].play();
      const f = flashRef.current.get(cellKey(lane, step));
      if (f) {
        f.flash.value = 0;
        f.flash.value = withSequence(
          withTiming(1, { duration: 35, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 240, easing: Easing.out(Easing.quad) })
        );
      }
    }
  }, []);

  // One clock walks all three lanes; fire on the crossing into a new step so
  // every lane stays phase-locked to the shared t0.
  const t0Ref = useRef(0);
  const lastStepRef = useRef(-1);
  useEffect(() => {
    if (!live) return;
    t0Ref.current = sharedClock ? 0 : clock.value;
    lastStepRef.current = -1;
    setCurrent(-1);
    const handle = setInterval(() => {
      const bpm = tempoRef.current;
      const stepMs = 60000 / bpm / 4; // one sixteenth-note per step
      const k = Math.floor((clock.value - t0Ref.current) / stepMs);
      const step = ((k % STEPS) + STEPS) % STEPS;
      if (step !== lastStepRef.current) {
        lastStepRef.current = step;
        setCurrent(step);
        fireStep(step);
      }
    }, SCHED_MS);
    return () => {
      clearInterval(handle);
      lastStepRef.current = -1;
    };
  }, [live, fireStep, clock, sharedClock]);

  const actions = useMemo(
    () => [{ id: 'clear', label: 'Clear', onPress: () => setGrid(LANES.map(() => Array(STEPS).fill(false))) }],
    []
  );
  useSettingsActions(actions);

  return (
    <View style={styles.fill}>
      <View style={[styles.board, { paddingBottom: 32 + hostBottomInset }]}>
        {LANES.map((lane, l) => (
          <View key={lane.id} style={styles.column}>
            <Text style={styles.laneLabel}>{lane.label}</Text>
            <View style={styles.cellsCol}>
              {grid[l].map((on, s) => (
                <Cell
                  key={s}
                  lane={l}
                  step={s}
                  active={on}
                  isCurrent={s === current}
                  beat={isBeat(s)}
                  onToggle={toggle}
                  register={registerFlash}
                  unregister={unregisterFlash}
                />
              ))}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

// One step cell: off = faint outline (downbeats a touch brighter); on = dim fill;
// a bright rim marks the step the playhead is on; a white wash pops when it fires.
function Cell({
  lane,
  step,
  active,
  isCurrent,
  beat,
  onToggle,
  register,
  unregister,
}: {
  lane: number;
  step: number;
  active: boolean;
  isCurrent: boolean;
  beat: boolean;
  onToggle: (lane: number, step: number) => void;
  register: (k: number, f: Flash) => void;
  unregister: (k: number) => void;
}) {
  const flash = useSharedValue(0);
  useEffect(() => {
    register(cellKey(lane, step), { flash });
    return () => unregister(cellKey(lane, step));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lane, step]);

  const glowStyle = useAnimatedStyle(() => ({ opacity: flash.value }));

  return (
    <Pressable
      style={styles.cellPress}
      onPress={() => onToggle(lane, step)}
      accessibilityRole="button"
      accessibilityLabel={`${LANES[lane].label} step ${step + 1} ${active ? 'on' : 'off'}`}
    >
      <View
        style={[
          styles.cell,
          active ? styles.cellOn : beat ? styles.cellBeat : styles.cellOff,
          isCurrent ? styles.cellCurrent : null,
        ]}
      >
        <Animated.View pointerEvents="none" style={[styles.cellGlow, glowStyle]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  // Three lane-columns side by side.
  board: { flex: 1, flexDirection: 'row', paddingTop: 100, paddingHorizontal: 16, gap: 12 },
  column: { flex: 1 },
  laneLabel: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  cellsCol: { flex: 1, gap: 5 },
  cellPress: { flex: 1 },
  cell: { flex: 1, borderRadius: 8, borderWidth: 1.5, overflow: 'hidden' },
  cellOff: { backgroundColor: 'transparent', borderColor: 'rgba(255,255,255,0.1)' },
  cellBeat: { backgroundColor: 'transparent', borderColor: 'rgba(255,255,255,0.22)' },
  cellOn: { backgroundColor: 'rgba(255,255,255,0.26)', borderColor: 'rgba(255,255,255,0.4)' },
  cellCurrent: { borderColor: 'rgba(255,255,255,0.9)', borderWidth: 2 },
  cellGlow: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#fff' },
});
