import { useClock } from '@shopify/react-native-skia';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  ZoomIn,
  ZoomOut,
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

// Drums · Zoom Lanes — a six-piece kit (all modified sines) laid out as six
// VERTICAL lanes (columns), all looping in parallel on the shared clock with the
// playhead falling down them together. Tap a lane and it zooms: the SAME vertical
// lane just gets bigger (a wide column of 16 tall cells) over a dimmed scrim, so
// it's easy to edit — the orientation never changes. Tap the scrim behind it to
// zoom back out. The kit keeps playing throughout.

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
  const [zoomed, setZoomed] = useState<number | null>(null); // which lane is open for editing

  const gridRef = useRef(grid);
  gridRef.current = grid;
  const tempoRef = useRef(tempo);
  tempoRef.current = tempo;

  // Flash channels for the zoomed lane's big cells (only the open lane registers).
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

  // All six lanes run off one clock; fire on the crossing into a new step.
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
      {/* Overview: six vertical lanes side by side, playhead falling down them. */}
      <View style={[styles.board, { paddingBottom: 28 + hostBottomInset }]}>
        {LANES.map((lane, l) => (
          <Pressable key={lane.id} style={styles.column} onPress={() => setZoomed(l)}>
            <Text style={styles.laneLabel}>{lane.short}</Text>
            <View style={styles.cellsCol}>
              {grid[l].map((on, s) => (
                <View
                  key={s}
                  style={[
                    styles.miniCell,
                    on ? styles.miniOn : isBeat(s) ? styles.miniBeat : styles.miniOff,
                    s === current ? styles.miniCurrent : null,
                  ]}
                />
              ))}
            </View>
          </Pressable>
        ))}
      </View>

      {/* Zoomed: the same vertical lane, just bigger, over a scrim. */}
      {zoomed != null ? (
        <Animated.View style={styles.scrim} entering={FadeIn.duration(140)} exiting={FadeOut.duration(140)}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setZoomed(null)} />
          <Animated.View style={styles.panel} entering={ZoomIn.duration(180)} exiting={ZoomOut.duration(140)}>
            <Text style={styles.panelTitle}>{LANES[zoomed].label}</Text>
            <View style={styles.bigCol}>
              {grid[zoomed].map((on, s) => (
                <BigCell
                  key={s}
                  lane={zoomed}
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
            <Text style={styles.hint}>tap outside to close</Text>
          </Animated.View>
        </Animated.View>
      ) : null}
    </View>
  );
}

// A big editable step in the zoomed lane — same vertical orientation, just larger.
function BigCell({
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
    <Pressable style={styles.bigCellPress} onPress={() => onToggle(lane, step)}>
      <View
        style={[
          styles.bigCell,
          active ? styles.bigOn : beat ? styles.bigBeat : styles.bigOff,
          isCurrent ? styles.bigCurrent : null,
        ]}
      >
        <Animated.View pointerEvents="none" style={[styles.bigGlow, glowStyle]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  // Six lane-columns side by side.
  board: { flex: 1, flexDirection: 'row', paddingTop: 100, paddingHorizontal: 12, gap: 8 },
  column: { flex: 1 },
  laneLabel: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  cellsCol: { flex: 1, gap: 4 },
  miniCell: { flex: 1, borderRadius: 5, borderWidth: 1 },
  miniOff: { backgroundColor: 'transparent', borderColor: 'rgba(255,255,255,0.1)' },
  miniBeat: { backgroundColor: 'transparent', borderColor: 'rgba(255,255,255,0.2)' },
  miniOn: { backgroundColor: 'rgba(255,255,255,0.28)', borderColor: 'rgba(255,255,255,0.42)' },
  miniCurrent: { borderColor: 'rgba(120,220,255,0.9)', borderWidth: 1.5 },

  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.66)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  panel: {
    width: '72%',
    height: '82%',
    borderRadius: 22,
    backgroundColor: 'rgba(16,16,18,0.98)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
  },
  panelTitle: { color: '#fff', fontSize: 19, fontWeight: '700', letterSpacing: 0.5, marginBottom: 12, textAlign: 'center' },
  // The big vertical lane: 16 tall cells stacked, same orientation as the mini.
  bigCol: { flex: 1, gap: 5 },
  bigCellPress: { flex: 1 },
  bigCell: { flex: 1, borderRadius: 10, borderWidth: 1.5, overflow: 'hidden' },
  bigOff: { backgroundColor: 'transparent', borderColor: 'rgba(255,255,255,0.12)' },
  bigBeat: { backgroundColor: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.24)' },
  bigOn: { backgroundColor: 'rgba(255,255,255,0.28)', borderColor: 'rgba(255,255,255,0.45)' },
  bigCurrent: { borderColor: 'rgba(120,220,255,0.9)', borderWidth: 2 },
  bigGlow: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#fff' },
  hint: { color: 'rgba(255,255,255,0.35)', fontSize: 11, textAlign: 'center', marginTop: 10, letterSpacing: 0.5 },
});
