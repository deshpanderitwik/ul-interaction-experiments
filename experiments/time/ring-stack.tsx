import { useMemo } from 'react';
import { Text, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

// Shared building blocks for the Overlapping Rings family and Ring Joining: the
// per-layer visual (RingLayer), the animated dot (ActiveDot), the long-press
// velocity bar (VelocityBar), and the constants/helpers they need. Kept pure so
// several hosts can render the same stack at different scales.

export const BEATS_PER_BAR = 4;
export const LOOP_BARS = 2;
export const MAX_M = 32; // fixed resolution — the pattern lives on a 32-slot grid
export const FLATTEN = 0.3;
export const GAP = 78; // vertical separation between layers when tilted

export const RINGS = [{ color: '#7ad0ff' }, { color: '#a0b4ff' }, { color: '#c9a0ff' }, { color: '#ff9db0' }, { color: '#ffd166' }];
export const N = RINGS.length;
export const SPREAD = 28; // radial px between co-located dots straddling the beat point

export function withAlpha(hex: string, a: number) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

export const LEVELS = 6;
export function metricLevel(s: number) {
  if (s === 0) return LEVELS - 1;
  let lvl = 0;
  let v = s;
  while (v % 2 === 0) {
    v /= 2;
    lvl++;
  }
  return Math.min(lvl, LEVELS - 1);
}
export const ACT_SIZE = [13, 16, 19, 22, 26, 30]; // activated dot diameter by level
export const SLOT_SIZE = [9, 11, 13, 16, 19, 23]; // empty slot diameter by level
export const RR = 26; // ripple base radius
export const PULSE = 0.1; // pop/ripple duration as a fraction of the loop
export const POP = 0.6; // extra scale at the moment the hand touches a dot
export const EVERY_VALUES = [2, 4, 6, 8]; // the skip options in the editor
export const ROT_CYCLE = 16; // the global rotation counter runs 0..15 then resets
export const SWIPE_TILT = 40; // px of vertical swipe to flip the camera
export const VBAR_W = 24; // velocity bar width
export const VBAR_H = 156; // velocity bar height (full = max velocity)
export const NUM_CHIP = 34; // every-N chip size in the vertical stack
export const NUM_GAP = 8; // gap between stacked numbers
export const GAP_BW = 18; // gap between the bar and the number stack
export const EDIT_TOP = 84; // top margin for the editor box
export const EDIT_BOT = 128; // bottom margin (timer + picker) for the editor box
export const NUMBERS_H = EVERY_VALUES.length * NUM_CHIP + (EVERY_VALUES.length - 1) * NUM_GAP;
export const VEL_GAIN_MIN = 0.04; // pluck gain at velocity 0
export const VEL_GAIN_MAX = 0.3; // pluck gain at velocity 1
export const VEL_DEFAULT = 0.8; // velocity a fresh hit starts at
export const PICK_SIZE = 30; // diameter of a ring-picker circle at the bottom
export const PICK_GAP = 16; // gap between ring-picker circles
export const CENTER_R = 42; // radius of the centre tap-tempo target
export const TAP_RESET_MS = 2000; // gap after which a new tap-tempo take starts fresh
export const CLIP_M = 4; // screen-edge margin before a co-located stack grows inward
export const CLIP_TOP = 72; // extra top margin (nav) for the clip test

export type Fan = { idx: number; total: number } | null;
export type StackData = { active: boolean[][]; every: number[][]; velocity: number[][] };

export function emptyStack(): StackData {
  return {
    active: RINGS.map(() => new Array(MAX_M).fill(false)),
    every: RINGS.map(() => new Array(MAX_M).fill(1)),
    velocity: RINGS.map(() => new Array(MAX_M).fill(0)),
  };
}

// Co-location map: for each ring/slot, its index among the active dots sharing
// that slot and how many there are (drives the straddle fan).
export function computeFan(active: boolean[][], velocity: number[][]): Fan[][] {
  const perStep: number[][] = Array.from({ length: MAX_M }, () => []);
  for (let i = 0; i < N; i++) for (let s = 0; s < MAX_M; s++) if (active[i][s] && velocity[i][s] > 0) perStep[s].push(i);
  const map: Fan[][] = RINGS.map(() => new Array<Fan>(MAX_M).fill(null));
  for (let s = 0; s < MAX_M; s++) perStep[s].forEach((li, idx) => (map[li][s] = { idx, total: perStep[s].length }));
  return map;
}

export function RingLayer({
  cx,
  cy,
  R,
  width,
  height,
  color,
  active,
  every,
  velocity,
  fan,
  phase,
  rotation,
  tilt,
  focus,
  isCurrent,
  offset,
  zIndex,
  hideSlots,
}: {
  cx: number;
  cy: number;
  R: number;
  width: number;
  height: number;
  color: string;
  active: boolean[];
  every: number[];
  velocity: number[];
  fan: Fan[];
  phase: SharedValue<number>;
  rotation: SharedValue<number>;
  tilt: SharedValue<number>;
  focus: SharedValue<number>;
  isCurrent: boolean;
  offset: number;
  zIndex: number;
  hideSlots?: boolean;
}) {
  const slots = useMemo(() => {
    return Array.from({ length: MAX_M }, (_, j) => {
      const p = j;
      const a = (j / MAX_M) * 2 * Math.PI - Math.PI / 2;
      return { p, frac: j / MAX_M, x: R + R * Math.cos(a), y: R + R * Math.sin(a) };
    });
  }, [R]);

  const boxStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: tilt.value * offset }, { scaleY: 1 - tilt.value * (1 - FLATTEN) }],
  }));
  const frameStyle = useAnimatedStyle(() => ({ opacity: Math.max(focus.value, tilt.value * 0.7) }));
  const ringStrokeStyle = useAnimatedStyle(() => ({ borderWidth: 1.5 + tilt.value * 1.5 }));
  const slotStyle = useAnimatedStyle(() => ({ opacity: focus.value * (1 - tilt.value) }));
  const handStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${phase.value * 360}deg` }] }));

  return (
    <Animated.View style={[{ position: 'absolute', left: cx - R, top: cy - R, width: 2 * R, height: 2 * R, zIndex }, boxStyle]} pointerEvents="none">
      <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: 2 * R, height: 2 * R }, frameStyle]}>
        <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: 2 * R, height: 2 * R, borderRadius: R, borderColor: color }, ringStrokeStyle]} />
        <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: 2 * R, height: 2 * R }, handStyle]}>
          <View style={{ position: 'absolute', left: R - 1.5, top: 0, width: 3, height: R, borderRadius: 1.5, backgroundColor: '#fff' }} />
        </Animated.View>
      </Animated.View>

      {!hideSlots && (
        <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: 2 * R, height: 2 * R }, slotStyle]}>
          {slots.map((slot) => {
            const sz = SLOT_SIZE[metricLevel(slot.p)];
            return <View key={slot.p} style={{ position: 'absolute', left: slot.x - sz / 2, top: slot.y - sz / 2, width: sz, height: sz, borderRadius: sz / 2, borderWidth: 1.5, borderColor: withAlpha(color, 0.9), backgroundColor: '#000' }} />;
          })}
        </Animated.View>
      )}

      {slots.map((slot) => {
        const p = slot.p;
        if (!active[p] || velocity[p] <= 0) return null;
        const info = fan[p];
        const total = info ? info.total : 1;
        const idx = info ? info.idx : 0;
        let dx = slot.x;
        let dy = slot.y;
        let extras = null;
        if (total > 1) {
          const a = slot.frac * 2 * Math.PI - Math.PI / 2;
          const ca = Math.cos(a);
          const sa = Math.sin(a);
          const dotR = ACT_SIZE[metricLevel(p)] / 2;
          const tipR = R + ((total - 1) / 2) * SPREAD + dotR;
          const tipX = cx + tipR * ca;
          const tipY = cy + tipR * sa;
          const inward = tipX < CLIP_M || tipX > width - CLIP_M || tipY < CLIP_TOP || tipY > height - CLIP_M;
          const kc = inward ? -idx : idx - (total - 1) / 2;
          dx = slot.x + kc * SPREAD * ca;
          dy = slot.y + kc * SPREAD * sa;
          if (idx === 0) {
            const L = (total - 1) * SPREAD;
            const angDeg = (a * 180) / Math.PI;
            const midKc = inward ? -(total - 1) / 2 : 0;
            const lcx = slot.x + midKc * SPREAD * ca;
            const lcy = slot.y + midKc * SPREAD * sa;
            extras = (
              <>
                <View pointerEvents="none" style={{ position: 'absolute', left: lcx - L / 2, top: lcy - 0.75, width: L, height: 1.5, backgroundColor: 'rgba(255,255,255,0.5)', transform: [{ rotate: `${angDeg}deg` }] }} />
                <View pointerEvents="none" style={{ position: 'absolute', left: slot.x - 3, top: slot.y - 3, width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' }} />
              </>
            );
          }
        }
        const sz = ACT_SIZE[metricLevel(p)];
        return (
          <View key={p} pointerEvents="none">
            {extras}
            <ActiveDot phase={phase} rotation={rotation} frac={slot.frac} every={every[p] || 1} vel={velocity[p]} x={dx} y={dy} size={sz} color={color} isCurrent={isCurrent} />
          </View>
        );
      })}
    </Animated.View>
  );
}

export function ActiveDot({
  phase,
  rotation,
  frac,
  every,
  vel,
  x,
  y,
  size,
  color,
  isCurrent,
}: {
  phase: SharedValue<number>;
  rotation: SharedValue<number>;
  frac: number;
  every: number;
  vel: number;
  x: number;
  y: number;
  size: number;
  color: string;
  isCurrent: boolean;
}) {
  const dotOpacity = Math.max(0.12, Math.min(1, vel));
  const dotStyle = useAnimatedStyle(() => {
    const plays = every <= 1 || (rotation.value % ROT_CYCLE) % every === 0;
    let g = phase.value - frac;
    g = g - Math.floor(g);
    const w = plays && g < PULSE ? 1 - g / PULSE : 0;
    return { transform: [{ scale: 1 + POP * w }] };
  });
  const rippleStyle = useAnimatedStyle(() => {
    const plays = every <= 1 || (rotation.value % ROT_CYCLE) % every === 0;
    let g = phase.value - frac;
    g = g - Math.floor(g);
    if (!plays || g >= PULSE) return { opacity: 0, transform: [{ scale: 0.3 }] };
    const t = g / PULSE;
    return { opacity: (1 - t) * 0.5, transform: [{ scale: 0.3 + t * 1.4 }] };
  });
  return (
    <>
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: x - RR, top: y - RR, width: 2 * RR, height: 2 * RR, borderRadius: RR, borderWidth: 2, borderColor: color }, rippleStyle]} />
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: x - size / 2, top: y - size / 2, width: size, height: size, borderRadius: size / 2, backgroundColor: color, opacity: dotOpacity, borderWidth: isCurrent ? 2 : 0, borderColor: '#fff' }, dotStyle]} />
      {every > 1 && (
        <View pointerEvents="none" style={{ position: 'absolute', left: x + size / 2 - 2, top: y - size / 2 - 10, minWidth: 14, paddingHorizontal: 3, height: 14, borderRadius: 7, backgroundColor: '#000', borderWidth: 1, borderColor: color, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color, fontSize: 9, fontWeight: '800' }}>{every}</Text>
        </View>
      )}
    </>
  );
}

export function VelocityBar({ color, editVel, editP, left, top, originX, originY }: { color: string; editVel: SharedValue<number>; editP: SharedValue<number>; left: number; top: number; originX: number; originY: number }) {
  const barCX = left + VBAR_W / 2;
  const containerStyle = useAnimatedStyle(() => {
    const g = editP.value;
    const inv = 1 - g;
    return {
      opacity: Math.min(1, g * 1.6),
      left: barCX - VBAR_W / 2,
      top: originY * inv + top * g,
      width: VBAR_W,
      height: VBAR_H * g,
      transform: [{ translateX: (originX - barCX) * inv }],
    };
  });
  const fillStyle = useAnimatedStyle(() => ({ height: editVel.value * VBAR_H * editP.value }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', borderRadius: VBAR_W / 2, backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', overflow: 'hidden', justifyContent: 'flex-end' }, containerStyle]}>
      <Animated.View style={[{ width: '100%', backgroundColor: color, borderRadius: VBAR_W / 2 }, fillStyle]} />
    </Animated.View>
  );
}
