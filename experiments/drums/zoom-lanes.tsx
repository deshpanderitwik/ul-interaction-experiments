import { useClock } from '@shopify/react-native-skia';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
import { useHostBottomInset } from '../combinations/insets';
import { useSettingsActions } from '../settings';
import { useTempo } from '../tempo';
import { playClap, playHat, playKick, playSnare, playTom } from './voice';

// Drums · Zoom Lanes — a six-piece kit (all modified sines) as six vertical lanes.
// A cell holds a SUBDIVISION count, not just on/off: tap toggles on/off, and
// hold-drag up/down sets how many sub-hits fire inside that step (2, 3, 4… = a
// ratchet/roll, splitting the cell into that many bands that light in sequence).
// A left PAGE selector sets pattern length in bars; a bottom CLIP bar holds whole
// patterns; both center-aligned with Clone/Delete on long-press. Monochrome.

const PAGE = 16; // steps per bar/page
const SCHED_MS = 8;
const isBeat = (s: number) => s % 4 === 0;
// Subdivision rungs a cell steps through on a drag: 0 = off, 1 = single hit, then
// ratchets. Kept modest at the top so fast sub-hits still resolve at this poll rate.
const LEVELS = [0, 1, 2, 3, 4, 6, 8] as const;
const DRAG_PX = 22; // finger travel per subdivision rung
const levelIndex = (v: number) => {
  const i = (LEVELS as readonly number[]).indexOf(v);
  return i < 0 ? (v > 0 ? 1 : 0) : i;
};
const clampIdx = (i: number) => Math.max(0, Math.min(LEVELS.length - 1, i));

type Lane = { id: string; label: string; short: string; play: () => void };
const LANES: Lane[] = [
  { id: 'kick', label: 'Kick', short: 'K', play: () => playKick() },
  { id: 'snare', label: 'Snare', short: 'S', play: () => playSnare() },
  { id: 'tom', label: 'Tom', short: 'T', play: () => playTom() },
  { id: 'clap', label: 'Clap', short: 'C', play: () => playClap() },
  { id: 'chat', label: 'Hat', short: 'H', play: () => playHat(false) },
  { id: 'ohat', label: 'Open Hat', short: 'O', play: () => playHat(true) },
];

type Grid = number[][]; // [lane][step] = subdivision count (0 = off); length is PAGE * pages
const emptyGrid = (): Grid => LANES.map(() => Array(PAGE).fill(0));
const cloneGrid = (g: Grid): Grid => g.map((row) => row.slice());
const pagesOf = (g: Grid): number => g[0].length / PAGE;

const seedGrid = (): Grid => [
  Array.from({ length: PAGE }, (_, s) => (s === 0 || s === 8 ? 1 : 0)), // kick
  Array.from({ length: PAGE }, (_, s) => (s === 4 || s === 12 ? 1 : 0)), // snare
  Array.from({ length: PAGE }, () => 0), // tom
  Array.from({ length: PAGE }, () => 0), // clap
  Array.from({ length: PAGE }, (_, s) => (s % 2 === 0 ? 1 : 0)), // closed hat
  Array.from({ length: PAGE }, () => 0), // open hat
];

const cellKey = (lane: number, step: number) => lane * PAGE + step;
type Flash = { flash: SharedValue<number>; band: SharedValue<number> };

export default function ZoomLanes() {
  const live = useExperimentActive();
  const tempo = useTempo();
  const localClock = useClock();
  const sharedClock = useSharedClock();
  const clock = sharedClock ?? localClock;
  const hostBottomInset = useHostBottomInset();

  const [clips, setClips] = useState<Grid[]>(() => [seedGrid()]);
  const [active, setActive] = useState(0);
  const [viewPage, setViewPage] = useState(0);
  const [current, setCurrent] = useState(-1);
  const [zoomed, setZoomed] = useState<number | null>(null);
  const [clipMenu, setClipMenu] = useState<number | null>(null);
  const [pageMenu, setPageMenu] = useState<number | null>(null);

  const grid = clips[active];
  const pageCount = pagesOf(grid);
  const page = Math.min(Math.max(0, viewPage), pageCount - 1);
  const playingPage = current >= 0 ? Math.floor(current / PAGE) : -1;
  const localCurrent = current >= 0 ? current % PAGE : -1;

  const gridRef = useRef(grid);
  gridRef.current = grid;
  const pageRef = useRef(page);
  pageRef.current = page;
  const activeRef = useRef(active);
  activeRef.current = active;
  const tempoRef = useRef(tempo);
  tempoRef.current = tempo;

  const flashRef = useRef<Map<number, Flash>>(new Map());
  const registerFlash = useCallback((k: number, f: Flash) => flashRef.current.set(k, f), []);
  const unregisterFlash = useCallback((k: number) => flashRef.current.delete(k), []);

  // Set the viewed page's local step `s` of `lane` to a subdivision level.
  const setCell = useCallback((lane: number, s: number, level: number) => {
    const abs = pageRef.current * PAGE + s;
    setClips((prev) =>
      prev.map((g, ci) =>
        ci === activeRef.current ? g.map((row, l) => (l === lane ? row.map((v, i) => (i === abs ? level : v)) : row)) : g
      )
    );
  }, []);

  // Gesture callbacks (stable — read live state via refs).
  const onCellTap = useCallback(
    (lane: number, s: number) => {
      const cur = gridRef.current[lane][pageRef.current * PAGE + s];
      setCell(lane, s, cur > 0 ? 0 : 1); // tap = on/off
      setZoomed(lane); // and focus its lane
    },
    [setCell]
  );
  const dragStartRef = useRef(0);
  const onCellGrab = useCallback((lane: number, s: number) => {
    dragStartRef.current = levelIndex(gridRef.current[lane][pageRef.current * PAGE + s]);
    setZoomed(lane);
  }, []);
  const onCellDrag = useCallback(
    (lane: number, s: number, translationY: number) => {
      // Down = more subdivisions, up = fewer.
      const idx = clampIdx(dragStartRef.current + Math.round(translationY / DRAG_PX));
      setCell(lane, s, LEVELS[idx]);
    },
    [setCell]
  );

  // --- clip ops ---
  const addClip = useCallback(() => {
    setClips((prev) => [...prev, emptyGrid()]);
    setActive(clips.length);
    setViewPage(0);
  }, [clips.length]);
  const cloneClip = useCallback((i: number) => {
    setClips((prev) => [...prev.slice(0, i + 1), cloneGrid(prev[i]), ...prev.slice(i + 1)]);
    setActive(i + 1);
    setClipMenu(null);
  }, []);
  const deleteClip = useCallback(
    (i: number) => {
      if (clips.length <= 1) return;
      setClips((prev) => prev.filter((_, j) => j !== i));
      setActive((a) => (i < a ? a - 1 : i > a ? a : Math.min(a, clips.length - 2)));
      setClipMenu(null);
    },
    [clips.length]
  );

  // --- page ops ---
  const addPage = useCallback(() => {
    setClips((prev) => prev.map((g, ci) => (ci === active ? g.map((row) => [...row, ...Array(PAGE).fill(0)]) : g)));
    setViewPage(pageCount);
  }, [active, pageCount]);
  const clonePage = useCallback(
    (p: number) => {
      setClips((prev) =>
        prev.map((g, ci) =>
          ci === active
            ? g.map((row) => [...row.slice(0, (p + 1) * PAGE), ...row.slice(p * PAGE, (p + 1) * PAGE), ...row.slice((p + 1) * PAGE)])
            : g
        )
      );
      setViewPage(p + 1);
      setPageMenu(null);
    },
    [active]
  );
  const deletePage = useCallback(
    (p: number) => {
      if (pageCount <= 1) return;
      setClips((prev) =>
        prev.map((g, ci) => (ci === active ? g.map((row) => [...row.slice(0, p * PAGE), ...row.slice((p + 1) * PAGE)]) : g))
      );
      setViewPage((vp) => (p < vp ? vp - 1 : p > vp ? vp : Math.min(vp, pageCount - 2)));
      setPageMenu(null);
    },
    [active, pageCount]
  );

  // Fire one sub-hit of a lane's step, and light that band if it's on the viewed page.
  const fireHit = useCallback((lane: number, step: number, subIdx: number) => {
    LANES[lane].play();
    if (Math.floor(step / PAGE) !== pageRef.current) return;
    const f = flashRef.current.get(cellKey(lane, step % PAGE));
    if (f) {
      f.band.value = subIdx;
      f.flash.value = 0;
      f.flash.value = withSequence(
        withTiming(1, { duration: 30, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 200, easing: Easing.out(Easing.quad) })
      );
    }
  }, []);

  // One clock; per-lane ratchet: each lane subdivides its current step into `count`
  // sub-hits and fires on each sub-crossing.
  const t0Ref = useRef(0);
  const lastStepRef = useRef(-1);
  const laneStateRef = useRef(LANES.map(() => ({ step: -1, sub: -1 })));
  useEffect(() => {
    if (!live) return;
    t0Ref.current = sharedClock ? 0 : clock.value;
    lastStepRef.current = -1;
    laneStateRef.current.forEach((r) => {
      r.step = -1;
      r.sub = -1;
    });
    setCurrent(-1);
    const handle = setInterval(() => {
      const bpm = tempoRef.current;
      const stepMs = 60000 / bpm / 4;
      const g = gridRef.current;
      const total = g[0].length;
      const now = clock.value - t0Ref.current;
      const k = Math.floor(now / stepMs);
      const step = ((k % total) + total) % total;
      const intoStep = now - k * stepMs;
      if (step !== lastStepRef.current) {
        lastStepRef.current = step;
        setCurrent(step);
      }
      const ls = laneStateRef.current;
      for (let lane = 0; lane < LANES.length; lane++) {
        if (ls[lane].step !== step) {
          ls[lane].step = step;
          ls[lane].sub = -1;
        }
        const count = g[lane][step];
        if (count <= 0) continue;
        const subIdx = Math.min(count - 1, Math.floor(intoStep / (stepMs / count)));
        if (subIdx !== ls[lane].sub) {
          ls[lane].sub = subIdx;
          fireHit(lane, step, subIdx);
        }
      }
    }, SCHED_MS);
    return () => clearInterval(handle);
  }, [live, fireHit, clock, sharedClock]);

  const actions = useMemo(
    () => [
      {
        id: 'clear',
        label: 'Clear bar',
        onPress: () =>
          setClips((prev) =>
            prev.map((g, ci) =>
              ci === activeRef.current ? g.map((row) => row.map((v, i) => (Math.floor(i / PAGE) === pageRef.current ? 0 : v))) : g
            )
          ),
      },
    ],
    []
  );
  useSettingsActions(actions);

  return (
    <View style={styles.fill}>
      <View style={styles.content}>
        <View style={styles.pageSel}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.pageCol}>
            {Array.from({ length: pageCount }, (_, i) => {
              const selected = i === page;
              const playing = i === playingPage;
              return (
                <Pressable
                  key={i}
                  onPress={() => setViewPage(i)}
                  onLongPress={() => setPageMenu(i)}
                  delayLongPress={280}
                  style={[styles.pageBox, selected ? styles.boxOn : styles.boxOff, playing ? styles.boxPlaying : null]}
                  accessibilityLabel={`Bar ${i + 1}`}
                >
                  <Text style={[styles.boxNum, selected ? styles.boxNumOn : null]}>{i + 1}</Text>
                </Pressable>
              );
            })}
            <Pressable onPress={addPage} style={[styles.pageBox, styles.plusBox]} accessibilityLabel="Add bar">
              <Text style={styles.plus}>+</Text>
            </Pressable>
          </ScrollView>
        </View>

        <View style={styles.board}>
          {LANES.map((lane, l) => {
            const expanded = zoomed === l;
            return (
              <LaneColumn key={lane.id} expanded={expanded} anyZoomed={zoomed != null}>
                <Pressable style={styles.header} onPress={() => setZoomed(expanded ? null : l)}>
                  <Text style={styles.laneLabel} numberOfLines={1}>
                    {expanded ? lane.label : lane.short}
                  </Text>
                </Pressable>
                <View style={styles.cellsCol}>
                  {grid[l].slice(page * PAGE, page * PAGE + PAGE).map((count, s) => (
                    <Cell
                      key={s}
                      lane={l}
                      step={s}
                      count={count}
                      isCurrent={playingPage === page && s === localCurrent}
                      beat={isBeat(s)}
                      onTap={onCellTap}
                      onGrab={onCellGrab}
                      onDrag={onCellDrag}
                      register={registerFlash}
                      unregister={unregisterFlash}
                    />
                  ))}
                </View>
              </LaneColumn>
            );
          })}
        </View>
      </View>

      <View style={[styles.clipBar, { paddingBottom: 26 + hostBottomInset }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.clipRow}>
          {clips.map((_, i) => {
            const selected = i === active;
            return (
              <Pressable
                key={i}
                onPress={() => setActive(i)}
                onLongPress={() => setClipMenu(i)}
                delayLongPress={280}
                style={[styles.clipBox, selected ? styles.boxOn : styles.boxOff]}
                accessibilityLabel={`Clip ${i + 1}`}
              >
                <Text style={[styles.boxNum, selected ? styles.boxNumOn : null]}>{i + 1}</Text>
              </Pressable>
            );
          })}
          <Pressable onPress={addClip} style={[styles.clipBox, styles.plusBox]} accessibilityLabel="Add clip">
            <Text style={styles.plus}>+</Text>
          </Pressable>
        </ScrollView>
      </View>

      {clipMenu != null ? (
        <OpMenu
          title={`Clip ${clipMenu + 1}`}
          onClone={() => cloneClip(clipMenu)}
          onDelete={() => deleteClip(clipMenu)}
          canDelete={clips.length > 1}
          onDismiss={() => setClipMenu(null)}
        />
      ) : null}
      {pageMenu != null ? (
        <OpMenu
          title={`Bar ${pageMenu + 1}`}
          onClone={() => clonePage(pageMenu)}
          onDelete={() => deletePage(pageMenu)}
          canDelete={pageCount > 1}
          onDismiss={() => setPageMenu(null)}
        />
      ) : null}
    </View>
  );
}

function OpMenu({
  title,
  onClone,
  onDelete,
  canDelete,
  onDismiss,
}: {
  title: string;
  onClone: () => void;
  onDelete: () => void;
  canDelete: boolean;
  onDismiss: () => void;
}) {
  return (
    <>
      <Pressable style={styles.backdrop} onPress={onDismiss} />
      <View style={styles.menuOverlay} pointerEvents="box-none">
        <View style={styles.menuCard}>
          <Text style={styles.menuTitle}>{title}</Text>
          <View style={styles.menuRow}>
            <Pressable style={styles.menuBtn} onPress={onClone}>
              <Text style={styles.menuBtnText}>Clone</Text>
            </Pressable>
            <Pressable style={styles.menuBtn} onPress={onDelete} disabled={!canDelete}>
              <Text style={[styles.menuBtnText, styles.menuDelete, canDelete ? null : styles.menuDisabled]}>Delete</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </>
  );
}

const EXPANDED_GROW = 7;
const FOLDED_GROW = 1.6;

function LaneColumn({ expanded, anyZoomed, children }: { expanded: boolean; anyZoomed: boolean; children: ReactNode }) {
  const grow = useSharedValue(1);
  useEffect(() => {
    grow.value = withTiming(anyZoomed ? (expanded ? EXPANDED_GROW : FOLDED_GROW) : 1, {
      duration: 260,
      easing: Easing.inOut(Easing.cubic),
    });
  }, [expanded, anyZoomed, grow]);
  const style = useAnimatedStyle(() => ({ flexGrow: grow.value }));
  return <Animated.View style={[styles.column, style]}>{children}</Animated.View>;
}

// One step cell. Tap = on/off + focus lane; hold-drag up/down = subdivision count.
// A cell with count N shows N bands (top fires first); the firing band lights.
function Cell({
  lane,
  step,
  count,
  isCurrent,
  beat,
  onTap,
  onGrab,
  onDrag,
  register,
  unregister,
}: {
  lane: number;
  step: number;
  count: number;
  isCurrent: boolean;
  beat: boolean;
  onTap: (lane: number, s: number) => void;
  onGrab: (lane: number, s: number) => void;
  onDrag: (lane: number, s: number, ty: number) => void;
  register: (k: number, f: Flash) => void;
  unregister: (k: number) => void;
}) {
  const flash = useSharedValue(0);
  const band = useSharedValue(-1);
  useEffect(() => {
    register(cellKey(lane, step), { flash, band });
    return () => unregister(cellKey(lane, step));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lane, step]);

  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .minDistance(8)
      .onStart(() => runOnJS(onGrab)(lane, step))
      .onUpdate((e) => runOnJS(onDrag)(lane, step, e.translationY));
    const tap = Gesture.Tap()
      .maxDuration(250)
      .onStart(() => runOnJS(onTap)(lane, step));
    return Gesture.Race(pan, tap);
  }, [lane, step, onTap, onGrab, onDrag]);

  const n = Math.max(1, count);

  return (
    <GestureDetector gesture={gesture}>
      <View style={[styles.cell, count > 0 ? styles.cellOn : beat ? styles.cellBeat : styles.cellOff, isCurrent ? styles.cellCurrent : null]}>
        {count > 0 ? (
          <View style={styles.bands}>
            {Array.from({ length: n }, (_, i) => (
              <Band key={i} index={i} flash={flash} band={band} />
            ))}
          </View>
        ) : null}
      </View>
    </GestureDetector>
  );
}

function Band({ index, flash, band }: { index: number; flash: SharedValue<number>; band: SharedValue<number> }) {
  const style = useAnimatedStyle(() => {
    const lit = band.value === index ? flash.value : 0;
    return { opacity: 0.26 + 0.74 * lit };
  });
  return <Animated.View style={[styles.band, style]} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  content: { flex: 1, flexDirection: 'row', paddingTop: 96 },

  pageSel: { width: 48 },
  pageCol: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', gap: 8, paddingVertical: 8 },
  pageBox: { width: 34, height: 34, borderRadius: 9, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },

  board: { flex: 1, flexDirection: 'row', paddingRight: 12, paddingLeft: 4, paddingBottom: 8, gap: 8 },
  column: { flexBasis: 0, flexShrink: 1, overflow: 'hidden' },
  header: { height: 24, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  laneLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: '700', textAlign: 'center' },
  cellsCol: { flex: 1, gap: 4 },
  cell: { flex: 1, borderRadius: 6, borderWidth: 1, overflow: 'hidden', padding: 2 },
  cellOff: { backgroundColor: 'transparent', borderColor: 'rgba(255,255,255,0.1)' },
  cellBeat: { backgroundColor: 'transparent', borderColor: 'rgba(255,255,255,0.22)' },
  cellOn: { backgroundColor: 'transparent', borderColor: 'rgba(255,255,255,0.5)' },
  cellCurrent: { borderColor: '#fff', borderWidth: 2 },
  bands: { flex: 1, gap: 2 },
  band: { flex: 1, borderRadius: 3, backgroundColor: '#fff' },

  boxOff: { borderColor: 'rgba(255,255,255,0.22)', backgroundColor: 'transparent' },
  boxOn: { borderColor: '#fff', backgroundColor: 'rgba(255,255,255,0.16)' },
  boxPlaying: { borderColor: '#fff', borderWidth: 2 },
  boxNum: { color: 'rgba(255,255,255,0.5)', fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  boxNumOn: { color: '#fff' },
  plusBox: { borderColor: 'rgba(255,255,255,0.28)', borderStyle: 'dashed' },
  plus: { color: 'rgba(255,255,255,0.6)', fontSize: 20, fontWeight: '400', lineHeight: 22 },

  clipBar: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.12)', paddingTop: 10 },
  clipRow: { flexGrow: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 14 },
  clipBox: { width: 40, height: 40, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },

  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  menuOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
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
  menuBtn: { paddingVertical: 9, paddingHorizontal: 22, borderRadius: 11, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.22)' },
  menuBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  menuDelete: { color: '#ff5a5a' },
  menuDisabled: { color: 'rgba(255,90,90,0.35)' },
});
