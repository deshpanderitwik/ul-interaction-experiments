import { Circle, vec } from '@shopify/react-native-skia';
import {
  interpolateColor,
  type SharedValue,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
} from 'react-native-reanimated';

// Speed-reactive exhaust jet for a moving ball. Self-contained on purpose:
// hand it the ball's position / velocity / mode shared values plus the Skia
// clock, and it samples its own trail and renders a warm "heat" plume that
// grows with speed. Lives outside the sketch file so it composes additively —
// adding it is a new file + a one-line render, nothing else to collide on.

const TRAIL = 18; // samples kept (index 0 = at the ball, last = oldest)
const JET_MIN = 300; // speed (px/s) below which there's no jet
const MAXV = 3200; // matches SlingshotBloom's launch cap → full afterburner
const HEAD_R = 13; // head-dot radius at full speed
const TAIL_FALLOFF = 0.9; // how hard dots shrink toward the tail

// Discrete intensity gears, layered on top of the continuous ramp so the
// "few levels" read clearly on video. Fractions of MAXV.
//   tier 0: ember · 1: cruise · 2: burn · 3: afterburner
function tierBoost(s: number) {
  'worklet';
  if (s > 0.7) return 1.25; // afterburner: punch up size + glow
  if (s > 0.4) return 1.1; // burn
  return 1; // cruise / ember
}

function clampw(v: number, lo: number, hi: number) {
  'worklet';
  return Math.min(hi, Math.max(lo, v));
}

type Pt = { x: number; y: number };

function JetDot({
  index,
  trail,
  speed,
  clock,
}: {
  index: number;
  trail: SharedValue<Pt[]>;
  speed: SharedValue<number>;
  clock: SharedValue<number>;
}) {
  const taper = index / (TRAIL - 1); // 0 at the ball → 1 at the tail

  const center = useDerivedValue(() => {
    clock.value; // force per-frame recompute (in-place mutation won't)
    const p = trail.value[index];
    return vec(p.x, p.y);
  });

  const radius = useDerivedValue(() => {
    clock.value;
    const s = clampw((speed.value - JET_MIN) / (MAXV - JET_MIN), 0, 1);
    return s * HEAD_R * tierBoost(s) * (1 - taper * TAIL_FALLOFF);
  });

  const opacity = useDerivedValue(() => {
    clock.value;
    const s = clampw((speed.value - JET_MIN) / (MAXV - JET_MIN), 0, 1);
    return clampw(s * tierBoost(s), 0, 1) * (1 - taper);
  });

  // Warm "heat" ramp: ember → orange → amber → white-hot as intensity climbs.
  const color = useDerivedValue(() => {
    clock.value;
    const s = clampw((speed.value - JET_MIN) / (MAXV - JET_MIN), 0, 1);
    const intensity = s * (1 - taper * 0.6);
    return interpolateColor(
      intensity,
      [0, 0.3, 0.6, 0.85, 1],
      ['#7A1500', '#B83A00', '#FF7A00', '#FFD9A0', '#FFFFFF'],
    );
  });

  return <Circle c={center} r={radius} color={color} opacity={opacity} />;
}

export function JetTrail({
  bx,
  by,
  vx,
  vy,
  mode,
  clock,
}: {
  bx: SharedValue<number>;
  by: SharedValue<number>;
  vx: SharedValue<number>;
  vy: SharedValue<number>;
  mode: SharedValue<number>; // 0 idle · 1 aiming · 2 flying
  clock: SharedValue<number>;
}) {
  const trail = useSharedValue<Pt[]>(
    Array.from({ length: TRAIL }, () => ({ x: 0, y: 0 })),
  );
  const speed = useSharedValue(0);

  useFrameCallback(() => {
    'worklet';
    speed.value = Math.hypot(vx.value, vy.value);
    if (mode.value === 2) {
      // shift samples down the trail; write the ball at the head
      for (let i = TRAIL - 1; i > 0; i--) {
        trail.value[i].x = trail.value[i - 1].x;
        trail.value[i].y = trail.value[i - 1].y;
      }
      trail.value[0].x = bx.value;
      trail.value[0].y = by.value;
    } else {
      // not flying: collapse the trail onto the ball so nothing lingers
      for (let i = 0; i < TRAIL; i++) {
        trail.value[i].x = bx.value;
        trail.value[i].y = by.value;
      }
    }
  });

  return (
    <>
      {Array.from({ length: TRAIL }, (_, i) => (
        <JetDot key={i} index={i} trail={trail} speed={speed} clock={clock} />
      ))}
    </>
  );
}
