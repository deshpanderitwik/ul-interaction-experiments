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

// Drums · Kit — a classic 3-lane × 8-step grid: kick, snare, hi-hat. Where
// Subdivisions goes deep on one voice, Kit goes wide, and it's the home for the
// noise-approximation voices (snare/hat are stacked inharmonic sine plucks — the
// engine has no real noise). Tap a cell to toggle a hit; the playhead sweeps the
// columns, looping the bar. Same phase-locked clock as the rest of the family, so
// it locks to Paths in a combination (and the kick drives the sidechain there).

const STEPS = 8; // eighth-notes: one pass = one bar of 4/4
const SCHED_MS = 12;
const isDownbeat = (i: number) => i % 2 === 0;

type Lane = { id: string; label: string; play: () => void };
const LANES: Lane[] = [
  { id: 'kick', label: 'K', play: () => playKick() },
  { id: 'snare', label: 'S', play: () => playSnare() },
  { id: 'hat', label: 'H', play: () => playHat(false) },
];

// Seed a basic backbeat: kick on 1 & 3, snare on 2 & 4, hats on every eighth.
const SEED: boolean[][] = [
  Array.from({ length: STEPS }, (_, i) => i === 0 || i === 4), // kick
  Array.from({ length: STEPS }, (_, i) => i === 2 || i === 6), // snare
  Array.from({ length: STEPS }, () => true), // hat
];

const cellKey = (lane: number, step: number) => lane * STEPS + step;
type Flash = { flash: SharedValue<number> };

export default function DrumKit() {
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
          withTiming(1, { duration: 40, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 260, easing: Easing.out(Easing.quad) })
        );
      }
    }
  }, []);

  // One clock sweeps the columns; fire on the crossing into a new step so every
  // lane stays phase-locked to the shared t0.
  const t0Ref = useRef(0);
  const lastStepRef = useRef(-1);
  useEffect(() => {
    if (!live) return;
    t0Ref.current = sharedClock ? 0 : clock.value;
    lastStepRef.current = -1;
    setCurrent(-1);
    const handle = setInterval(() => {
      const bpm = tempoRef.current;
      const stepMs = 60000 / bpm / 2;
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
      <View style={[styles.grid, { paddingBottom: 40 + hostBottomInset }]}>
        {LANES.map((lane, l) => (
          <View key={lane.id} style={styles.lane}>
            <View style={styles.laneLabelWrap}>
              <Text style={styles.laneLabel}>{lane.label}</Text>
            </View>
            <View style={styles.cells}>
              {grid[l].map((on, s) => (
                <Cell
                  key={s}
                  lane={l}
                  step={s}
                  active={on}
                  isCurrent={s === current}
                  downbeat={isDownbeat(s)}
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

// One step cell: off = faint outline; on = dim fill; a brighter rim marks the
// column the playhead is over; a white wash pops on the beat it fires.
function Cell({
  lane,
  step,
  active,
  isCurrent,
  downbeat,
  onToggle,
  register,
  unregister,
}: {
  lane: number;
  step: number;
  active: boolean;
  isCurrent: boolean;
  downbeat: boolean;
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
          active ? styles.cellOn : styles.cellOff,
          isCurrent ? styles.cellCurrent : null,
          downbeat && !active ? styles.cellDownbeat : null,
        ]}
      >
        <Animated.View pointerEvents="none" style={[styles.cellGlow, glowStyle]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  grid: { flex: 1, paddingTop: 120, paddingHorizontal: 16, justifyContent: 'center', gap: 14 },
  lane: { flexDirection: 'row', alignItems: 'center', height: 74 },
  laneLabelWrap: { width: 26, alignItems: 'center' },
  laneLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 15, fontWeight: '700' },
  cells: { flex: 1, flexDirection: 'row', gap: 6 },
  cellPress: { flex: 1, height: '100%' },
  cell: { flex: 1, borderRadius: 10, borderWidth: 1.5, overflow: 'hidden' },
  cellOff: { backgroundColor: 'transparent', borderColor: 'rgba(255,255,255,0.12)' },
  cellDownbeat: { borderColor: 'rgba(255,255,255,0.22)' },
  cellOn: { backgroundColor: 'rgba(255,255,255,0.26)', borderColor: 'rgba(255,255,255,0.4)' },
  cellCurrent: { borderColor: 'rgba(255,255,255,0.9)', borderWidth: 2 },
  cellGlow: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#fff' },
});
