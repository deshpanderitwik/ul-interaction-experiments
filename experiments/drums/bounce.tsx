import { useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useExperimentActive } from '../_host';
import { playKick } from './voice';

// Drums · Bounce — the physics-driven kick. A ball falls under gravity; every time
// it hits the ground it thumps a kick, louder on harder impacts. Losing a little
// energy each bounce, it does the natural accelerating "dribble" — kicks getting
// faster and quieter — then settles. Tap anywhere to drop it from that spot. No
// grid, no clock: rhythm straight out of the physics.

const BALL_R = 26;
const GRAVITY = 2600; // px/s^2
const RESTITUTION = 0.72; // energy kept per bounce
const MIN_IMPACT = 90; // px/s below which it settles instead of bouncing
const GROUND_FROM_BOTTOM = 120;
const RR = 44; // base ripple radius

export default function Bounce() {
  const live = useExperimentActive();
  const { width, height } = useWindowDimensions();
  const groundY = height - GROUND_FROM_BOTTOM;

  const ballX = useSharedValue(width / 2);
  const ballY = useSharedValue(150);
  const ballVy = useSharedValue(0);
  const squash = useSharedValue(0);
  const rippleX = useSharedValue(width / 2);
  const rippleScale = useSharedValue(0);
  const rippleOp = useSharedValue(0);

  // Layout that the physics worklet needs, mirrored into shared values.
  const groundYSV = useSharedValue(groundY);
  const widthSV = useSharedValue(width);
  useEffect(() => {
    groundYSV.value = groundY;
    widthSV.value = width;
  }, [groundY, width, groundYSV, widthSV]);

  const kick = (impact: number) => {
    playKick(Math.max(0.25, Math.min(1, impact / 1800))); // harder hit = louder kick
  };

  const frame = useFrameCallback((info) => {
    'worklet';
    const dt = Math.min(info.timeSincePreviousFrame ?? 16, 40) / 1000;
    if (dt <= 0) return;
    ballVy.value += GRAVITY * dt;
    ballY.value += ballVy.value * dt;
    const floor = groundYSV.value - BALL_R;
    if (ballY.value >= floor && ballVy.value > 0) {
      const impact = ballVy.value;
      ballY.value = floor;
      if (impact > MIN_IMPACT) {
        ballVy.value = -impact * RESTITUTION;
        squash.value = withSequence(
          withTiming(1, { duration: 45, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 200, easing: Easing.out(Easing.quad) })
        );
        rippleX.value = ballX.value;
        rippleScale.value = 0;
        rippleScale.value = withTiming(1, { duration: 430, easing: Easing.out(Easing.quad) });
        rippleOp.value = 0.5;
        rippleOp.value = withTiming(0, { duration: 430, easing: Easing.out(Easing.quad) });
        runOnJS(kick)(impact);
      } else {
        ballVy.value = 0; // settle
      }
    }
  }, false);

  // Physics runs only while the experiment is live.
  useEffect(() => {
    frame.setActive(live);
    return () => frame.setActive(false);
  }, [live, frame]);

  // Tap to drop the ball from that point.
  const tap = Gesture.Tap().onStart((e) => {
    ballX.value = Math.max(BALL_R, Math.min(widthSV.value - BALL_R, e.x));
    ballY.value = Math.min(e.y, groundYSV.value - BALL_R - 1);
    ballVy.value = 0;
  });

  const ballStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: ballX.value - BALL_R },
      { translateY: ballY.value - BALL_R },
      { scaleX: 1 + 0.4 * squash.value },
      { scaleY: 1 - 0.4 * squash.value },
    ],
  }));
  const rippleStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: rippleX.value - RR },
      { translateY: groundYSV.value - RR },
      { scale: rippleScale.value },
    ],
    opacity: rippleOp.value,
  }));

  return (
    <GestureDetector gesture={tap}>
      <View style={styles.fill}>
        <View style={[styles.ground, { top: groundY }]} />
        <Animated.View style={[styles.ripple, rippleStyle]} pointerEvents="none" />
        <Animated.View style={[styles.ball, ballStyle]} pointerEvents="none" />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  ground: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  ball: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: BALL_R * 2,
    height: BALL_R * 2,
    borderRadius: BALL_R,
    backgroundColor: '#fff',
  },
  ripple: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: RR * 2,
    height: RR * 2,
    borderRadius: RR,
    borderWidth: 2,
    borderColor: '#fff',
  },
});
