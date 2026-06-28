import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useExperimentActive } from '../_host';
import { getScale, ladderNotes } from '../scale';
import { DEADZONE, N, POP_R, RADIAL_NOTE_R, RADIAL_RADIUS, pluck } from './shared';

// Note Radial — press & hold to summon a ring of the current scale's 7 notes
// around your finger; drag toward one and release to pop it onto the screen
// (and play it). The ring highlight tracks your finger on the UI thread; the
// pop is a quick scale-overshoot that lingers and fades.

type NoteData = { freq: number; label: string };
type RadialState = { cx: number; cy: number; notes: NoteData[] };
type PopData = { id: number; x: number; y: number; label: string };

function angleFor(i: number): number {
  return -Math.PI / 2 + (i * 2 * Math.PI) / N; // start at top, clockwise
}

export default function NoteRadial() {
  const live = useExperimentActive();
  const [radial, setRadial] = useState<RadialState | null>(null);
  const [pops, setPops] = useState<PopData[]>([]);
  const radialRef = useRef<RadialState | null>(null);
  const popId = useRef(0);

  const centerX = useSharedValue(0);
  const centerY = useSharedValue(0);
  const selected = useSharedValue(-1);

  const showRadial = (x: number, y: number) => {
    const scale = getScale();
    const notes = ladderNotes(scale, 48 + scale.root).slice(0, N); // 7 degrees
    const state = { cx: x, cy: y, notes };
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
    pluck(note.freq);
    const theta = angleFor(idx);
    const px = r.cx + RADIAL_RADIUS * Math.cos(theta);
    const py = r.cy + RADIAL_RADIUS * Math.sin(theta);
    const id = popId.current++;
    setPops((prev) => [...prev, { id, x: px, y: py, label: note.label }]);
    setTimeout(() => setPops((prev) => prev.filter((p) => p.id !== id)), 1600);
  };

  useEffect(() => {
    if (!live) {
      hideRadial();
      setPops([]);
    }
  }, [live]);

  const gesture = Gesture.Pan()
    .minDistance(0)
    .onStart((e) => {
      if (!live) return;
      centerX.value = e.x;
      centerY.value = e.y;
      selected.value = -1;
      runOnJS(showRadial)(e.x, e.y);
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

        {pops.map((p) => (
          <Pop key={p.id} pop={p} />
        ))}

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

function Pop({ pop }: { pop: PopData }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withTiming(1, { duration: 1500, easing: Easing.out(Easing.cubic) });
  }, [p]);
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(p.value, [0, 0.15, 0.28, 1], [0.2, 1.18, 1, 1]) }],
    opacity: interpolate(p.value, [0, 0.06, 0.7, 1], [0, 1, 1, 0]),
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.pop, { left: pop.x - POP_R, top: pop.y - POP_R }, style]}
    >
      <Text style={styles.popLabel}>{pop.label}</Text>
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
  pop: {
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
  popLabel: { color: '#fff', fontSize: 18, fontWeight: '700' },
});
