import { Canvas, Path } from '@shopify/react-native-skia';
import { useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { useExperimentActive } from '../_host';
import { buildNotes, distToSegment } from './shared';

// NoteSketch — draw freehand white strokes on a field of "note" circles laid
// out as a vertical pitch ladder (F3 bottom → F4 top). When the stroke you're
// drawing passes through a note it latches active; double-tap clears strokes
// and resets every note. (Activation is the signal we'll wire to sound next.)
export default function NoteSketch() {
  const live = useExperimentActive();
  const { width, height } = useWindowDimensions();

  const notes = useMemo(() => buildNotes(width, height), [width, height]);
  const notesRef = useRef(notes);
  notesRef.current = notes;

  const [paths, setPaths] = useState<string[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [activeIds, setActiveIds] = useState<Set<string>>(() => new Set());

  const currentRef = useRef<string | null>(null);
  const lastPt = useRef<{ x: number; y: number } | null>(null);

  // Latch any note whose circle the segment A→B passes through.
  const hitTest = (ax: number, ay: number, bx: number, by: number) => {
    let hits: string[] | null = null;
    for (const note of notesRef.current) {
      if (distToSegment(note.cx, note.cy, ax, ay, bx, by) <= note.r) {
        (hits ??= []).push(note.id);
      }
    }
    if (!hits) return;
    setActiveIds((prev) => {
      let next: Set<string> | null = null;
      for (const id of hits!) if (!prev.has(id)) (next ??= new Set(prev)).add(id);
      return next ?? prev;
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
    setActiveIds(new Set());
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
            const on = activeIds.has(n.id);
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
                  on ? styles.noteOn : styles.noteOff,
                ]}
              >
                <Text style={[styles.label, on ? styles.labelOn : styles.labelOff]}>
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
  noteOn: {
    borderColor: '#ffffff',
    backgroundColor: '#cfd8ff',
  },
  label: { fontSize: 15, fontWeight: '600', letterSpacing: 0.5 },
  labelOff: { color: 'rgba(255,255,255,0.55)' },
  labelOn: { color: '#0a0a0a' },
});
