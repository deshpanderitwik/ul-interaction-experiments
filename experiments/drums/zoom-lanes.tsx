import { useClock } from '@shopify/react-native-skia';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
import { playClap, playHat, playKick, playSnare, playTom } from './voice';

// Drums · Zoom Lanes — a six-piece kit (all modified sines) as six vertical lanes.
// Tap a lane to grow it in place for editing (see LaneColumn). A bottom clip bar
// holds multiple patterns: each clip is a full 6×16 grid, tap a box to switch to
// it, the + adds a new one, and long-pressing a box surfaces Clone / Delete.
// Monochrome. Everything plays off the shared clock.

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

type Grid = boolean[][]; // [lane][step]
const emptyGrid = (): Grid => LANES.map(() => Array(STEPS).fill(false));
const cloneGrid = (g: Grid): Grid => g.map((row) => row.slice());

// The first clip is seeded with a basic beat; tom/clap/open-hat empty to fill in.
const seedGrid = (): Grid => [
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

  const [clips, setClips] = useState<Grid[]>(() => [seedGrid()]);
  const [active, setActive] = useState(0);
  const [current, setCurrent] = useState(-1);
  const [zoomed, setZoomed] = useState<number | null>(null); // which lane is enlarged
  const [menuFor, setMenuFor] = useState<number | null>(null); // clip index whose Clone/Delete menu is open

  const grid = clips[active]; // the active clip, drawn + edited

  const gridRef = useRef(grid);
  gridRef.current = grid;
  const activeRef = useRef(active);
  activeRef.current = active;
  const tempoRef = useRef(tempo);
  tempoRef.current = tempo;

  const flashRef = useRef<Map<number, Flash>>(new Map());
  const registerFlash = useCallback((k: number, f: Flash) => flashRef.current.set(k, f), []);
  const unregisterFlash = useCallback((k: number) => flashRef.current.delete(k), []);

  const toggle = useCallback(
    (lane: number, step: number) => {
      setClips((prev) =>
        prev.map((g, ci) =>
          ci === active ? g.map((row, l) => (l === lane ? row.map((on, s) => (s === step ? !on : on)) : row)) : g
        )
      );
    },
    [active]
  );

  // --- clip operations ---------------------------------------------------------
  const addClip = useCallback(() => {
    setClips((prev) => [...prev, emptyGrid()]);
    setActive(clips.length); // new clip is appended at the current length
  }, [clips.length]);

  const cloneClip = useCallback((i: number) => {
    setClips((prev) => [...prev.slice(0, i + 1), cloneGrid(prev[i]), ...prev.slice(i + 1)]);
    setActive(i + 1); // switch to the clone (inserted right after)
    setMenuFor(null);
  }, []);

  const deleteClip = useCallback(
    (i: number) => {
      if (clips.length <= 1) return; // keep at least one clip
      setClips((prev) => prev.filter((_, j) => j !== i));
      setActive((a) => {
        if (i < a) return a - 1;
        if (i > a) return a;
        return Math.min(a, clips.length - 2); // deleted the active one — clamp
      });
      setMenuFor(null);
    },
    [clips.length]
  );

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
    () => [
      {
        id: 'clear',
        label: 'Clear clip',
        onPress: () => setClips((prev) => prev.map((g, ci) => (ci === activeRef.current ? emptyGrid() : g))),
      },
    ],
    []
  );
  useSettingsActions(actions);

  return (
    <View style={styles.fill}>
      <View style={styles.board}>
        {LANES.map((lane, l) => {
          const expanded = zoomed === l;
          return (
            <LaneColumn key={lane.id} expanded={expanded} anyZoomed={zoomed != null}>
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
            </LaneColumn>
          );
        })}
      </View>

      {/* Clip bar: switch patterns, add with +, long-press a box for Clone/Delete. */}
      <View style={[styles.clipBar, { paddingBottom: 10 + hostBottomInset }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.clipRow}>
          {clips.map((_, i) => {
            const isActive = i === active;
            return (
              <Pressable
                key={i}
                onPress={() => setActive(i)}
                onLongPress={() => setMenuFor(i)}
                delayLongPress={280}
                style={[styles.clipBox, isActive ? styles.clipBoxOn : styles.clipBoxOff]}
                accessibilityLabel={`Clip ${i + 1}${isActive ? ', playing' : ''}`}
              >
                <Text style={[styles.clipNum, isActive ? styles.clipNumOn : null]}>{i + 1}</Text>
              </Pressable>
            );
          })}
          <Pressable onPress={addClip} style={[styles.clipBox, styles.plusBox]} accessibilityLabel="Add clip">
            <Text style={styles.plus}>+</Text>
          </Pressable>
        </ScrollView>
      </View>

      {/* Long-press menu for a clip. */}
      {menuFor != null ? (
        <>
          <Pressable style={styles.backdrop} onPress={() => setMenuFor(null)} />
          <View style={[styles.menuWrap, { bottom: 68 + hostBottomInset }]} pointerEvents="box-none">
            <View style={styles.menuCard}>
              <Text style={styles.menuTitle}>Clip {menuFor + 1}</Text>
              <View style={styles.menuRow}>
                <Pressable style={styles.menuBtn} onPress={() => cloneClip(menuFor)}>
                  <Text style={styles.menuBtnText}>Clone</Text>
                </Pressable>
                <Pressable
                  style={styles.menuBtn}
                  onPress={() => deleteClip(menuFor)}
                  disabled={clips.length <= 1}
                >
                  <Text style={[styles.menuBtnText, styles.menuDelete, clips.length <= 1 ? styles.menuDisabled : null]}>
                    Delete
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </>
      ) : null}
    </View>
  );
}

// Enlarged lane's share vs a folded lane's share of the row width. Folded is kept
// generous (not a thin sliver) so it stays easy to tap.
const EXPANDED_GROW = 7;
const FOLDED_GROW = 1.6;

// A lane column whose width is driven by an animated flexGrow — so it interpolates
// smoothly every frame both while opening AND while closing.
function LaneColumn({
  expanded,
  anyZoomed,
  children,
}: {
  expanded: boolean;
  anyZoomed: boolean;
  children: ReactNode;
}) {
  const grow = useSharedValue(1);
  useEffect(() => {
    const target = anyZoomed ? (expanded ? EXPANDED_GROW : FOLDED_GROW) : 1;
    grow.value = withTiming(target, { duration: 260, easing: Easing.inOut(Easing.cubic) });
  }, [expanded, anyZoomed, grow]);
  const style = useAnimatedStyle(() => ({ flexGrow: grow.value }));
  return <Animated.View style={[styles.column, style]}>{children}</Animated.View>;
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
  board: { flex: 1, flexDirection: 'row', paddingTop: 100, paddingHorizontal: 12, paddingBottom: 8, gap: 8 },
  // flexGrow is animated in LaneColumn; basis 0 + shrink 1 make it behave like `flex`.
  column: { flexBasis: 0, flexShrink: 1, overflow: 'hidden' },
  header: { height: 24, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  laneLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: '700', textAlign: 'center' },
  cellsCol: { flex: 1, gap: 4 },
  cellPress: { flex: 1 },
  cell: { flex: 1, borderRadius: 6, borderWidth: 1, overflow: 'hidden' },
  cellOff: { backgroundColor: 'transparent', borderColor: 'rgba(255,255,255,0.1)' },
  cellBeat: { backgroundColor: 'transparent', borderColor: 'rgba(255,255,255,0.22)' },
  cellOn: { backgroundColor: 'rgba(255,255,255,0.3)', borderColor: 'rgba(255,255,255,0.5)' },
  cellCurrent: { borderColor: '#fff', borderWidth: 2 },
  cellGlow: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#fff' },

  // Clip bar
  clipBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.12)',
    paddingTop: 10,
  },
  clipRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14 },
  clipBox: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clipBoxOff: { borderColor: 'rgba(255,255,255,0.22)', backgroundColor: 'transparent' },
  clipBoxOn: { borderColor: '#fff', backgroundColor: 'rgba(255,255,255,0.16)' },
  clipNum: { color: 'rgba(255,255,255,0.5)', fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  clipNumOn: { color: '#fff' },
  plusBox: { borderColor: 'rgba(255,255,255,0.28)', borderStyle: 'dashed' },
  plus: { color: 'rgba(255,255,255,0.6)', fontSize: 22, fontWeight: '400', lineHeight: 24 },

  // Long-press menu
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  menuWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  menuCard: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(20,20,22,0.98)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
  },
  menuTitle: { color: 'rgba(255,255,255,0.55)', fontSize: 12, letterSpacing: 1, marginBottom: 10, textTransform: 'uppercase' },
  menuRow: { flexDirection: 'row', gap: 10 },
  menuBtn: {
    paddingVertical: 9,
    paddingHorizontal: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  menuBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  menuDelete: { color: '#ff5a5a' },
  menuDisabled: { color: 'rgba(255,90,90,0.35)' },
});
