import { Canvas, DashPathEffect, Rect } from '@shopify/react-native-skia';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useExperimentActive } from '../_host';
import { getScale, ladderNotes, noteName, useScale } from '../scale';
import { useSettings } from '../settings';
import { useTempo } from '../tempo';
import { DEADZONE, N, RADIAL_NOTE_R, RADIAL_RADIUS, pluck } from './shared';

// Each chord lasts (and re-triggers) for the selected note length, at the
// global tempo.
const SETTINGS = {
  noteLength: {
    type: 'select',
    label: 'Note length',
    options: [
      { label: '1/4', value: 4 },
      { label: '1/8', value: 8 },
      { label: '1/16', value: 16 },
      { label: '1/32', value: 32 },
    ],
    default: 4,
  },
} as const;

type CellMode = 'radial' | 'tap';
type Cell = { degree: number; octave: number; label: string; freq: number };

// Note Radial — press & hold to summon a ring of the current scale's 7 notes;
// drag and release to pop a note into the SELECTED chord. The bottom bar holds a
// progression of chords (dots); tap a dot to edit it, + to add (copy current or
// blank), long-press to delete. The progression auto-plays on a loop: each slot
// strums its chord (blank = silent rest); the playhead highlight moves across
// the dots. Recording captures the looping progression including live edits.
//
// The "tap" mode (Non Radial variation) drops the radial entirely: every lane
// cell shows up front in a warm waiting state with its note name, and you tap a
// cell to toggle that note on/off in the selected chord.

type NoteData = { freq: number; label: string };
type RadialState = {
  cx: number;
  cy: number;
  notes: NoteData[];
  disabled: boolean[];
  octave: number; // 1 = upper square, 0 = lower
};
// A placed note lives in a lane: its scale degree (0 = root .. 6) within an
// octave square. It renders as a full-width bar in that lane.
type ActiveNote = { id: number; degree: number; octave: number; label: string; freq: number };
type Chord = { id: number; notes: ActiveNote[] };

// Root (i = 0) sits at the bottom (6 o'clock); successive notes go clockwise.
function angleFor(i: number): number {
  return Math.PI / 2 + (i * 2 * Math.PI) / N;
}

function freqLabel(freq: number): string {
  return noteName(Math.round(69 + 12 * Math.log2(freq / 440)));
}

export default function NoteRadial({ mode = 'radial' }: { mode?: CellMode }) {
  const live = useExperimentActive();
  const scale = useScale();
  const { noteLength } = useSettings(SETTINGS);
  const bpm = useTempo();
  const slotMs = 240000 / bpm / noteLength; // 1/4 note .. 1/32 note at the tempo
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const BAR_AREA = 60 + insets.bottom;
  const canvasH = height - BAR_AREA;

  const [chords, setChords] = useState<Chord[]>([{ id: 0, notes: [] }]);
  const [chordIndex, setChordIndex] = useState(0); // selected (editing) chord
  const [playhead, setPlayhead] = useState(0); // currently-sounding chord
  const [playing, setPlaying] = useState(true); // auto-play running?
  const [radial, setRadial] = useState<RadialState | null>(null);

  const chordsRef = useRef(chords);
  chordsRef.current = chords;
  const chordIndexRef = useRef(chordIndex);
  chordIndexRef.current = chordIndex;
  const playheadRef = useRef(playhead);
  playheadRef.current = playhead;

  const activeNotes = chords[chordIndex]?.notes ?? [];
  const activeNotesRef = useRef<ActiveNote[]>(activeNotes);
  activeNotesRef.current = activeNotes;

  const radialRef = useRef<RadialState | null>(null);
  const radialShownRef = useRef(false);
  const octaveBoundaryRef = useRef(canvasH / 2);
  const pendingRemove = useRef<number | null>(null);
  const noteId = useRef(1);
  const nextChordId = useRef(1);
  // Current octave-square geometry, kept in a ref so the gesture handler (and
  // bar rects) can read it without re-creating the gesture each layout pass.
  const layoutRef = useRef({ sqX: 0, side: 0, topY: 0, botY: 0 });

  const centerX = useSharedValue(0);
  const centerY = useSharedValue(0);
  const selected = useSharedValue(-1); // ring index under the finger
  const moved = useSharedValue(0);
  const disabledMask = useSharedValue(0);
  const strumPulse = useSharedValue(0);

  // ---- chord note edits (operate on the selected chord) ----
  const addNote = (note: ActiveNote) => {
    setChords((prev) =>
      prev.map((c, i) => (i === chordIndexRef.current ? { ...c, notes: [...c.notes, note] } : c))
    );
  };
  const removeNote = (id: number) => {
    setChords((prev) =>
      prev.map((c, i) =>
        i === chordIndexRef.current ? { ...c, notes: c.notes.filter((n) => n.id !== id) } : c
      )
    );
  };

  // The on-screen rect for a lane: full-width of its octave square, one lane
  // tall (1/7 of the square), with the root lane at the bottom and degrees
  // stacking upward.
  const laneRect = (degree: number, octave: number) => {
    const L = layoutRef.current;
    const laneH = L.side / N;
    const sqTop = octave === 1 ? L.topY : L.botY;
    return { x: L.sqX, y: sqTop + L.side - (degree + 1) * laneH, w: L.side, h: laneH };
  };
  const rectFor = (note: ActiveNote) => laneRect(note.degree, note.octave);

  // ---- tap mode: every lane shown as a tappable cell ----
  // The full grid of cells (both octaves × 7 degrees) with their note names.
  const cells = useMemo<Cell[]>(() => {
    const ring = ladderNotes(scale, 48 + scale.root).slice(0, N);
    const out: Cell[] = [];
    for (const octave of [1, 0]) {
      for (let d = 0; d < N; d++) {
        const freq = ring[d].freq * Math.pow(2, octave);
        out.push({ degree: d, octave, label: freqLabel(freq), freq });
      }
    }
    return out;
  }, [scale]);
  const toggleCell = (cell: Cell) => {
    const existing = activeNotesRef.current.find(
      (n) => n.degree === cell.degree && n.octave === cell.octave
    );
    if (existing) {
      removeNote(existing.id);
    } else {
      pluck(cell.freq);
      addNote({
        id: noteId.current++,
        degree: cell.degree,
        octave: cell.octave,
        label: cell.label,
        freq: cell.freq,
      });
    }
  };

  // ---- radial ----
  const showRadial = (x: number, y: number) => {
    const scale = getScale();
    const octaveShift = y < octaveBoundaryRef.current ? 1 : 0;
    const ring = ladderNotes(scale, 48 + scale.root)
      .slice(0, N)
      .map((rn) => {
        const freq = rn.freq * Math.pow(2, octaveShift);
        return { freq, label: freqLabel(freq) };
      });
    const active = new Set(activeNotesRef.current.map((n) => n.label));
    const disabled = ring.map((r) => active.has(r.label));
    let mask = 0;
    disabled.forEach((d, i) => {
      if (d) mask |= 1 << i;
    });
    disabledMask.value = mask;
    const state = { cx: x, cy: y, notes: ring, disabled, octave: octaveShift };
    radialRef.current = state;
    radialShownRef.current = true;
    setRadial(state);
  };
  const hideRadial = () => {
    radialRef.current = null;
    radialShownRef.current = false;
    setRadial(null);
  };
  const popNote = (idx: number) => {
    const r = radialRef.current;
    if (!r || idx < 0 || idx >= r.notes.length || r.disabled[idx]) return;
    const note = r.notes[idx];
    pluck(note.freq);
    addNote({
      id: noteId.current++,
      degree: idx,
      octave: r.octave,
      label: note.label,
      freq: note.freq,
    });
  };

  const onDown = (x: number, y: number) => {
    const hit = [...activeNotesRef.current].reverse().find((n) => {
      const rc = rectFor(n);
      return x >= rc.x && x <= rc.x + rc.w && y >= rc.y && y <= rc.y + rc.h;
    });
    if (hit) {
      pendingRemove.current = hit.id;
    } else {
      pendingRemove.current = null;
      showRadial(x, y);
    }
  };
  const onEndJS = (movedFlag: number, sel: number) => {
    if (pendingRemove.current != null && !movedFlag) {
      removeNote(pendingRemove.current);
    } else if (radialShownRef.current && sel >= 0) {
      popNote(sel);
    }
    pendingRemove.current = null;
    hideRadial();
  };

  // ---- chord bar actions ----
  const onSelectChord = (i: number) => setChordIndex(i); // silent swap
  const onAddCopy = () => {
    const cur = chordsRef.current[chordIndexRef.current];
    const notes = cur ? cur.notes.map((n) => ({ ...n, id: noteId.current++ })) : [];
    const newIndex = chordsRef.current.length;
    setChords((prev) => [...prev, { id: nextChordId.current++, notes }]);
    setChordIndex(newIndex);
  };
  const onAddBlank = () => {
    const newIndex = chordsRef.current.length;
    setChords((prev) => [...prev, { id: nextChordId.current++, notes: [] }]);
    setChordIndex(newIndex);
  };
  const onDeleteChord = (i: number) => {
    const len = chordsRef.current.length;
    if (len <= 1) return;
    const clamp = (n: number) => Math.min(Math.max(0, n), len - 2);
    setChords((prev) => prev.filter((_, idx) => idx !== i));
    setChordIndex((ci) => clamp(ci === i ? i - 1 : ci > i ? ci - 1 : ci));
    setPlayhead((ph) => clamp(ph === i ? i - 1 : ph > i ? ph - 1 : ph));
  };

  // ---- auto-play loop ----
  useEffect(() => {
    if (!live || !playing) return;
    const tick = () => {
      const list = chordsRef.current;
      if (list.length === 0) return;
      const next = (playheadRef.current + 1) % list.length;
      playheadRef.current = next;
      setPlayhead(next);
      const chord = list[next];
      for (const n of chord.notes) pluck(n.freq);
      if (next === chordIndexRef.current && chord.notes.length > 0) {
        strumPulse.value = 0;
        strumPulse.value = withSequence(
          withTiming(1, { duration: 110, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 520, easing: Easing.inOut(Easing.quad) })
        );
      }
    };
    const id = setInterval(tick, slotMs);
    return () => clearInterval(id);
  }, [live, playing, slotMs, strumPulse]);

  useEffect(() => {
    if (!live) hideRadial();
  }, [live]);

  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => {
      if (!live) return;
      centerX.value = e.x;
      centerY.value = e.y;
      selected.value = -1;
      moved.value = 0;
      runOnJS(onDown)(e.x, e.y);
    })
    .onUpdate((e) => {
      const dx = e.x - centerX.value;
      const dy = e.y - centerY.value;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 12) moved.value = 1;
      if (dist < DEADZONE) {
        selected.value = -1;
        return;
      }
      const ang = Math.atan2(dy, dx);
      let best = -1;
      let bestDiff = 10;
      for (let i = 0; i < N; i++) {
        if (disabledMask.value & (1 << i)) continue;
        const theta = Math.PI / 2 + (i * 2 * Math.PI) / N;
        let d = ang - theta;
        d = Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
        if (d < bestDiff) {
          bestDiff = d;
          best = i;
        }
      }
      selected.value = best;
    })
    .onFinalize(() => {
      runOnJS(onEndJS)(moved.value, selected.value);
      selected.value = -1;
      moved.value = 0;
    });

  // octave squares (within the canvas area, above the bar)
  const TOP_CLEAR = 112;
  const BOTTOM_CLEAR = 24;
  const gap = 8;
  const band = canvasH - TOP_CLEAR - BOTTOM_CLEAR;
  const side = Math.max(40, Math.min((band - gap) / 2, width - 48));
  const sqX = (width - side) / 2;
  const startY = TOP_CLEAR + Math.max(0, (band - (side * 2 + gap)) / 2);
  const topSq = { x: sqX, y: startY };
  const botSq = { x: sqX, y: startY + side + gap };
  octaveBoundaryRef.current = startY + side + gap / 2;
  layoutRef.current = { sqX, side, topY: topSq.y, botY: botSq.y };

  const octaveSquares = (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Rect x={topSq.x} y={topSq.y} width={side} height={side} color="rgba(255,255,255,0.28)" style="stroke" strokeWidth={2}>
        <DashPathEffect intervals={[3, 4]} />
      </Rect>
      <Rect x={botSq.x} y={botSq.y} width={side} height={side} color="rgba(255,255,255,0.28)" style="stroke" strokeWidth={2}>
        <DashPathEffect intervals={[3, 4]} />
      </Rect>
    </Canvas>
  );

  return (
    <View style={styles.fill}>
      {mode === 'tap' ? (
        <View style={[StyleSheet.absoluteFill, { bottom: BAR_AREA }]}>
          {octaveSquares}

          {/* Warm waiting cells for lanes that aren't on yet. */}
          {cells.map((cell) => {
            const on = activeNotes.some(
              (n) => n.degree === cell.degree && n.octave === cell.octave
            );
            if (on) return null;
            const r = laneRect(cell.degree, cell.octave);
            return (
              <View
                key={`cell-${cell.octave}-${cell.degree}`}
                pointerEvents="none"
                style={[styles.cellWarm, { left: r.x, top: r.y + 2, width: r.w, height: r.h - 4 }]}
              >
                <Text style={styles.cellWarmLabel}>{cell.label}</Text>
              </View>
            );
          })}

          {/* On lanes render as the bright bar (with strum pulse). */}
          {activeNotes.map((n) => (
            <NoteBar key={n.id} rect={rectFor(n)} label={n.label} strumPulse={strumPulse} />
          ))}

          {/* Transparent tap targets over every lane. */}
          {cells.map((cell) => {
            const r = laneRect(cell.degree, cell.octave);
            return (
              <Pressable
                key={`tap-${cell.octave}-${cell.degree}`}
                onPress={() => toggleCell(cell)}
                style={[styles.cellTap, { left: r.x, top: r.y, width: r.w, height: r.h }]}
              />
            );
          })}
        </View>
      ) : (
        <GestureDetector gesture={pan}>
          <View style={[StyleSheet.absoluteFill, { bottom: BAR_AREA }]}>
            {octaveSquares}

            {activeNotes.map((n) => (
              <NoteBar key={n.id} rect={rectFor(n)} label={n.label} strumPulse={strumPulse} />
            ))}

            {radial ? (
              <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                {radial.notes.map((n, i) => {
                  const theta = angleFor(i);
                  return (
                    <RingNote
                      key={i}
                      index={i}
                      x={radial.cx + RADIAL_RADIUS * Math.cos(theta) - RADIAL_NOTE_R}
                      y={radial.cy + RADIAL_RADIUS * Math.sin(theta) - RADIAL_NOTE_R}
                      label={n.label}
                      disabled={radial.disabled[i]}
                      selected={selected}
                    />
                  );
                })}
              </View>
            ) : null}
          </View>
        </GestureDetector>
      )}

      <ChordsBar
        chords={chords}
        chordIndex={chordIndex}
        playhead={playhead}
        bottomInset={insets.bottom}
        onSelect={onSelectChord}
        onAddCopy={onAddCopy}
        onAddBlank={onAddBlank}
        onDelete={onDeleteChord}
      />

      <Pressable
        onPress={() => setPlaying((p) => !p)}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={playing ? 'Pause' : 'Play'}
        style={[styles.playBtn, { bottom: insets.bottom + 6 }]}
      >
        {playing ? (
          <View style={styles.pauseIcon}>
            <View style={styles.pauseBar} />
            <View style={styles.pauseBar} />
          </View>
        ) : (
          <View style={styles.playTri} />
        )}
      </Pressable>
    </View>
  );
}

function RingNote({
  index,
  x,
  y,
  label,
  disabled,
  selected,
}: {
  index: number;
  x: number;
  y: number;
  label: string;
  disabled: boolean;
  selected: SharedValue<number>;
}) {
  const aStyle = useAnimatedStyle(() => {
    const on = !disabled && selected.value === index;
    return {
      transform: [{ scale: withTiming(on ? 1.3 : 1, { duration: 90 }) }],
      backgroundColor: on ? '#5b8cff' : 'rgba(18,18,18,0.9)',
      borderColor: on ? '#ffffff' : 'rgba(255,255,255,0.3)',
      opacity: disabled ? 0.28 : 1,
    };
  });
  return (
    <Animated.View style={[styles.ringNote, { left: x, top: y }, aStyle]}>
      <Text style={styles.ringLabel}>{label}</Text>
    </Animated.View>
  );
}

function NoteBar({
  rect,
  label,
  strumPulse,
}: {
  rect: { x: number; y: number; w: number; h: number };
  label: string;
  strumPulse: SharedValue<number>;
}) {
  const enter = useSharedValue(0);
  useEffect(() => {
    enter.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.cubic) });
  }, [enter]);
  const style = useAnimatedStyle(() => ({
    opacity: enter.value,
    backgroundColor: interpolateColor(strumPulse.value, [0, 1], ['#39477e', '#5b8cff']),
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.noteBar,
        { left: rect.x, top: rect.y + 2, width: rect.w, height: rect.h - 4 },
        style,
      ]}
    >
      <Text style={styles.noteBarLabel}>{label}</Text>
    </Animated.View>
  );
}

function ChordsBar({
  chords,
  chordIndex,
  playhead,
  bottomInset,
  onSelect,
  onAddCopy,
  onAddBlank,
  onDelete,
}: {
  chords: Chord[];
  chordIndex: number;
  playhead: number;
  bottomInset: number;
  onSelect: (i: number) => void;
  onAddCopy: () => void;
  onAddBlank: () => void;
  onDelete: (i: number) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteIdx, setDeleteIdx] = useState<number | null>(null);

  return (
    <View style={[styles.bar, { paddingBottom: bottomInset + 6 }]} pointerEvents="box-none">
      {menuOpen ? (
        <View style={styles.menu}>
          <Pressable
            style={styles.menuItem}
            onPress={() => {
              setMenuOpen(false);
              onAddCopy();
            }}
          >
            <Text style={styles.menuText}>Copy current</Text>
          </Pressable>
          <View style={styles.menuDivider} />
          <Pressable
            style={styles.menuItem}
            onPress={() => {
              setMenuOpen(false);
              onAddBlank();
            }}
          >
            <Text style={styles.menuText}>Blank</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.barRow}>
        {chords.map((c, i) => (
          <Dot
            key={c.id}
            hasNotes={c.notes.length > 0}
            selected={i === chordIndex}
            playing={i === playhead}
            showDelete={deleteIdx === i && chords.length > 1}
            onPress={() => {
              setDeleteIdx(null);
              setMenuOpen(false);
              onSelect(i);
            }}
            onLongPress={() => setDeleteIdx(i)}
            onDelete={() => {
              setDeleteIdx(null);
              onDelete(i);
            }}
          />
        ))}
        <Pressable
          style={styles.plus}
          hitSlop={6}
          onPress={() => {
            setDeleteIdx(null);
            setMenuOpen((o) => !o);
          }}
        >
          <Text style={styles.plusText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Dot({
  hasNotes,
  selected,
  playing,
  showDelete,
  onPress,
  onLongPress,
  onDelete,
}: {
  hasNotes: boolean;
  selected: boolean;
  playing: boolean;
  showDelete: boolean;
  onPress: () => void;
  onLongPress: () => void;
  onDelete: () => void;
}) {
  return (
    <View style={styles.dotWrap}>
      {showDelete ? (
        <Pressable style={styles.del} hitSlop={8} onPress={onDelete}>
          <Text style={styles.delText}>×</Text>
        </Pressable>
      ) : null}
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={300}
        hitSlop={8}
        style={[
          styles.dot,
          hasNotes && styles.dotFilled,
          playing && styles.dotPlaying,
          selected && styles.dotSelected,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  ringNote: {
    position: 'absolute',
    width: RADIAL_NOTE_R * 2,
    height: RADIAL_NOTE_R * 2,
    borderRadius: RADIAL_NOTE_R,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringLabel: { color: '#fff', fontSize: 12, fontWeight: '600' },
  noteBar: {
    position: 'absolute',
    borderRadius: 5,
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  noteBarLabel: { color: '#fff', fontSize: 15, fontWeight: '700' },
  cellWarm: {
    position: 'absolute',
    borderRadius: 5,
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255,148,74,0.12)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,170,90,0.55)',
  },
  cellWarmLabel: { color: '#ffcaa0', fontSize: 15, fontWeight: '700' },
  cellTap: { position: 'absolute' },

  playBtn: {
    position: 'absolute',
    left: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(22,22,22,0.94)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  pauseIcon: { flexDirection: 'row', gap: 5 },
  pauseBar: { width: 4, height: 15, borderRadius: 1.5, backgroundColor: '#fff' },
  playTri: {
    width: 0,
    height: 0,
    marginLeft: 3,
    borderTopWidth: 8,
    borderBottomWidth: 8,
    borderLeftWidth: 13,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: '#fff',
  },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', paddingTop: 8 },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 18,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(22,22,22,0.94)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  dotWrap: { alignItems: 'center', justifyContent: 'center' },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.45)',
    backgroundColor: 'transparent',
  },
  dotFilled: { backgroundColor: 'rgba(255,255,255,0.5)' },
  dotPlaying: { backgroundColor: '#7af0d4', borderColor: '#7af0d4' },
  dotSelected: { borderColor: '#fff', borderWidth: 2.5, transform: [{ scale: 1.25 }] },
  del: {
    position: 'absolute',
    top: -28,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#cc3b3b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  delText: { color: '#fff', fontSize: 15, fontWeight: '700', marginTop: -2 },
  plus: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  plusText: { color: '#fff', fontSize: 24, fontWeight: '300', marginTop: -2 },
  menu: {
    marginBottom: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(28,28,28,0.98)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
    overflow: 'hidden',
    minWidth: 150,
  },
  menuItem: { paddingVertical: 12, paddingHorizontal: 16 },
  menuText: { color: '#fff', fontSize: 15, fontWeight: '500' },
  menuDivider: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.12)' },
});
