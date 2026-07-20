import { useClock } from '@shopify/react-native-skia';
import { useEffect } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
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
import { useSharedClock } from '../combinations/clock';
import { useTempo } from '../tempo';
import { playKick, playSnare } from './voice';

// Drums · Static Rhythm With Balls — a fixed groove kept by two bouncing balls. A
// kick ball bounces on every beat (4/4); a snare ball bounces half as often,
// landing on the downbeats (1 & 3). Each ball's arc is a clock-locked parabola
// (no real gravity to drift), so the two hits stay phase-locked forever — the
// rhythm is the physics. It rides the shared clock, so in a combination it locks
// to everything else.

const BALL_R = 24;
const KICK_H = 130; // peak bounce height (px above ground)
const SNARE_H = 320; // snare bounces slower → higher
const RR = 44;
const GROUND_FROM_BOTTOM = 140;
// Parabolic bounce arc: height above ground at cycle phase u (0..1). 0 at the
// ground (u=0 and u=1), peak H at u=0.5.
const arc = (H: number, u: number) => {
  'worklet';
  return H * 4 * u * (1 - u);
};

export default function StaticBalls() {
  const live = useExperimentActive();
  const tempo = useTempo();
  const localClock = useClock();
  const sharedClock = useSharedClock();
  const clock = sharedClock ?? localClock;
  const { width, height } = useWindowDimensions();
  const groundY = height - GROUND_FROM_BOTTOM;
  const kickX = width * 0.33;
  const snareX = width * 0.67;

  const tempoSV = useSharedValue(tempo);
  const groundYSV = useSharedValue(groundY);
  useEffect(() => {
    tempoSV.value = tempo;
    groundYSV.value = groundY;
  }, [tempo, groundY, tempoSV, groundYSV]);

  const kickY = useSharedValue(groundY - BALL_R);
  const snareY = useSharedValue(groundY - BALL_R);
  const kickSquash = useSharedValue(0);
  const snareSquash = useSharedValue(0);
  const kickRScale = useSharedValue(0);
  const kickROp = useSharedValue(0);
  const snareRScale = useSharedValue(0);
  const snareROp = useSharedValue(0);
  const kickK = useSharedValue(-1);
  const snareK = useSharedValue(-1);
  const started = useSharedValue(0);

  const frame = useFrameCallback(() => {
    'worklet';
    const now = clock.value;
    const beatMs = 60000 / tempoSV.value;
    const ground = groundYSV.value;
    const Tk = beatMs; // kick: one beat (4/4)
    const Ts = beatMs * 2; // snare: two beats (downbeats 1 & 3)

    const uk = (now % Tk) / Tk;
    const us = (now % Ts) / Ts;
    kickY.value = ground - BALL_R - arc(KICK_H, uk);
    snareY.value = ground - BALL_R - arc(SNARE_H, us);

    const kk = Math.floor(now / Tk);
    const ks = Math.floor(now / Ts);
    // First active frame: baseline the cycle counters so we don't fire a hit
    // mid-arc; hits fire on later ground contacts (counter increments).
    if (started.value === 0) {
      kickK.value = kk;
      snareK.value = ks;
      started.value = 1;
      return;
    }
    if (kk !== kickK.value) {
      kickK.value = kk;
      kickSquash.value = withSequence(
        withTiming(1, { duration: 45, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 200, easing: Easing.out(Easing.quad) })
      );
      kickRScale.value = 0;
      kickRScale.value = withTiming(1, { duration: 400, easing: Easing.out(Easing.quad) });
      kickROp.value = 0.5;
      kickROp.value = withTiming(0, { duration: 400, easing: Easing.out(Easing.quad) });
      runOnJS(playKick)(0.95);
    }
    if (ks !== snareK.value) {
      snareK.value = ks;
      snareSquash.value = withSequence(
        withTiming(1, { duration: 45, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 200, easing: Easing.out(Easing.quad) })
      );
      snareRScale.value = 0;
      snareRScale.value = withTiming(1, { duration: 400, easing: Easing.out(Easing.quad) });
      snareROp.value = 0.5;
      snareROp.value = withTiming(0, { duration: 400, easing: Easing.out(Easing.quad) });
      runOnJS(playSnare)(0.7);
    }
  }, false);

  useEffect(() => {
    started.value = 0; // re-baseline on (re)activation
    frame.setActive(live);
    return () => frame.setActive(false);
  }, [live, frame, started]);

  const kickStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: kickX - BALL_R },
      { translateY: kickY.value - BALL_R },
      { scaleX: 1 + 0.4 * kickSquash.value },
      { scaleY: 1 - 0.4 * kickSquash.value },
    ],
  }));
  const snareStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: snareX - BALL_R },
      { translateY: snareY.value - BALL_R },
      { scaleX: 1 + 0.4 * snareSquash.value },
      { scaleY: 1 - 0.4 * snareSquash.value },
    ],
  }));
  const kickRStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: kickX - RR }, { translateY: groundYSV.value - RR }, { scale: kickRScale.value }],
    opacity: kickROp.value,
  }));
  const snareRStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: snareX - RR }, { translateY: groundYSV.value - RR }, { scale: snareRScale.value }],
    opacity: snareROp.value,
  }));

  return (
    <View style={styles.fill}>
      <View style={[styles.ground, { top: groundY }]} />
      <Animated.View style={[styles.ripple, kickRStyle]} pointerEvents="none" />
      <Animated.View style={[styles.ripple, snareRStyle]} pointerEvents="none" />
      <Animated.View style={[styles.ball, kickStyle]} pointerEvents="none" />
      <Animated.View style={[styles.ball, snareStyle]} pointerEvents="none" />
      <Text style={[styles.label, { top: groundY + 14, left: kickX - 40 }]}>KICK</Text>
      <Text style={[styles.label, { top: groundY + 14, left: snareX - 40 }]}>SNARE</Text>
    </View>
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
  label: {
    position: 'absolute',
    width: 80,
    textAlign: 'center',
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
});
