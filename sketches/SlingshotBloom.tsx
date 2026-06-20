import { Canvas, Circle, Fill } from '@shopify/react-native-skia';
import { useState } from 'react';
import { LayoutRectangle, StyleSheet, Text, View } from 'react-native';
import type { Sketch } from './types';

const BALL = 26; // ball radius

// Brick 0 — the stage. A full-bleed Skia canvas with a single resting ball,
// centered in whatever space the canvas actually gets. Everything else
// (aiming, flight, bounce, blooms) gets drawn onto this canvas in later bricks.
function SlingshotBloom() {
  const [box, setBox] = useState<LayoutRectangle | null>(null);

  return (
    <View style={styles.fill} onLayout={(e) => setBox(e.nativeEvent.layout)}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Fill color="#0b0b0f" />
        {box && (
          <Circle cx={box.width / 2} cy={box.height / 2} r={BALL} color="#e8e8f0" />
        )}
      </Canvas>
      <Text style={styles.hint}>Pull the ball back and release (coming next)</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  hint: {
    position: 'absolute',
    bottom: 32,
    left: 0,
    right: 0,
    textAlign: 'center',
    color: '#5a5a6b',
    fontSize: 14,
  },
});

const sketch: Sketch = {
  id: 'slingshot-bloom',
  title: 'Slingshot bloom',
  description: 'Pull, release, ricochet — rainbow shockwaves burst where it hits the walls.',
  Component: SlingshotBloom,
};

export default sketch;
