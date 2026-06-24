import { Canvas, Path } from '@shopify/react-native-skia';
import { useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { useExperimentActive } from '../_host';

// NoteSketch — starting point: an empty black canvas you draw on with a finger.
// Each stroke is a 2px white freehand line; double-tap clears everything.
//
// Strokes are stored as SVG path strings ("M x y L x y L …"). Finished strokes
// live in `paths`; the in-progress one is `current` (a ref drives the appends so
// we never nest state updates). Drawing is a Pan gesture; clear is a 2-tap.
// Pan has a small minDistance so a stationary double-tap never starts a stroke.
export default function NoteSketch() {
  const active = useExperimentActive();
  const [paths, setPaths] = useState<string[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const currentRef = useRef<string | null>(null);

  const begin = (x: number, y: number) => {
    currentRef.current = `M ${x} ${y}`;
    setCurrent(currentRef.current);
  };
  const extend = (x: number, y: number) => {
    if (!currentRef.current) return;
    currentRef.current = `${currentRef.current} L ${x} ${y}`;
    setCurrent(currentRef.current);
  };
  const commit = () => {
    const done = currentRef.current;
    currentRef.current = null;
    setCurrent(null);
    if (done) setPaths((prev) => [...prev, done]);
  };
  const clear = () => {
    currentRef.current = null;
    setCurrent(null);
    setPaths([]);
  };

  const draw = Gesture.Pan()
    .minDistance(2)
    .onStart((e) => {
      if (!active) return;
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
      if (!active) return;
      runOnJS(clear)();
    });

  const gesture = Gesture.Race(clearTap, draw);

  return (
    <GestureDetector gesture={gesture}>
      <Canvas style={styles.fill}>
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
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
});
