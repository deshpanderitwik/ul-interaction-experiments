import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useExperimentActive } from '../_host';
import { getScale, ladderNotes } from '../scale';
import {
  DEADZONE,
  LIFE_MS,
  N,
  POP_R,
  RADIAL_NOTE_R,
  RADIAL_RADIUS,
  STRUM_MS,
  pluck,
} from './shared';

// Note Radial — press & hold to summon a ring of the current scale's 7 notes
// around your finger; drag toward one and release to pop it onto the screen. A
// popped note stays ~3.5s, pulsing. While notes are alive a clock strums them
// together so they ring as a chord (the pluck synth decays); each strum pulses
// every note in unison.

type NoteData = { freq: number; label: string };
type RadialState = { cx: number; cy: number; notes: NoteData[] };
type ActiveNote = { id: number; x: number; y: number; label: string; freq: number };

function angleFor(i: number): number {
  return -Math.PI / 2 + (i * 2 * Math.PI) / N; // start at top, clockwise
}

export default function NoteRadial() {
  const live = useExperimentActive();
  const [radial, setRadial] = useState<RadialState | null>(null);
  const [notes, setNotes] = useState<ActiveNote[]>([]);
  const radialRef = useRef<RadialState | null>(null);
  const notesRef = useRef<ActiveNote[]>(notes);
  notesRef.current = notes;
  const popId = useRef(0);

  const centerX = useSharedValue(0);
  const centerY = useSharedValue(0);
  const selected = useSharedValue(-1);
  // Pulses 0→1→0 on every chord strum; active notes scale-pulse on it.
  const strumPulse = useSharedValue(0);

  const showRadial = (x: number, y: number) => {
    const scale = getScale();
    const ring = ladderNotes(scale, 48 + scale.root).slice(0, N); // 7 degrees
    const state = { cx: x, cy: y, notes: ring };
    radialRef.current = state;
    setRadial(state);
  };
  const hideRadial = () => {
    radialRef.current = null;
    setRadial(null);
  };
  const popNote = (idx: number) => {
    const r = radialRef.current;
    if (!r || idx < 0 || idx >= r.notes.length) return;
    const note = r.notes[idx];
    const theta = angleFor(idx);
    const x = r.cx + RADIAL_RADIUS * Math.cos(theta);
    const y = r.cy + RADIAL_RADIUS * Math.sin(theta);
    const id = popId.current++;
    pluck(note.freq); // strike immediately for responsiveness
    setNotes((prev) => [...prev, { id, x, y, label: note.label, freq: note.freq }]);
    setTimeout(() => setNotes((prev) => prev.filter((n) => n.id !== id)), LIFE_MS);
  };

  // Chord engine: while any note is alive, strum them all together on a clock so
  // the chord keeps ringing, pulsing every note in unison.
  const hasNotes = notes.length > 0;
  useEffect(() => {
    if (!live || !hasNotes) return;
    const strum = () => {
      for (const n of notesRef.current) pluck(n.freq);
      strumPulse.value = 0;
      strumPulse.value = withSequence(
        withTiming(1, { duration: 110, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: STRUM_MS - 110, easing: Easing.inOut(Easing.quad) })
      );
    };
    const id = setInterval(strum, STRUM_MS);
    return () => clearInterval(id);
  }, [live, hasNotes, strumPulse]);

  useEffect(() => {
    if (!live) {
      hideRadial();
      setNotes([]);
    }
  }, [live]);

  const gesture = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => {
      if (!live) return;
      centerX.value = e.x;
      centerY.value = e.y;
      selected.value = -1;
      runOnJS(showRadial)(e.x, e.y); // appear immediately on press
    })
    .onUpdate((e) => {
      const dx = e.x - centerX.value;
      const dy = e.y - centerY.value;
      if (Math.sqrt(dx * dx + dy * dy) < DEADZONE) {
        selected.value = -1;
        return;
      }
      const ang = Math.atan2(dy, dx);
      let best = 0;
      let bestDiff = 10;
      for (let i = 0; i < N; i++) {
        const theta = -Math.PI / 2 + (i * 2 * Math.PI) / N;
        let d = ang - theta;
        d = Math.abs(Math.atan2(Math.sin(d), Math.cos(d))); // smallest angular gap
        if (d < bestDiff) {
          bestDiff = d;
          best = i;
        }
      }
      selected.value = best;
    })
    .onEnd(() => {
      if (selected.value >= 0) runOnJS(popNote)(selected.value);
    })
    .onFinalize(() => {
      selected.value = -1;
      runOnJS(hideRadial)();
    });

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.fill}>
        {notes.map((n) => (
          <ActiveNoteView key={n.id} note={n} strumPulse={strumPulse} />
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
                  selected={selected}
                />
              );
            })}
          </View>
        ) : null}

        <Text style={styles.hint}>press &amp; hold, drag to a note</Text>
      </View>
    </GestureDetector>
  );
}

function RingNote({
  index,
  x,
  y,
  label,
  selected,
}: {
  index: number;
  x: number;
  y: number;
  label: string;
  selected: SharedValue<number>;
}) {
  const aStyle = useAnimatedStyle(() => {
    const on = selected.value === index;
    return {
      transform: [{ scale: withTiming(on ? 1.3 : 1, { duration: 90 }) }],
      backgroundColor: on ? '#5b8cff' : 'rgba(18,18,18,0.9)',
      borderColor: on ? '#ffffff' : 'rgba(255,255,255,0.3)',
    };
  });
  return (
    <Animated.View style={[styles.ringNote, { left: x, top: y }, aStyle]}>
      <Text style={styles.ringLabel}>{label}</Text>
    </Animated.View>
  );
}

function ActiveNoteView({
  note,
  strumPulse,
}: {
  note: ActiveNote;
  strumPulse: SharedValue<number>;
}) {
  const life = useSharedValue(0);
  useEffect(() => {
    life.value = withTiming(1, { duration: LIFE_MS, easing: Easing.linear });
  }, [life]);
  const style = useAnimatedStyle(() => {
    const entrance = interpolate(life.value, [0, 0.05, 1], [0.3, 1, 1]);
    const scale = entrance * (1 + strumPulse.value * 0.18);
    const opacity = interpolate(life.value, [0, 0.8, 1], [1, 1, 0]);
    return { transform: [{ scale }], opacity };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.note, { left: note.x - POP_R, top: note.y - POP_R }, style]}
    >
      <Text style={styles.noteLabel}>{note.label}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  hint: { color: 'rgba(255,255,255,0.3)', fontSize: 16, letterSpacing: 1 },
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
  note: {
    position: 'absolute',
    width: POP_R * 2,
    height: POP_R * 2,
    borderRadius: POP_R,
    backgroundColor: '#5b8cff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  noteLabel: { color: '#fff', fontSize: 18, fontWeight: '700' },
});
