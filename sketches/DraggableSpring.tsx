import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import type { Sketch } from './types';

function DraggableSpring() {
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const pressed = useSharedValue(0);

  const pan = Gesture.Pan()
    .onBegin(() => {
      pressed.value = withSpring(1);
    })
    .onChange((e) => {
      x.value += e.changeX;
      y.value += e.changeY;
    })
    .onFinalize(() => {
      // spring back to center — the whole point is to *feel* the physics
      x.value = withSpring(0, { damping: 12, stiffness: 120 });
      y.value = withSpring(0, { damping: 12, stiffness: 120 });
      pressed.value = withSpring(0);
    });

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value },
      { translateY: y.value },
      { scale: 1 + pressed.value * 0.15 },
    ],
  }));

  return (
    <View style={styles.fill}>
      <Text style={styles.hint}>Drag the card — it springs home</Text>
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.card, style]} />
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hint: { color: '#8a8a99', marginBottom: 48, fontSize: 15 },
  card: {
    width: 140,
    height: 180,
    borderRadius: 28,
    backgroundColor: '#6c5ce7',
    shadowColor: '#6c5ce7',
    shadowOpacity: 0.6,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
  },
});

const sketch: Sketch = {
  id: 'draggable-spring',
  title: 'Draggable spring',
  description: 'Pan gesture + Reanimated spring physics, on the UI thread.',
  order: 30,
  Component: DraggableSpring,
};

export default sketch;
