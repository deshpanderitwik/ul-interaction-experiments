import { Canvas, Path } from '@shopify/react-native-skia';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
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
import {
  NOTE_LABELS,
  buildNotes,
  distToSegment,
  intensityColor,
  type Note,
} from './shared';
import { playPluck } from './voice';

// NoteSketch — draw freehand white strokes on a field of "note" circles laid
// out as a vertical pitch ladder (F3 bottom → F4 top). A stroke passing through
// a note latches it active; intensity ramps with trigger order (oldest dim →
// newest bright). Active notes form an arpeggio that loops at 120 BPM in eighth
// notes: each step the current note pulses and a pluck fires. Double-tap clears.
//
// 120 BPM, eighth notes → quarter = 500ms, eighth = 250ms per step.
const STEP_MS = 250;
// Fraction of the step the pulse spends rising before it decays.
const PULSE_RISE_MS = 55;

export default function NoteSketch() {
  const live = useExperimentActive();
  const { width, height } = useWindowDimensions();

  const notes = useMemo(() => buildNotes(width, height), [width, height]);
  const notesRef = useRef(notes);
  notesRef.current = notes;

  const [paths, setPaths] = useState<string[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  // Ids in the order they were first triggered (newest last).
  const [order, setOrder] = useState<string[]>([]);

  const currentRef = useRef<string | null>(null);
  const lastPt = useRef<{ x: number; y: number } | null>(null);
  const orderRef = useRef(order);
  orderRef.current = order;

  // Arp playback (UI thread): which order-rank is sounding right now, and a
  // per-step envelope (0→1→0) the playing note animates its pulse on.
  const playingRank = useSharedValue(-1);
  const pulse = useSharedValue(0);

  // Latch any note whose circle the segment A→B passes through, appending newly
  // hit notes in trigger order (sorted by where they fall along the segment).
  const hitTest = (ax: number, ay: number, bx: number, by: number) => {
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const fresh: { id: string; at: number }[] = [];
    for (const note of notesRef.current) {
      if (distToSegment(note.cx, note.cy, ax, ay, bx, by) > note.r) continue;
      const at = len2
        ? Math.max(0, Math.min(1, ((note.cx - ax) * dx + (note.cy - ay) * dy) / len2))
        : 0;
      fresh.push({ id: note.id, at });
    }
    if (!fresh.length) return;
    fresh.sort((p, q) => p.at - q.at);
    setOrder((prev) => {
      const add = fresh.map((f) => f.id).filter((id) => !prev.includes(id));
      return add.length ? [...prev, ...add] : prev;
    });
  };

  const begin = (x: number, y: number) => {
    currentRef.current = `M ${x} ${y}`;
    lastPt.current = { x, y };
    setCurrent(currentRef.current);
    hitTest(x, y, x, y);
  };
  const extend = (x: number, y: number) => {
    if (!currentRef.current) return;
    const a = lastPt.current ?? { x, y };
    hitTest(a.x, a.y, x, y);
    currentRef.current = `${currentRef.current} L ${x} ${y}`;
    lastPt.current = { x, y };
    setCurrent(currentRef.current);
  };
  const commit = () => {
    const done = currentRef.current;
    currentRef.current = null;
    lastPt.current = null;
    setCurrent(null);
    if (done) setPaths((prev) => [...prev, done]);
  };
  const clear = () => {
    currentRef.current = null;
    lastPt.current = null;
    setCurrent(null);
    setPaths([]);
    setOrder([]);
  };

  // Arp sequencer: while live with ≥1 active note, step through the active notes
  // in trigger order on the 1/8-note clock. Reads orderRef so adding notes
  // mid-play extends the cycle without restarting the clock.
  const hasActive = order.length > 0;
  useEffect(() => {
    if (!live || !hasActive) {
      playingRank.value = -1;
      return;
    }
    let step = 0;
    const tick = () => {
      const seq = orderRef.current;
      const len = seq.length;
      if (len === 0) return;
      const rank = step % len;
      playingRank.value = rank;
      pulse.value = 0;
      pulse.value = withSequence(
        withTiming(1, { duration: PULSE_RISE_MS, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: STEP_MS - PULSE_RISE_MS, easing: Easing.out(Easing.quad) })
      );
      const id = seq[rank];
      const pitchT =
        NOTE_LABELS.length > 1
          ? (NOTE_LABELS as readonly string[]).indexOf(id) / (NOTE_LABELS.length - 1)
          : 0;
      playPluck(pitchT);
      step += 1;
    };
    tick(); // sound the first note immediately on (re)start
    const handle = setInterval(tick, STEP_MS);
    return () => {
      clearInterval(handle);
      playingRank.value = -1;
    };
  }, [live, hasActive, playingRank, pulse]);

  const draw = Gesture.Pan()
    .minDistance(2)
    .onStart((e) => {
      if (!live) return;
      runOnJS(begin)(e.x, e.y);
    })
    .onUpdate((e) => {
      runOnJS(extend)(e.x, e.y);
    })
    .onEnd(() => {
      runOnJS(commit)();
    });

  const clearTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(300)
    .onEnd(() => {
      if (!live) return;
      runOnJS(clear)();
    });

  const gesture = Gesture.Race(clearTap, draw);

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.fill}>
        <Canvas style={StyleSheet.absoluteFill}>
          {paths.map((p, idx) => (
            <Path
              key={idx}
              path={p}
              style="stroke"
              color="white"
              strokeWidth={2}
              strokeJoin="round"
              strokeCap="round"
            />
          ))}
          {current ? (
            <Path
              path={current}
              style="stroke"
              color="white"
              strokeWidth={2}
              strokeJoin="round"
              strokeCap="round"
            />
          ) : null}
        </Canvas>

        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {notes.map((n) => (
            <NoteCircle
              key={n.id}
              note={n}
              rank={order.indexOf(n.id)}
              total={order.length}
              playingRank={playingRank}
              pulse={pulse}
            />
          ))}
        </View>
      </View>
    </GestureDetector>
  );
}

// One note circle. Static look (outline when inactive; intensity fill by trigger
// rank when active); the pulse — scale + white flash on its turn in the arp — is
// driven on the UI thread off the shared playingRank/pulse values.
function NoteCircle({
  note,
  rank,
  total,
  playingRank,
  pulse,
}: {
  note: Note;
  rank: number;
  total: number;
  playingRank: SharedValue<number>;
  pulse: SharedValue<number>;
}) {
  const on = rank >= 0;
  // Intensity by trigger order: oldest → 0 (dim), newest → 1 (bright).
  const t = on ? (total > 1 ? rank / (total - 1) : 1) : 0;

  const scaleStyle = useAnimatedStyle(() => {
    const p = playingRank.value === rank ? pulse.value : 0;
    return { transform: [{ scale: 1 + p * 0.35 }] };
  });
  const flashStyle = useAnimatedStyle(() => {
    const p = playingRank.value === rank ? pulse.value : 0;
    return { opacity: p * 0.7 };
  });

  return (
    <Animated.View
      style={[
        styles.note,
        {
          left: note.cx - note.r,
          top: note.cy - note.r,
          width: note.r * 2,
          height: note.r * 2,
          borderRadius: note.r,
        },
        on
          ? {
              backgroundColor: intensityColor(t),
              borderColor: `rgba(255,255,255,${(0.45 + 0.55 * t).toFixed(3)})`,
            }
          : styles.noteOff,
        scaleStyle,
      ]}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { borderRadius: note.r, backgroundColor: '#fff' },
          flashStyle,
        ]}
      />
      <Text
        style={[
          styles.label,
          on ? (t > 0.55 ? styles.labelDark : styles.labelLight) : styles.labelOff,
        ]}
      >
        {note.label}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  note: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    overflow: 'hidden',
  },
  noteOff: {
    borderColor: 'rgba(255,255,255,0.35)',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  label: { fontSize: 15, fontWeight: '600', letterSpacing: 0.5 },
  labelOff: { color: 'rgba(255,255,255,0.55)' },
  labelLight: { color: 'rgba(255,255,255,0.9)' },
  labelDark: { color: '#0a0a0a' },
});
