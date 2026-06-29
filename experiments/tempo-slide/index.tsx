import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useExperimentActive } from '../_host';
import { arpFrequencies, noteName, scaleFrequencies, useScale, type Scale } from '../scale';
import { useSettings } from '../settings';
import { useTempo } from '../tempo';
import { ARP_COLORS, intervalForY, pluck } from './shared';

// Fastest (top of screen) and slowest (bottom) step intervals are adjustable.
const SETTINGS = {
  fastMs: {
    type: 'slider',
    label: 'Fastest (top)',
    min: 40,
    max: 300,
    step: 5,
    unit: 'ms',
    default: 90,
  },
  slowMs: {
    type: 'slider',
    label: 'Slowest (bottom)',
    min: 200,
    max: 1000,
    step: 10,
    unit: 'ms',
    default: 520,
  },
  quantize: {
    type: 'toggle',
    label: 'Quantize to grid',
    default: 0,
  },
} as const;

// Quantize grid. The global tempo defines the beat; the master clock ticks at
// the finest subdivision (beat / GRID_DIV), and a note fires every `mult` of
// those ticks. Sliding up picks a smaller mult = faster, but every note still
// lands on a grid line, so playback stays rhythmic. Ordered fast → slow.
const GRID_DIV = 8; // finest = a 32nd note (8 per beat)
const GRID_MULTS = [1, 2, 4, 8]; // 32nd, 16th, 8th, quarter

// Comet-tail trail that follows the finger. Each dot eases toward the finger
// with progressively more lag, so they spread out while moving and converge
// when still; hue shifts down the tail and the whole thing fades with touch.
const TRAIL_COUNT = 12;
const TRAIL_STOPS = ['#5b8cff', '#c64fff', '#2ee08a'];

// Diameter of a fully-expanded ripple ring.
const RIPPLE_D = 240;
// How many ripple views to cycle through. A fast arp can overlap several at
// once; reusing the oldest just restarts it (reads as a tighter pulse).
const RIPPLE_POOL = 8;

type Note = { freq: number; label: string };

// Root MIDI for the arp: scale root at octave 3 (F3 = 53).
function rootMidiFor(scale: Scale): number {
  return 48 + scale.root;
}
function freqLabel(freq: number): string {
  return noteName(Math.round(69 + 12 * Math.log2(freq / 440)));
}
// The four default arp slots (root/third/fifth/octave) as notes.
function defaultArp(scale: Scale): Note[] {
  return arpFrequencies(scale, rootMidiFor(scale)).map((freq) => ({ freq, label: freqLabel(freq) }));
}
// Selector pool: every scale note from the root up to two octaves above it.
function selectorNotes(scale: Scale): Note[] {
  const root = rootMidiFor(scale);
  return scaleFrequencies(scale, root, root + 24).map((freq) => ({ freq, label: freqLabel(freq) }));
}

// Tempo Slide — touch the screen to start a four-note arpeggio and slide
// vertically to scrub its tempo: up = faster, down = slower. The screen color
// stays put; each note sends a colored ripple out from the finger. The "Notes"
// bar opens a sheet where each of the four positions can be reassigned to any
// scale note up to two octaves above the root. Lift to stop.
//
// The arp is a self-rescheduling timer (setTimeout) that reads the current
// interval each tick, so tempo tracks the finger smoothly.
export default function TempoSlide() {
  const live = useExperimentActive();
  const { fastMs, slowMs, quantize } = useSettings(SETTINGS);
  const bpm = useTempo();
  const scale = useScale();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const BAR_AREA = 60 + insets.bottom;
  const canvasH = height - BAR_AREA;

  const heightRef = useRef(canvasH);
  heightRef.current = canvasH;
  const fastRef = useRef(fastMs);
  fastRef.current = fastMs;
  const slowRef = useRef(slowMs);
  slowRef.current = slowMs;
  const quantizeRef = useRef(quantize);
  quantizeRef.current = quantize;
  const bpmRef = useRef(bpm);
  bpmRef.current = bpm;

  // The editable arp. Re-seeds to the scale's default whenever the scale
  // changes, so edits don't carry an out-of-key note into a new scale.
  const scaleKey = `${scale.root}-${scale.type}`;
  const [arpNotes, setArpNotes] = useState<Note[]>(() => defaultArp(scale));
  const prevScaleKey = useRef(scaleKey);
  useEffect(() => {
    if (prevScaleKey.current !== scaleKey) {
      prevScaleKey.current = scaleKey;
      setArpNotes(defaultArp(scale));
    }
  }, [scaleKey, scale]);
  const arpNotesRef = useRef(arpNotes);
  arpNotesRef.current = arpNotes;

  const [sheetOpen, setSheetOpen] = useState(false);

  // UI-thread visuals: the hint text fade, and the live finger position + touch
  // envelope that drive the trail.
  const hint = useSharedValue(1);
  const fingerX = useSharedValue(0);
  const fingerY = useSharedValue(0);
  const touch = useSharedValue(0);

  // Sequencer state (JS thread).
  const intervalRef = useRef(250);
  const stepRef = useRef(0); // index into the arp (only advances when a note fires)
  const gridPosRef = useRef(0); // master-clock tick counter (quantize mode)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const posRef = useRef({ x: 0, y: 0 }); // last finger position
  const rippleRefs = useRef<(RippleHandle | null)[]>([]);
  const rippleCursor = useRef(0);

  // Ripple at the finger, colored by the given arp position.
  const fireRipple = (position: number, durationMs: number) => {
    const r = rippleRefs.current[rippleCursor.current % RIPPLE_POOL];
    rippleCursor.current += 1;
    r?.trigger(posRef.current.x, posRef.current.y, position, durationMs);
  };

  // Free-running mode: each note reschedules at the continuous interval-for-y.
  const tickFree = () => {
    const arp = arpNotesRef.current;
    const i = stepRef.current % arp.length;
    pluck(arp[i].freq);
    // Lifetime tracks tempo so fast runs stay crisp rather than smearing.
    fireRipple(i, Math.min(620, Math.max(280, intervalRef.current * 2.4)));
    stepRef.current += 1;
    timerRef.current = setTimeout(tickFree, intervalRef.current);
  };

  // Quantized mode: a steady master clock at the finest subdivision. The finger
  // height chooses how many master ticks per note (mult); notes only fire on
  // grid lines, so changing speed mid-slide stays phase-locked and rhythmic.
  const tickGrid = () => {
    const beat = 60000 / Math.max(1, bpmRef.current);
    const masterStep = beat / GRID_DIV;
    const h = heightRef.current;
    const t = h > 0 ? Math.max(0, Math.min(1, posRef.current.y / h)) : 0.5;
    const mult = GRID_MULTS[Math.min(GRID_MULTS.length - 1, Math.floor(t * GRID_MULTS.length))];
    if (gridPosRef.current % mult === 0) {
      const arp = arpNotesRef.current;
      const i = stepRef.current % arp.length;
      pluck(arp[i].freq);
      fireRipple(i, Math.min(620, Math.max(220, mult * masterStep)));
      stepRef.current += 1;
    }
    gridPosRef.current += 1;
    timerRef.current = setTimeout(tickGrid, masterStep);
  };

  const startArp = (x: number, y: number) => {
    posRef.current = { x, y };
    intervalRef.current = intervalForY(y, heightRef.current, fastRef.current, slowRef.current);
    stepRef.current = 0;
    gridPosRef.current = 0;
    if (timerRef.current) clearTimeout(timerRef.current);
    if (quantizeRef.current >= 1) tickGrid();
    else tickFree();
  };
  const moveArp = (x: number, y: number) => {
    posRef.current = { x, y };
    intervalRef.current = intervalForY(y, heightRef.current, fastRef.current, slowRef.current);
  };
  const stopArp = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  // Stop and reset when the experiment goes off-screen/backgrounded, and on
  // unmount, so the timer never outlives the screen.
  useEffect(() => {
    if (!live) {
      stopArp();
      hint.value = 1;
      touch.value = 0;
    }
    return stopArp;
  }, [live]);

  const pan = Gesture.Pan()
    .minDistance(0)
    .onStart((e) => {
      if (!live) return;
      hint.value = withTiming(0, { duration: 250 });
      fingerX.value = e.x;
      fingerY.value = e.y;
      touch.value = withTiming(1, { duration: 200 });
      runOnJS(startArp)(e.x, e.y);
    })
    .onUpdate((e) => {
      fingerX.value = e.x;
      fingerY.value = e.y;
      runOnJS(moveArp)(e.x, e.y);
    })
    .onFinalize(() => {
      hint.value = withTiming(1, { duration: 600 });
      touch.value = withTiming(0, { duration: 450 });
      runOnJS(stopArp)();
    });

  const hintStyle = useAnimatedStyle(() => ({ opacity: hint.value * 0.5 }));

  const pickNote = (position: number, note: Note) => {
    pluck(note.freq); // preview
    setArpNotes((prev) => prev.map((n, i) => (i === position ? note : n)));
  };

  return (
    <View style={styles.root}>
      <GestureDetector gesture={pan}>
        <View style={[styles.slideArea, { bottom: BAR_AREA }]}>
          {Array.from({ length: TRAIL_COUNT }).map((_, k) => {
            const index = TRAIL_COUNT - 1 - k; // render head last → on top
            return (
              <TrailDot
                key={index}
                index={index}
                fingerX={fingerX}
                fingerY={fingerY}
                touch={touch}
              />
            );
          })}
          {Array.from({ length: RIPPLE_POOL }).map((_, i) => (
            <Ripple
              key={i}
              ref={(h) => {
                rippleRefs.current[i] = h;
              }}
            />
          ))}
          <Animated.Text style={[styles.hint, hintStyle]}>
            touch & slide — up faster, down slower
          </Animated.Text>
        </View>
      </GestureDetector>

      <NotesButton bottomInset={insets.bottom} onPress={() => setSheetOpen(true)} />

      <NotesSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        notes={arpNotes}
        options={selectorNotes(scale)}
        onPick={pickNote}
        bottomInset={insets.bottom}
      />
    </View>
  );
}

function NotesButton({ bottomInset, onPress }: { bottomInset: number; onPress: () => void }) {
  return (
    <View style={[styles.bar, { paddingBottom: bottomInset + 6 }]} pointerEvents="box-none">
      <Pressable style={styles.notesBtn} hitSlop={8} onPress={onPress}>
        <Text style={styles.notesBtnText}>Notes</Text>
      </Pressable>
    </View>
  );
}

// Bottom sheet with two views: a 4-slot overview, and a per-slot vertical note
// selector that you reach by tapping a slot's note.
function NotesSheet({
  open,
  onClose,
  notes,
  options,
  onPick,
  bottomInset,
}: {
  open: boolean;
  onClose: () => void;
  notes: Note[];
  options: Note[];
  onPick: (position: number, note: Note) => void;
  bottomInset: number;
}) {
  const { height } = useWindowDimensions();
  const [editing, setEditing] = useState<number | null>(null);

  const ty = useSharedValue(height);
  const scrim = useSharedValue(0);
  useEffect(() => {
    ty.value = withTiming(open ? 0 : height, { duration: 240, easing: Easing.out(Easing.cubic) });
    scrim.value = withTiming(open ? 1 : 0, { duration: 240 });
    if (!open) setEditing(null);
  }, [open, height, ty, scrim]);

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: ty.value }] }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrim.value * 0.5 }));

  // High note at top, root at the bottom.
  const ladder = useMemo(() => [...options].reverse(), [options]);

  return (
    <View pointerEvents={open ? 'auto' : 'none'} style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>

      <Animated.View style={[styles.sheet, { paddingBottom: bottomInset + 12 }, sheetStyle]}>
        {editing == null ? (
          <>
            <Text style={styles.sheetTitle}>Notes</Text>
            <View style={styles.posRow}>
              {notes.map((n, i) => (
                <Pressable key={i} style={styles.posCell} onPress={() => setEditing(i)}>
                  <Text style={styles.posNum}>{i + 1}</Text>
                  <Text style={styles.posNote}>{n.label}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : (
          <>
            <View style={styles.selHeader}>
              <Pressable hitSlop={10} onPress={() => setEditing(null)}>
                <Text style={styles.backText}>‹ Back</Text>
              </Pressable>
              <Text style={styles.sheetTitle}>Position {editing + 1}</Text>
              <View style={styles.backSpacer} />
            </View>
            <ScrollView
              style={styles.selScroll}
              contentContainerStyle={styles.selContent}
              showsVerticalScrollIndicator={false}
            >
              {ladder.map((o) => {
                const on = o.label === notes[editing].label;
                return (
                  <Pressable
                    key={o.label}
                    style={[styles.noteRow, on && styles.noteRowOn]}
                    onPress={() => {
                      onPick(editing, o);
                      setEditing(null);
                    }}
                  >
                    <Text style={[styles.noteRowText, on && styles.noteRowTextOn]}>{o.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </>
        )}
      </Animated.View>
    </View>
  );
}

// One dot of the comet tail. Eases toward the finger with a lag that grows with
// its index, so later dots trail further behind; fades with the touch envelope.
function TrailDot({
  index,
  fingerX,
  fingerY,
  touch,
}: {
  index: number;
  fingerX: SharedValue<number>;
  fingerY: SharedValue<number>;
  touch: SharedValue<number>;
}) {
  const frac = 1 - index / TRAIL_COUNT; // 1 at the head → ~0 at the tail
  const lag = 55 + index * 40; // ms of easing toward the finger
  const size = 10 + frac * 30;
  const ct = index / Math.max(1, TRAIL_COUNT - 1);

  const x = useDerivedValue(() => withTiming(fingerX.value, { duration: lag }));
  const y = useDerivedValue(() => withTiming(fingerY.value, { duration: lag }));

  const style = useAnimatedStyle(() => ({
    left: x.value - size / 2,
    top: y.value - size / 2,
    opacity: touch.value * frac * 0.5,
    backgroundColor: interpolateColor(ct, [0, 0.5, 1], TRAIL_STOPS),
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.trailDot, { width: size, height: size, borderRadius: size / 2 }, style]}
    />
  );
}

type RippleHandle = {
  trigger: (x: number, y: number, colorIndex: number, durationMs: number) => void;
};

// One reusable ripple: a colored ring that springs out from a point and fades.
// Driven imperatively so the JS-thread sequencer can fire it on each note.
const Ripple = forwardRef<RippleHandle>(function Ripple(_, ref) {
  const p = useSharedValue(0); // 0 → 1 over the ripple's life
  const cx = useSharedValue(0);
  const cy = useSharedValue(0);
  const colorIdx = useSharedValue(0);

  useImperativeHandle(
    ref,
    () => ({
      trigger(x, y, ci, durationMs) {
        cx.value = x;
        cy.value = y;
        colorIdx.value = ci;
        p.value = 0;
        p.value = withTiming(1, { duration: durationMs, easing: Easing.out(Easing.quad) });
      },
    }),
    [cx, cy, colorIdx, p]
  );

  const style = useAnimatedStyle(() => ({
    left: cx.value - RIPPLE_D / 2,
    top: cy.value - RIPPLE_D / 2,
    opacity: (1 - p.value) * (p.value > 0 ? 1 : 0), // invisible until first fired
    transform: [{ scale: 0.12 + p.value * 0.88 }],
    borderColor: interpolateColor(colorIdx.value, [0, 1, 2, 3], ARP_COLORS),
  }));

  return <Animated.View pointerEvents="none" style={[styles.ripple, style]} />;
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  slideArea: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ripple: {
    position: 'absolute',
    width: RIPPLE_D,
    height: RIPPLE_D,
    borderRadius: RIPPLE_D / 2,
    borderWidth: 6,
  },
  hint: { color: '#fff', fontSize: 16, letterSpacing: 1 },
  trailDot: { position: 'absolute' },

  // Bottom "Notes" bar.
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    paddingTop: 8,
  },
  notesBtn: {
    paddingHorizontal: 22,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(22,22,22,0.94)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  notesBtnText: { color: '#fff', fontSize: 15, fontWeight: '600', letterSpacing: 0.5 },

  // Bottom sheet.
  scrim: { backgroundColor: '#000' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '64%',
    backgroundColor: '#141414',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingTop: 18,
    paddingHorizontal: 18,
  },
  sheetTitle: { color: '#fff', fontSize: 18, fontWeight: '700', textAlign: 'center' },
  posRow: { flexDirection: 'row', gap: 10, marginTop: 18 },
  posCell: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: '#1c1c1c',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  posNum: { color: '#888', fontSize: 13, fontWeight: '600', marginBottom: 6 },
  posNote: { color: '#fff', fontSize: 18, fontWeight: '700' },
  selHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  backText: { color: '#5b8cff', fontSize: 16, fontWeight: '600' },
  backSpacer: { width: 48 },
  selScroll: { marginTop: 4 },
  selContent: { paddingBottom: 8 },
  noteRow: {
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginBottom: 6,
    backgroundColor: '#1c1c1c',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  noteRowOn: { backgroundColor: '#5b8cff', borderColor: '#5b8cff' },
  noteRowText: { color: '#ddd', fontSize: 16, fontWeight: '600', textAlign: 'center' },
  noteRowTextOn: { color: '#fff', fontWeight: '700' },
});
