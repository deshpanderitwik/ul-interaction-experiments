import * as Haptics from 'expo-haptics';
import { useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
  runOnJS,
} from 'react-native-reanimated';
import type { Sketch } from './types';

// Drag horizontally to add/remove columns, vertically to add/remove rows.
// One STEP of travel along an axis changes that axis's count by one.
const STEP = 55; // px of drag per column/row change
const MIN = 1;
const MAX = 10;

const clamp = (n: number) => Math.max(MIN, Math.min(MAX, n));

// vivid diagonal rainbow so the grid reads as distinct cells on the dark shell
function cellColor(r: number, c: number, rows: number, cols: number) {
  const t = ((c + 0.5) / cols + (r + 0.5) / rows) / 2; // 0..1 across the diagonal
  const hue = (200 + t * 320) % 360;
  return `hsl(${hue}, 72%, 56%)`;
}

function GridSplit() {
  const [cols, setCols] = useState(3);
  const [rows, setRows] = useState(4);
  const insets = useSafeAreaInsets();

  // Refs mirror state so the (stable) gesture callbacks always see fresh values.
  const colsRef = useRef(cols);
  const rowsRef = useRef(rows);
  colsRef.current = cols;
  rowsRef.current = rows;
  // counts captured when a drag begins; the drag is measured relative to these
  const startCols = useRef(cols);
  const startRows = useRef(rows);

  const onStart = () => {
    startCols.current = colsRef.current;
    startRows.current = rowsRef.current;
  };

  const onMove = (tx: number, ty: number) => {
    const nc = clamp(startCols.current + Math.round(tx / STEP)); // right → more cols
    const nr = clamp(startRows.current + Math.round(ty / STEP)); // down  → more rows
    if (nc !== colsRef.current) {
      setCols(nc);
      Haptics.selectionAsync().catch(() => {});
    }
    if (nr !== rowsRef.current) {
      setRows(nr);
      Haptics.selectionAsync().catch(() => {});
    }
  };

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .onBegin(() => runOnJS(onStart)())
        .onUpdate((e) => runOnJS(onMove)(e.translationX, e.translationY)),
    [],
  );

  // flat list of every cell; flex-wrap + percentage sizing lays them into the
  // grid, and reanimated's layout transition animates the resize as counts change
  const cells = useMemo(() => {
    const out: { r: number; c: number }[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push({ r, c });
    return out;
  }, [rows, cols]);

  return (
    <View style={styles.fill}>
      <GestureDetector gesture={pan}>
        <View style={styles.grid}>
          {cells.map(({ r, c }) => (
            <Animated.View
              key={`${r}-${c}`}
              entering={FadeIn.duration(180)}
              exiting={FadeOut.duration(140)}
              layout={LinearTransition.springify().damping(20).stiffness(170)}
              style={{ width: `${100 / cols}%`, height: `${100 / rows}%`, padding: 3 }}
            >
              <View style={[styles.cellFill, { backgroundColor: cellColor(r, c, rows, cols) }]} />
            </Animated.View>
          ))}
        </View>
      </GestureDetector>

      <View style={[styles.readout, { top: insets.top + 14 }]} pointerEvents="none">
        <Text style={styles.readoutText}>
          {cols} <Text style={styles.readoutDim}>×</Text> {rows}
        </Text>
      </View>

      <Text style={[styles.hint, { bottom: insets.bottom + 22 }]} pointerEvents="none">
        Drag — sideways for columns, up/down for rows
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#0b0b0f' },
  grid: { flex: 1, flexDirection: 'row', flexWrap: 'wrap' },
  cellFill: { flex: 1, borderRadius: 10 },
  readout: {
    position: 'absolute',
    alignSelf: 'center',
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  readoutText: { color: '#fff', fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
  readoutDim: { color: '#8a8a99' },
  hint: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    color: 'rgba(255,255,255,0.55)',
    fontSize: 13,
  },
});

const sketch: Sketch = {
  id: 'grid-split',
  title: 'Grid split',
  description: 'Drag to carve the screen into a grid — sideways changes columns, up/down changes rows.',
  order: 90,
  Component: GridSplit,
};

export default sketch;
