import { Canvas, Path } from '@shopify/react-native-skia';
import { useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { useExperimentActive } from '../_host';
import { buildNotes, distToSegment, intensityColor } from './shared';

// NoteSketch — draw freehand white strokes on a field of "note" circles laid
// out as a vertical pitch ladder (F3 bottom → F4 top). When the stroke you're
// drawing passes through a note it latches active, and its color intensity
// ramps with trigger order (oldest dim → newest brightest). Double-tap clears
// strokes and resets every note. (Order is the signal we'll wire to sound.)
export default function NoteSketch() {
  const live = useExperimentActive();
  const { width, height } = useWindowDimensions();

  const notes = useMemo(() => buildNotes(width, height), [width, height]);
  const notesRef = useRef(notes);
  notesRef.current = notes;

  const [paths, setPaths] = useState<string[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  // Ids in the order they were first triggered (newest last). A note's color
  // intensity ramps with its position in this list.
  const [order, setOrder] = useState<string[]>([]);

  const currentRef = useRef<string | null>(null);
  const lastPt = useRef<{ x: number; y: number } | null>(null);

  // Latch any note whose circle the segment A→B passes through, appending newly
  // hit notes in trigger order (sorted by where they fall along the segment, so
  // a single fast swipe through several notes still records left-to-right).
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
          {notes.map((n) => {
            const rank = order.indexOf(n.id);
            const on = rank >= 0;
            // Intensity by trigger order: oldest → 0 (dim), newest → 1 (bright).
            const t = on ? (order.length > 1 ? rank / (order.length - 1) : 1) : 0;
            return (
              <View
                key={n.id}
                style={[
                  styles.note,
                  {
                    left: n.cx - n.r,
                    top: n.cy - n.r,
                    width: n.r * 2,
                    height: n.r * 2,
                    borderRadius: n.r,
                  },
                  on
                    ? {
                        backgroundColor: intensityColor(t),
                        borderColor: `rgba(255,255,255,${(0.45 + 0.55 * t).toFixed(3)})`,
                      }
                    : styles.noteOff,
                ]}
              >
                <Text
                  style={[
                    styles.label,
                    on
                      ? t > 0.55
                        ? styles.labelDark
                        : styles.labelLight
                      : styles.labelOff,
                  ]}
                >
                  {n.label}
                </Text>
              </View>
            );
          })}
        </View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  note: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
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
