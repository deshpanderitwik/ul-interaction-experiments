import { useClock } from '@shopify/react-native-skia';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  LinearTransition,
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
import { playClap, playHat, playKick, playSnare, playTom } from './voice';

// Drums · Zoom Lanes — a six-piece kit (all modified sines) as six VERTICAL lanes
// looping in parallel on the shared clock, playhead falling down them. Tap a lane
// and it grows in place to occupy the center (the others shrink to slivers, still
// tappable to switch) so it's easy to edit — same lane, same orientation, just
// bigger; no modal. Tap the enlarged lane's label to collapse back. Monochrome.

const STEPS = 16; // one bar of sixteenth-notes
const SCHED_MS = 10;
const isBeat = (s: number) => s % 4 === 0;

type Lane = { id: string; label: string; short: string; play: () => void };
const LANES: Lane[] = [
  { id: 'kick', label: 'Kick', short: 'K', play: () => playKick() },
  { id: 'snare', label: 'Snare', short: 'S', play: () => playSnare() },
  { id: 'tom', label: 'Tom', short: 'T', play: () => playTom() },
  { id: 'clap', label: 'Clap', short: 'C', play: () => playClap() },
  { id: 'chat', label: 'Hat', short: 'H', play: () => playHat(false) },
  { id: 'ohat', label: 'Open Hat', short: 'O', play: () => playHat(true) },
];

// Seed a basic beat on kick/snare/hat; tom, clap, open-hat start empty to fill in.
const SEED: boolean[][] = [
  Array.from({ length: STEPS }, (_, s) => s === 0 || s === 8), // kick
  Array.from({ length: STEPS }, (_, s) => s === 4 || s === 12), // snare
  Array.from({ length: STEPS }, () => false), // tom
  Array.from({ length: STEPS }, () => false), // clap
  Array.from({ length: STEPS }, (_, s) => s % 2 === 0), // closed hat
  Array.from({ length: STEPS }, () => false), // open hat
];

const cellKey = (lane: number, step: number) => lane * STEPS + step;
type Flash = { flash: SharedValue<number> };

export default function ZoomLanes() {
  const live = useExperimentActive();
  const tempo = useTempo();
  const localClock = useClock();
  const sharedClock = useSharedClock();
  const clock = sharedClock ?? localClock;
  const hostBottomInset = useHostBottomInset();

  const [grid, setGrid] = useState<boolean[][]>(() => SEED.map((row) => row.slice()));
  const [current, setCurrent] = useState(-1);
  const [zoomed, setZoomed] = useState<number | null>(null); // which lane is enlarged

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
          withTiming(0, { duration: 220, easing: Easing.out(Easing.quad) })
        );
      }
    }
  }, []);

  const t0Ref = useRef(0);
  const lastStepRef = useRef(-1);
  useEffect(() => {
    if (!live) return;
    t0Ref.current = sharedClock ? 0 : clock.value;
    lastStepRef.current = -1;
    setCurrent(-1);
    const handle = setInterval(() => {
      const bpm = tempoRef.current;
      const stepMs = 60000 / bpm / 4; // sixteenth-notes
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
      <View style={[styles.board, { paddingBottom: 28 + hostBottomInset }]}>
        {LANES.map((lane, l) => {
          const expanded = zoomed === l;
          // Enlarged lane dominates; the rest become thin slivers; equal when none open.
          const flex = zoomed == null ? 1 : expanded ? 9 : 0.5;
          return (
            <Animated.View key={lane.id} layout={LinearTransition.duration(240)} style={[styles.column, { flex }]}>
              <Pressable
                style={styles.header}
                onPress={() => setZoomed(expanded ? null : l)}
                accessibilityRole="button"
                accessibilityLabel={`${lane.label}${expanded ? ' — collapse' : ''}`}
              >
                <Text style={styles.laneLabel} numberOfLines={1}>
                  {expanded ? lane.label : lane.short}
                </Text>
              </Pressable>
              <View style={styles.cellsCol}>
                {grid[l].map((on, s) => (
                  <Cell
                    key={s}
                    lane={l}
                    step={s}
                    active={on}
                    isCurrent={s === current}
                    beat={isBeat(s)}
                    onPress={() => (expanded ? toggle(l, s) : setZoomed(l))}
                    register={registerFlash}
                    unregister={unregisterFlash}
                  />
                ))}
              </View>
            </Animated.View>
          );
        })}
      </View>
    </View>
  );
}

// One step cell. In a sliver lane a tap enlarges that lane; in the enlarged lane a
// tap toggles the hit. Monochrome: white fill/rims on black, a flash on fire.
function Cell({
  lane,
  step,
  active,
  isCurrent,
  beat,
  onPress,
  register,
  unregister,
}: {
  lane: number;
  step: number;
  active: boolean;
  isCurrent: boolean;
  beat: boolean;
  onPress: () => void;
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
    <Pressable style={styles.cellPress} onPress={onPress}>
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
  board: { flex: 1, flexDirection: 'row', paddingTop: 100, paddingHorizontal: 12, gap: 8 },
  column: { overflow: 'hidden' },
  header: { height: 24, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  laneLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: '700', textAlign: 'center' },
  cellsCol: { flex: 1, gap: 4 },
  cellPress: { flex: 1 },
  cell: { flex: 1, borderRadius: 6, borderWidth: 1, overflow: 'hidden' },
  cellOff: { backgroundColor: 'transparent', borderColor: 'rgba(255,255,255,0.1)' },
  cellBeat: { backgroundColor: 'transparent', borderColor: 'rgba(255,255,255,0.22)' },
  cellOn: { backgroundColor: 'rgba(255,255,255,0.3)', borderColor: 'rgba(255,255,255,0.5)' },
  // Monochrome playhead: a bright white rim on the current step.
  cellCurrent: { borderColor: '#fff', borderWidth: 2 },
  cellGlow: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#fff' },
});
