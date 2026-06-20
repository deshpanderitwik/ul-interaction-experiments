import * as Haptics from 'expo-haptics';
import { Accelerometer } from 'expo-sensors';
import { useEffect, useRef, useState } from 'react';
import { LayoutRectangle, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import type { Sketch } from './types';

const ORB = 56;
const RADIUS = ORB / 2;
const BOUNCE = 0.55; // energy kept on a wall hit
const FRICTION = 0.985; // gentle damping so it settles
const GAIN = 900; // accelerometer → pixels/sec² feel

// Roll a ball around the screen by tilting the phone. Pure JS: expo-sensors
// drives the physics, Reanimated paints it, and a wall hit fires a haptic
// scaled to impact speed — so harder bumps feel harder.
function TiltOrb() {
  const [box, setBox] = useState<LayoutRectangle | null>(null);
  const boxRef = useRef<LayoutRectangle | null>(null);
  boxRef.current = box;

  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const vx = useRef(0);
  const vy = useRef(0);
  const last = useRef(0);

  useEffect(() => {
    Accelerometer.setUpdateInterval(16);
    const sub = Accelerometer.addListener(({ x: ax, y: ay }) => {
      const b = boxRef.current;
      if (!b) return;

      const now = Date.now();
      const dt = last.current ? Math.min((now - last.current) / 1000, 0.05) : 0;
      last.current = now;
      if (!dt) return;

      // tilt right → +x, tilt away (top down) → +y
      vx.current = (vx.current + ax * GAIN * dt) * FRICTION;
      vy.current = (vy.current - ay * GAIN * dt) * FRICTION;

      let nx = x.value + vx.current * dt;
      let ny = y.value + vy.current * dt;

      const maxX = b.width / 2 - RADIUS;
      const maxY = b.height / 2 - RADIUS;

      let hit = 0;
      if (nx > maxX || nx < -maxX) {
        hit = Math.max(hit, Math.abs(vx.current));
        nx = Math.max(-maxX, Math.min(maxX, nx));
        vx.current = -vx.current * BOUNCE;
      }
      if (ny > maxY || ny < -maxY) {
        hit = Math.max(hit, Math.abs(vy.current));
        ny = Math.max(-maxY, Math.min(maxY, ny));
        vy.current = -vy.current * BOUNCE;
      }

      x.value = nx;
      y.value = ny;

      if (hit > 120) {
        const style =
          hit > 700
            ? Haptics.ImpactFeedbackStyle.Heavy
            : hit > 350
              ? Haptics.ImpactFeedbackStyle.Medium
              : Haptics.ImpactFeedbackStyle.Light;
        Haptics.impactAsync(style);
      }
    });
    return () => sub.remove();
  }, [x, y]);

  const orbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }],
  }));

  return (
    <View style={styles.fill}>
      <Text style={styles.hint}>Tilt the phone — roll the orb into the walls</Text>
      <View
        style={styles.arena}
        onLayout={(e) => setBox(e.nativeEvent.layout)}
      >
        <Animated.View style={[styles.orb, orbStyle]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  hint: { color: '#8a8a99', marginBottom: 24, fontSize: 14, textAlign: 'center' },
  arena: {
    width: 320,
    height: 460,
    borderRadius: 28,
    backgroundColor: '#15151d',
    borderWidth: 1,
    borderColor: '#26263a',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  orb: {
    width: ORB,
    height: ORB,
    borderRadius: RADIUS,
    backgroundColor: '#ff7675',
    shadowColor: '#ff7675',
    shadowOpacity: 0.6,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
});

const sketch: Sketch = {
  id: 'tilt-orb',
  title: 'Tilt orb',
  description: 'Accelerometer physics: tilt to roll a ball; wall hits haptic-scale with speed.',
  Component: TiltOrb,
};

export default sketch;
