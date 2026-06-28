import { Canvas, DashPathEffect, Rect } from '@shopify/react-native-skia';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
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
import { getScale, ladderNotes, noteName } from '../scale';
import { DEADZONE, N, POP_R, RADIAL_NOTE_R, RADIAL_RADIUS, STRUM_MS, pluck } from './shared';

// Note Radial — press & hold to summon a ring of the current scale's 7 notes
// around your finger; drag toward one and release to pop it onto the screen.
// Popped notes persist (double-tap to wipe them). While notes are present a
// clock strums them together so they ring as a chord (the pluck synth decays);
// each strum pulses every note in unison.

type NoteData = { freq: number; label: string };
type RadialState = { cx: number; cy: number; notes: NoteData[]; disabled: boolean[] };
type ActiveNote = { id: number; x: number; y: number; label: string; freq: number };

function angleFor(i: number): number {
  return -Math.PI / 2 + (i * 2 * Math.PI) / N; // start at top, clockwise
}

function freqLabel(freq: number): string {
  return noteName(Math.round(69 + 12 * Math.log2(freq / 440)));
}

export default function NoteRadial() {
  const live = useExperimentActive();
  const { width, height } = useWindowDimensions();
  const [radial, setRadial] = useState<RadialState | null>(null);
  const [notes, setNotes] = useState<ActiveNote[]>([]);
  const radialRef = useRef<RadialState | null>(null);
  const notesRef = useRef<ActiveNote[]>(notes);
  notesRef.current = notes;
  const popId = useRef(0);
  const pendingRemove = useRef<number | null>(null); // note tapped at touch-down
  const radialShownRef = useRef(false);
  const octaveBoundaryRef = useRef(height / 2); // y that splits low/high octave

  const centerX = useSharedValue(0);
  const centerY = useSharedValue(0);
  const selected = useSharedValue(-1);
  const moved = useSharedValue(0); // 1 once the finger leaves the tap zone
  const disabledMask = useSharedValue(0); // bit i set = ring note i already placed
  // Pulses 0→1→0 on every chord strum; active notes scale-pulse on it.
  const strumPulse = useSharedValue(0);

  const showRadial = (x: number, y: number) => {
    const scale = getScale();
    // Pressing above the split line (between the squares) raises the ring an octave.
    const octaveShift = y < octaveBoundaryRef.current ? 1 : 0;
    const ring = ladderNotes(scale, 48 + scale.root)
      .slice(0, N)
      .map((rn) => {
        const freq = rn.freq * Math.pow(2, octaveShift);
        return { freq, label: freqLabel(freq) };
      });
    // Disable ring notes already placed on screen (no duplicate pitches).
    const active = new Set(notesRef.current.map((n) => n.label));
    const disabled = ring.map((r) => active.has(r.label));
    let mask = 0;
    disabled.forEach((d, i) => {
      if (d) mask |= 1 << i;
    });
    disabledMask.value = mask;
    const state = { cx: x, cy: y, notes: ring, disabled };
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
    if (!r || idx < 0 || idx >= r.notes.length) return;
    if (r.disabled[idx]) return; // already placed — no duplicate
    const note = r.notes[idx];
    const theta = angleFor(idx);
    const x = r.cx + RADIAL_RADIUS * Math.cos(theta);
    const y = r.cy + RADIAL_RADIUS * Math.sin(theta);
    const id = popId.current++;
    pluck(note.freq); // strike immediately for responsiveness
    setNotes((prev) => [...prev, { id, x, y, label: note.label, freq: note.freq }]);
  };

  const removeNote = (id: number) => setNotes((prev) => prev.filter((n) => n.id !== id));

  // Touch-down: tapping an existing note arms it for removal (no radial);
  // pressing empty space summons the radial.
  const onDown = (x: number, y: number) => {
    const hit = [...notesRef.current].reverse().find((n) => Math.hypot(x - n.x, y - n.y) <= POP_R);
    if (hit) {
      pendingRemove.current = hit.id;
    } else {
      pendingRemove.current = null;
      showRadial(x, y);
    }
  };
  // Runs on finalize (which always fires, unlike onEnd which needs the Pan to
  // have activated — a stationary tap never activates it).
  const onEndJS = (movedFlag: number, sel: number) => {
    if (pendingRemove.current != null && !movedFlag) {
      removeNote(pendingRemove.current); // a tap on a note removes it
    } else if (radialShownRef.current && sel >= 0) {
      popNote(sel); // dragged to a ring note and released
    }
    pendingRemove.current = null;
    hideRadial();
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
        if (disabledMask.value & (1 << i)) continue; // skip placed notes
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
    .onFinalize(() => {
      runOnJS(onEndJS)(moved.value, selected.value);
      selected.value = -1;
      moved.value = 0;
    });

  const gesture = pan;

  // Two octave zones: dashed squares stacked with an 8px gap, kept clear of the
  // top controls (back / REC / gear).
  const TOP_CLEAR = 112;
  const BOTTOM_CLEAR = 44;
  const gap = 8;
  const band = height - TOP_CLEAR - BOTTOM_CLEAR;
  const side = Math.max(40, Math.min((band - gap) / 2, width - 48));
  const sqX = (width - side) / 2;
  const startY = TOP_CLEAR + Math.max(0, (band - (side * 2 + gap)) / 2);
  const topSq = { x: sqX, y: startY };
  const botSq = { x: sqX, y: startY + side + gap };
  octaveBoundaryRef.current = startY + side + gap / 2; // mid-gap = octave split

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.fill}>
        <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
          <Rect
            x={topSq.x}
            y={topSq.y}
            width={side}
            height={side}
            color="rgba(255,255,255,0.28)"
            style="stroke"
            strokeWidth={2}
          >
            <DashPathEffect intervals={[3, 4]} />
          </Rect>
          <Rect
            x={botSq.x}
            y={botSq.y}
            width={side}
            height={side}
            color="rgba(255,255,255,0.28)"
            style="stroke"
            strokeWidth={2}
          >
            <DashPathEffect intervals={[3, 4]} />
          </Rect>
        </Canvas>

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
                  disabled={radial.disabled[i]}
                  selected={selected}
                />
              );
            })}
          </View>
        ) : null}
      </View>
    </GestureDetector>
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

function ActiveNoteView({
  note,
  strumPulse,
}: {
  note: ActiveNote;
  strumPulse: SharedValue<number>;
}) {
  const enter = useSharedValue(0);
  useEffect(() => {
    enter.value = withTiming(1, { duration: 240, easing: Easing.out(Easing.back(1.6)) });
  }, [enter]);
  const style = useAnimatedStyle(() => {
    const scale = interpolate(enter.value, [0, 1], [0.3, 1]) * (1 + strumPulse.value * 0.18);
    return { transform: [{ scale }] };
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
