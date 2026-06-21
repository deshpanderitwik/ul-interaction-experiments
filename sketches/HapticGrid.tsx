import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import type { Sketch } from './types';

const COLS = 5;
const ROWS = 7;
const CELL = 56;
const GAP = 6;

function HapticGrid() {
  const [active, setActive] = useState<number | null>(null);

  // called on the JS thread whenever the finger crosses into a new cell
  const onEnterCell = (index: number) => {
    setActive(index);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const pan = Gesture.Pan()
    .onChange((e) => {
      const col = Math.floor(e.x / (CELL + GAP));
      const row = Math.floor(e.y / (CELL + GAP));
      if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return;
      const index = row * COLS + col;
      runOnJS(maybeEnter)(index);
    })
    .onFinalize(() => runOnJS(setActive)(null));

  // dedupe so we only fire haptics on a *new* cell, not every frame
  let last = -1;
  function maybeEnter(index: number) {
    if (index === last) return;
    last = index;
    onEnterCell(index);
  }

  return (
    <View style={styles.fill}>
      <Text style={styles.hint}>Drag across the grid — feel each cell</Text>
      <GestureDetector gesture={pan}>
        <View style={styles.grid}>
          {Array.from({ length: ROWS * COLS }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.cell,
                { marginRight: GAP, marginBottom: GAP },
                active === i && styles.cellActive,
              ]}
            />
          ))}
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hint: { color: '#8a8a99', marginBottom: 32, fontSize: 15 },
  grid: {
    width: COLS * (CELL + GAP),
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    width: CELL,
    height: CELL,
    borderRadius: 14,
    backgroundColor: '#1b1b26',
  },
  cellActive: {
    backgroundColor: '#00d2a8',
  },
});

const sketch: Sketch = {
  id: 'haptic-grid',
  title: 'Haptic grid',
  description: 'Drag-to-feel: fires a haptic tick each time you cross a cell.',
  order: 40,
  Component: HapticGrid,
};

export default sketch;
