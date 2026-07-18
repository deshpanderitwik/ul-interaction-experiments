import { useClock } from '@shopify/react-native-skia';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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
// A cell holds a subdivision count (tap on/off + focus lane; hold-drag up/down
// sets ratchets). A vertical PAGE selector (left) sets pattern length in bars; a
// bottom CLIP bar holds whole patterns. Both are center-aligned, same box size —
// and to duplicate a bar/clip you press its box and drag it onto the + (which
// lights up); dropping on the + clones it. Monochrome; shared clock.

const PAGE = 16;
const SCHED_MS = 8;
const isBeat = (s: number) => s % 4 === 0;
const LEVELS = [0, 1, 2, 3, 4, 6, 8] as const;
const DRAG_PX = 22;
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

type Grid = number[][];
const emptyGrid = (): Grid => LANES.map(() => Array(PAGE).fill(0));
const cloneGrid = (g: Grid): Grid => g.map((row) => row.slice());
const pagesOf = (g: Grid): number => g[0].length / PAGE;

const cellKey = (lane: number, step: number) => lane * PAGE + step;
type Flash = { flash: SharedValue<number>; band: SharedValue<number> };
type Rect = { x: number; y: number; w: number; h: number };

export default function ZoomLanes() {
  const live = useExperimentActive();
  const tempo = useTempo();
  const localClock = useClock();
  const sharedClock = useSharedClock();
  const clock = sharedClock ?? localClock;
  const hostBottomInset = useHostBottomInset();

  const [clips, setClips] = useState<Grid[]>(() => [emptyGrid()]);
  const [active, setActive] = useState(0);
  const [viewPage, setViewPage] = useState(0);
  const [current, setCurrent] = useState(-1);
  const [zoomed, setZoomed] = useState<number | null>(null);

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
  const clipCountRef = useRef(clips.length);
  clipCountRef.current = clips.length;
  const pageCountRef = useRef(pageCount);
  pageCountRef.current = pageCount;
  const tempoRef = useRef(tempo);
  tempoRef.current = tempo;

  const flashRef = useRef<Map<number, Flash>>(new Map());
  const registerFlash = useCallback((k: number, f: Flash) => flashRef.current.set(k, f), []);
  const unregisterFlash = useCallback((k: number) => flashRef.current.delete(k), []);

  // --- + drop targets (measured window rects + hover highlight, for drag-to-clone) ---
  const clipPlusRef = useRef<View>(null);
  const pagePlusRef = useRef<View>(null);
  const clipPlusRect = useSharedValue<Rect>({ x: 0, y: 0, w: 0, h: 0 });
  const pagePlusRect = useSharedValue<Rect>({ x: 0, y: 0, w: 0, h: 0 });
  const clipPlusHot = useSharedValue(0);
  const pagePlusHot = useSharedValue(0);
  // 0 at rest, 1 while a box in that selector is being dragged — fades the drop
  // targets in/out so + and trash only show during a drag.
  const clipDragActive = useSharedValue(0);
  const pageDragActive = useSharedValue(0);
  const measureClipPlus = useCallback(() => {
    clipPlusRef.current?.measureInWindow((x, y, w, h) => (clipPlusRect.value = { x, y, w, h }));
  }, [clipPlusRect]);
  const measurePagePlus = useCallback(() => {
    pagePlusRef.current?.measureInWindow((x, y, w, h) => (pagePlusRect.value = { x, y, w, h }));
  }, [pagePlusRect]);
  const clipPlusStyle = useAnimatedStyle(() => ({
    opacity: clipDragActive.value,
    borderColor: clipPlusHot.value > 0.5 ? '#fff' : 'rgba(255,255,255,0.28)',
    transform: [{ scale: 1 + 0.1 * clipPlusHot.value }],
  }));
  const pagePlusStyle = useAnimatedStyle(() => ({
    opacity: pageDragActive.value,
    borderColor: pagePlusHot.value > 0.5 ? '#fff' : 'rgba(255,255,255,0.28)',
    transform: [{ scale: 1 + 0.1 * pagePlusHot.value }],
  }));

  const clipTrashRef = useRef<View>(null);
  const pageTrashRef = useRef<View>(null);
  const clipTrashRect = useSharedValue<Rect>({ x: 0, y: 0, w: 0, h: 0 });
  const pageTrashRect = useSharedValue<Rect>({ x: 0, y: 0, w: 0, h: 0 });
  const clipTrashHot = useSharedValue(0);
  const pageTrashHot = useSharedValue(0);
  const measureClipTrash = useCallback(() => {
    clipTrashRef.current?.measureInWindow((x, y, w, h) => (clipTrashRect.value = { x, y, w, h }));
  }, [clipTrashRect]);
  const measurePageTrash = useCallback(() => {
    pageTrashRef.current?.measureInWindow((x, y, w, h) => (pageTrashRect.value = { x, y, w, h }));
  }, [pageTrashRect]);
  const clipTrashStyle = useAnimatedStyle(() => ({
    opacity: clipDragActive.value,
    borderColor: clipTrashHot.value > 0.5 ? '#ff5a5a' : 'rgba(255,255,255,0.28)',
    transform: [{ scale: 1 + 0.1 * clipTrashHot.value }],
  }));
  const pageTrashStyle = useAnimatedStyle(() => ({
    opacity: pageDragActive.value,
    borderColor: pageTrashHot.value > 0.5 ? '#ff5a5a' : 'rgba(255,255,255,0.28)',
    transform: [{ scale: 1 + 0.1 * pageTrashHot.value }],
  }));

  // --- editing ---
  const setCell = useCallback((lane: number, s: number, level: number) => {
    const abs = pageRef.current * PAGE + s;
    setClips((prev) =>
      prev.map((g, ci) =>
        ci === activeRef.current ? g.map((row, l) => (l === lane ? row.map((v, i) => (i === abs ? level : v)) : row)) : g
      )
    );
  }, []);

  const onCellTap = useCallback(
    (lane: number, s: number) => {
      const cur = gridRef.current[lane][pageRef.current * PAGE + s];
      setCell(lane, s, cur > 0 ? 0 : 1);
      setZoomed(lane);
    },
    [setCell]
  );
  const dragStartRef = useRef(0);
  const dragLastIdxRef = useRef(0);
  const onCellGrab = useCallback((lane: number, s: number) => {
    const idx = levelIndex(gridRef.current[lane][pageRef.current * PAGE + s]);
    dragStartRef.current = idx;
    dragLastIdxRef.current = idx;
    setZoomed(lane);
  }, []);
  const onCellDrag = useCallback(
    (lane: number, s: number, translationY: number) => {
      const idx = clampIdx(dragStartRef.current + Math.round(translationY / DRAG_PX));
      if (idx === dragLastIdxRef.current) return; // commit only on a rung change (keeps playback smooth)
      dragLastIdxRef.current = idx;
      setCell(lane, s, LEVELS[idx]);
    },
    [setCell]
  );

  // --- clip / page ops (stable via refs) ---
  const onClipSelect = useCallback((i: number) => setActive(i), []);
  const onPageSelect = useCallback((i: number) => setViewPage(i), []);
  const cloneClip = useCallback((i: number) => {
    setClips((prev) => [...prev.slice(0, i + 1), cloneGrid(prev[i]), ...prev.slice(i + 1)]);
    setActive(i + 1);
  }, []);
  const deleteClip = useCallback((i: number) => {
    if (clipCountRef.current <= 1) return; // keep at least one clip
    setClips((prev) => prev.filter((_, j) => j !== i));
    setActive((a) => (i < a ? a - 1 : i > a ? a : Math.min(a, clipCountRef.current - 2)));
  }, []);
  const clonePage = useCallback((p: number) => {
    const a = activeRef.current;
    setClips((prev) =>
      prev.map((g, ci) =>
        ci === a ? g.map((row) => [...row.slice(0, (p + 1) * PAGE), ...row.slice(p * PAGE, (p + 1) * PAGE), ...row.slice((p + 1) * PAGE)]) : g
      )
    );
    setViewPage(p + 1);
  }, []);
  const deletePage = useCallback((p: number) => {
    if (pageCountRef.current <= 1) return; // keep at least one bar
    const a = activeRef.current;
    setClips((prev) => prev.map((g, ci) => (ci === a ? g.map((row) => [...row.slice(0, p * PAGE), ...row.slice((p + 1) * PAGE)]) : g)));
    setViewPage((vp) => (p < vp ? vp - 1 : p > vp ? vp : Math.min(vp, pageCountRef.current - 2)));
  }, []);

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
        {/* Page selector (left) — drag a bar onto + to clone it. */}
        <View style={styles.pageSel}>
          <View style={styles.pageCol}>
            {Array.from({ length: pageCount }, (_, i) => (
              <SelectorBox
                key={i}
                index={i}
                label={i + 1}
                selected={i === page}
                playing={i === playingPage}
                onSelect={onPageSelect}
                onClone={clonePage}
                onDelete={deletePage}
                plusRect={pagePlusRect}
                plusHot={pagePlusHot}
                trashRect={pageTrashRect}
                trashHot={pageTrashHot}
                dragActive={pageDragActive}
              />
            ))}
          </View>
          {/* Drop targets — only visible while dragging a bar. */}
          <View style={styles.pageDrops} pointerEvents="none">
            <View ref={pagePlusRef} onLayout={measurePagePlus}>
              <Animated.View style={[styles.selBox, styles.plusBox, pagePlusStyle]}>
                <Text style={styles.plus}>+</Text>
              </Animated.View>
            </View>
            <View ref={pageTrashRef} onLayout={measurePageTrash}>
              <Animated.View style={[styles.selBox, styles.plusBox, pageTrashStyle]}>
                <TrashIcon />
              </Animated.View>
            </View>
          </View>
        </View>

        {/* Lanes for the viewed bar. */}
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

      {/* Clip bar (bottom) — drag a clip onto + to clone it. */}
      <View style={[styles.clipBar, { paddingBottom: 26 + hostBottomInset }]}>
        <View style={styles.clipRow}>
          {clips.map((_, i) => (
            <SelectorBox
              key={i}
              index={i}
              label={i + 1}
              selected={i === active}
              onSelect={onClipSelect}
              onClone={cloneClip}
              onDelete={deleteClip}
              plusRect={clipPlusRect}
              plusHot={clipPlusHot}
              trashRect={clipTrashRect}
              trashHot={clipTrashHot}
              dragActive={clipDragActive}
            />
          ))}
        </View>
        {/* Drop targets — only visible while dragging a clip. */}
        <View style={styles.clipDrops} pointerEvents="none">
          <View ref={clipPlusRef} onLayout={measureClipPlus}>
            <Animated.View style={[styles.selBox, styles.plusBox, clipPlusStyle]}>
              <Text style={styles.plus}>+</Text>
            </Animated.View>
          </View>
          <View ref={clipTrashRef} onLayout={measureClipTrash}>
            <Animated.View style={[styles.selBox, styles.plusBox, clipTrashStyle]}>
              <TrashIcon />
            </Animated.View>
          </View>
        </View>
      </View>
    </View>
  );
}

// A page/clip box: tap to select; press-drag onto the + to clone it, or onto the
// trash to delete it. It follows the finger while dragging and lights whichever
// drop target it's hovering.
function SelectorBox({
  index,
  label,
  selected,
  playing,
  onSelect,
  onClone,
  onDelete,
  plusRect,
  plusHot,
  trashRect,
  trashHot,
  dragActive,
}: {
  index: number;
  label: number;
  selected: boolean;
  playing?: boolean;
  onSelect: (i: number) => void;
  onClone: (i: number) => void;
  onDelete: (i: number) => void;
  plusRect: SharedValue<Rect>;
  plusHot: SharedValue<number>;
  trashRect: SharedValue<Rect>;
  trashHot: SharedValue<number>;
  dragActive: SharedValue<number>;
}) {
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const lift = useSharedValue(0);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: 1 + 0.12 * lift.value }],
    opacity: 1 - 0.2 * lift.value,
    zIndex: lift.value > 0 ? 20 : 0,
  }));

  const gesture = useMemo(() => {
    const inRect = (r: Rect, ax: number, ay: number) => {
      'worklet';
      return ax >= r.x && ax <= r.x + r.w && ay >= r.y && ay <= r.y + r.h;
    };
    const pan = Gesture.Pan()
      .minDistance(10)
      .onStart(() => {
        lift.value = withTiming(1, { duration: 120 });
        dragActive.value = withTiming(1, { duration: 120 }); // reveal the drop targets
      })
      .onUpdate((e) => {
        tx.value = e.translationX;
        ty.value = e.translationY;
        plusHot.value = inRect(plusRect.value, e.absoluteX, e.absoluteY) ? 1 : 0;
        trashHot.value = inRect(trashRect.value, e.absoluteX, e.absoluteY) ? 1 : 0;
      })
      .onEnd((e) => {
        if (inRect(plusRect.value, e.absoluteX, e.absoluteY)) runOnJS(onClone)(index);
        else if (inRect(trashRect.value, e.absoluteX, e.absoluteY)) runOnJS(onDelete)(index);
      })
      .onFinalize(() => {
        tx.value = withTiming(0, { duration: 180 });
        ty.value = withTiming(0, { duration: 180 });
        lift.value = withTiming(0, { duration: 180 });
        plusHot.value = 0;
        trashHot.value = 0;
        dragActive.value = withTiming(0, { duration: 200 });
      });
    const tap = Gesture.Tap()
      .maxDuration(250)
      .onStart(() => runOnJS(onSelect)(index));
    return Gesture.Race(pan, tap);
  }, [index, onSelect, onClone, onDelete, plusRect, plusHot, trashRect, trashHot, dragActive, tx, ty, lift]);

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.selBox, selected ? styles.boxOn : styles.boxOff, playing ? styles.boxPlaying : null, style]}>
        <Text style={[styles.boxNum, selected ? styles.boxNumOn : null]}>{label}</Text>
      </Animated.View>
    </GestureDetector>
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

// A minimal trash-can glyph (muted red) drawn from a few views — the delete target.
function TrashIcon() {
  const c = 'rgba(255,90,90,0.75)';
  return (
    <View style={styles.trashIcon}>
      <View style={{ width: 7, height: 2, borderRadius: 1, backgroundColor: c, marginBottom: 1.5 }} />
      <View style={{ width: 15, height: 2, borderRadius: 1, backgroundColor: c }} />
      <View
        style={{ width: 11, height: 10, borderWidth: 1.5, borderColor: c, borderTopWidth: 0, borderBottomLeftRadius: 3, borderBottomRightRadius: 3, marginTop: 1 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  content: { flex: 1, flexDirection: 'row', paddingTop: 96 },

  pageSel: { width: 52 },
  pageCol: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8, paddingVertical: 8 },
  // Drop targets, stacked at the bottom of the page column (shown only on drag).
  pageDrops: { position: 'absolute', bottom: 8, left: 0, right: 0, alignItems: 'center', gap: 8 },

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

  // Shared selector box (page + clip): same size.
  selBox: { width: 40, height: 40, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  boxOff: { borderColor: 'rgba(255,255,255,0.22)', backgroundColor: 'transparent' },
  boxOn: { borderColor: '#fff', backgroundColor: 'rgba(255,255,255,0.16)' },
  boxPlaying: { borderColor: '#fff', borderWidth: 2 },
  boxNum: { color: 'rgba(255,255,255,0.5)', fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  boxNumOn: { color: '#fff' },
  plusBox: { borderStyle: 'dashed' },
  plus: { color: 'rgba(255,255,255,0.6)', fontSize: 20, fontWeight: '400', lineHeight: 22 },
  trashIcon: { alignItems: 'center' },

  clipBar: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.12)', paddingTop: 10 },
  clipRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 14 },
  // Drop targets, at the right end of the clip bar (shown only on drag).
  clipDrops: { position: 'absolute', right: 14, top: 10, flexDirection: 'row', gap: 8 },
});
