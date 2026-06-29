import { Blur, Canvas, Circle, Group, Path, useClock } from '@shopify/react-native-skia';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  Easing,
  runOnJS,
  useDerivedValue,
  useSharedValue,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useExperimentActive } from '../_host';
import { midiToFreq, useScale } from '../scale';
import { useTempo } from '../tempo';
import {
  COL_SINE_CSS,
  COL_SQUARE_CSS,
  layout,
  sineSymbolPath,
  squareSymbolPath,
  type Cell,
} from './shared';
import { playSine, playSquare } from './voice';

// Duet — two "cells", each an instrument you toggle on/off:
//   A (sine):   the scale root, legato — a long-decay sine re-voiced on its
//               subdivision so it sustains as a held drone.
//   B (square): the fifth above, pulsed — a square-ish buzz (additive odd
//               harmonics) struck on its subdivision.
// Each cell is a soft glowing circle that PULSES on its turn and sheds a
// blooming RIPPLE on every sound. LONG-PRESS a cell to zoom in on it and
// surface buttons that change the SUBDIVISION of its pulse; tap outside to
// close. Only other interaction is tap on/off.

type Ripple = { id: number; cx: number; cy: number; r0: number; color: string; born: number };
type Key = 'a' | 'b';

const RIPPLE_LIFE = 1100; // ms
const MAX_RIPPLES = 28;

// Pulse subdivisions, as the denominator of a whole note (1 = whole … 16 =
// sixteenth). A pulse's period is one such note: 240000 / (bpm * denom) ms.
const SUBDIVISIONS = [
  { label: '1', d: 1 },
  { label: '1/2', d: 2 },
  { label: '1/4', d: 4 },
  { label: '1/8', d: 8 },
  { label: '1/16', d: 16 },
] as const;

function periodMs(denom: number, bpm: number): number {
  return 240000 / (bpm * denom);
}

export default function Duet() {
  const live = useExperimentActive();
  const { width, height } = useWindowDimensions();
  const scale = useScale();
  const tempo = useTempo();
  const clock = useClock();

  const cells = useMemo(() => layout(width, height), [width, height]);
  const sinePath = useMemo(() => sineSymbolPath(cells.a), [cells.a]);
  const squarePath = useMemo(() => squareSymbolPath(cells.b), [cells.b]);

  // Zoom target when a cell is focused: centered, a little above middle to
  // leave room for the subdivision buttons. Each cell's translate/scale to get
  // there is precomputed.
  const focus = useMemo(() => {
    const cx = width / 2;
    const cy = height * 0.4;
    const r = Math.min(width, height) * 0.3;
    const geom = (c: Cell) => ({ dx: cx - c.cx, dy: cy - c.cy, scale: r / c.r });
    return { cx, cy, r, a: geom(cells.a), b: geom(cells.b) };
  }, [width, height, cells]);

  const [aOn, setAOn] = useState(false);
  const [bOn, setBOn] = useState(false);
  const [aSub, setASub] = useState(4); // sine: quarter
  const [bSub, setBSub] = useState(8); // square: eighth
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const [focused, setFocused] = useState<Key | null>(null);
  const nextId = useRef(0);

  // Refs so the audio intervals read current focus/subdivision without
  // restarting on every change.
  const focusedRef = useRef<Key | null>(null);
  focusedRef.current = focused;

  // Eased on-amount (0..1) per cell and a short per-sound pulse (0→1→0).
  const aOnV = useSharedValue(0);
  const bOnV = useSharedValue(0);
  const aPulse = useSharedValue(0);
  const bPulse = useSharedValue(0);
  // Which cell is zoomed (1 = a, 2 = b; last value retained) and how far (0..1).
  const focusSel = useSharedValue(0);
  const focusAmt = useSharedValue(0);

  useEffect(() => {
    aOnV.value = withTiming(aOn ? 1 : 0, { duration: 500, easing: Easing.out(Easing.cubic) });
  }, [aOn, aOnV]);
  useEffect(() => {
    bOnV.value = withTiming(bOn ? 1 : 0, { duration: 500, easing: Easing.out(Easing.cubic) });
  }, [bOn, bOnV]);

  // Shed a ripple at a point; auto-prune it.
  const spawnRipple = useCallback(
    (cx: number, cy: number, r0: number, color: string) => {
      const id = nextId.current++;
      setRipples((prev) =>
        [...prev, { id, cx, cy, r0, color, born: clock.value }].slice(-MAX_RIPPLES)
      );
      setTimeout(() => setRipples((prev) => prev.filter((r) => r.id !== id)), RIPPLE_LIFE + 80);
    },
    [clock]
  );

  // Root + fifth from the global scale, in a comfortable low-mid register
  // (C3 = MIDI 48). The fifth is +7 semitones in both major and minor.
  const rootMidi = 48 + scale.root;
  const rootFreq = midiToFreq(rootMidi);
  const fifthFreq = midiToFreq(rootMidi + 7);

  // Sine cell: legato root re-voiced on its subdivision. Pops the cell and
  // sheds a ripple (from the zoom center while this cell is focused).
  useEffect(() => {
    if (!live || !aOn) return;
    const period = periodMs(aSub, tempo);
    const rise = Math.min(70, period * 0.4);
    const tick = () => {
      playSine(rootFreq);
      const fk = focusedRef.current;
      if (fk !== 'b') {
        const z = fk === 'a';
        spawnRipple(z ? focus.cx : cells.a.cx, z ? focus.cy : cells.a.cy, z ? focus.r : cells.a.r, COL_SINE_CSS);
      }
      aPulse.value = 0;
      aPulse.value = withSequence(
        withTiming(1, { duration: rise, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: Math.max(60, period - rise), easing: Easing.out(Easing.quad) })
      );
    };
    tick();
    const h = setInterval(tick, period);
    return () => clearInterval(h);
  }, [live, aOn, aSub, tempo, rootFreq, cells.a, focus, spawnRipple, aPulse]);

  // Square cell: fifth struck on its subdivision.
  useEffect(() => {
    if (!live || !bOn) return;
    const period = periodMs(bSub, tempo);
    const rise = Math.min(55, period * 0.4);
    const tick = () => {
      playSquare(fifthFreq);
      const fk = focusedRef.current;
      if (fk !== 'a') {
        const z = fk === 'b';
        spawnRipple(z ? focus.cx : cells.b.cx, z ? focus.cy : cells.b.cy, z ? focus.r : cells.b.r, COL_SQUARE_CSS);
      }
      bPulse.value = 0;
      bPulse.value = withSequence(
        withTiming(1, { duration: rise, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: Math.max(60, period - rise), easing: Easing.out(Easing.quad) })
      );
    };
    tick();
    const h = setInterval(tick, period);
    return () => clearInterval(h);
  }, [live, bOn, bSub, tempo, fifthFreq, cells.b, focus, spawnRipple, bPulse]);

  // Clear lingering ripples / exit focus when the screen goes off/background.
  useEffect(() => {
    if (!live) {
      setRipples([]);
      setFocused(null);
    }
  }, [live]);

  useEffect(() => {
    if (focused === null) {
      focusAmt.value = withTiming(0, { duration: 280, easing: Easing.out(Easing.cubic) });
      return;
    }
    focusSel.value = focused === 'a' ? 1 : 2;
    focusAmt.value = withTiming(1, { duration: 360, easing: Easing.out(Easing.cubic) });
  }, [focused, focusSel, focusAmt]);

  const hitCell = (x: number, y: number): Key | null => {
    const da = Math.hypot(x - cells.a.cx, y - cells.a.cy);
    const db = Math.hypot(x - cells.b.cx, y - cells.b.cy);
    const inA = da <= cells.a.r * 1.25;
    const inB = db <= cells.b.r * 1.25;
    if (inA && (!inB || da <= db)) return 'a';
    if (inB) return 'b';
    return null;
  };

  const toggle = (x: number, y: number) => {
    const k = hitCell(x, y);
    if (k === 'a') setAOn((v) => !v);
    else if (k === 'b') setBOn((v) => !v);
  };

  // Long press to zoom in on a cell; auto-enable it so its pulse is audible.
  const enterFocus = (x: number, y: number) => {
    const k = hitCell(x, y);
    if (!k) return;
    if (k === 'a') setAOn(true);
    else setBOn(true);
    setFocused(k);
  };

  // onStart (not onBegin) so the tap only fires once it's RECOGNIZED as a tap —
  // a hold loses to the long-press below instead of also toggling on touch-down.
  const tap = Gesture.Tap().onStart((e) => {
    if (!live) return;
    runOnJS(toggle)(e.x, e.y);
  });
  const press = Gesture.LongPress()
    .minDuration(350)
    .onStart((e) => {
      if (!live) return;
      runOnJS(enterFocus)(e.x, e.y);
    });
  const gesture = Gesture.Exclusive(press, tap);

  const focusColor = focused === 'a' ? COL_SINE_CSS : COL_SQUARE_CSS;
  const focusSubdiv = focused === 'a' ? aSub : bSub;
  const setFocusSubdiv = (d: number) => (focused === 'a' ? setASub(d) : setBSub(d));

  return (
    <View style={styles.fill}>
      <GestureDetector gesture={gesture}>
        <View style={styles.fill}>
          <Canvas style={StyleSheet.absoluteFill}>
            {ripples.map((r) => (
              <RippleRing key={r.id} ripple={r} clock={clock} />
            ))}
            <DuetCell
              cell={cells.a}
              d={sinePath}
              color={COL_SINE_CSS}
              onV={aOnV}
              pulse={aPulse}
              myIndex={1}
              dx={focus.a.dx}
              dy={focus.a.dy}
              scaleTarget={focus.a.scale}
              focusSel={focusSel}
              focusAmt={focusAmt}
            />
            <DuetCell
              cell={cells.b}
              d={squarePath}
              color={COL_SQUARE_CSS}
              onV={bOnV}
              pulse={bPulse}
              myIndex={2}
              dx={focus.b.dx}
              dy={focus.b.dy}
              scaleTarget={focus.b.scale}
              focusSel={focusSel}
              focusAmt={focusAmt}
            />
          </Canvas>
          {focused === null ? (
            <Text style={styles.hint} pointerEvents="none">
              tap to play · hold to tune
            </Text>
          ) : null}
        </View>
      </GestureDetector>

      {focused !== null ? (
        <View style={StyleSheet.absoluteFill}>
          {/* tap anywhere outside the controls to close */}
          <Pressable style={styles.backdrop} onPress={() => setFocused(null)} />
          <View style={[styles.panel, { top: focus.cy + focus.r + 28 }]} pointerEvents="box-none">
            <Text style={[styles.panelTitle, { color: focusColor }]}>
              {focused === 'a' ? 'Sine — root' : 'Square — fifth'}
            </Text>
            <Text style={styles.panelLabel}>subdivision</Text>
            <View style={styles.row}>
              {SUBDIVISIONS.map((s) => {
                const on = s.d === focusSubdiv;
                return (
                  <Pressable
                    key={s.d}
                    onPress={() => setFocusSubdiv(s.d)}
                    style={[
                      styles.subBtn,
                      on
                        ? { backgroundColor: focusColor, borderColor: focusColor }
                        : { borderColor: 'rgba(255,255,255,0.28)' },
                    ]}
                  >
                    <Text style={[styles.subBtnText, on ? styles.subBtnTextOn : null]}>{s.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.closeHint}>tap outside to close</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

// One expanding ring with a soft bloom (Skia blur), fading over its life.
function RippleRing({ ripple, clock }: { ripple: Ripple; clock: SharedValue<number> }) {
  const prog = useDerivedValue(() => Math.min(1, (clock.value - ripple.born) / RIPPLE_LIFE));
  const r = useDerivedValue(() => ripple.r0 * (0.55 + prog.value * 2.1));
  const opacity = useDerivedValue(() => {
    const p = prog.value;
    return Math.min(1, p / 0.08) * (1 - p) * (1 - p) * 0.85; // quick in, long ease-out
  });

  return (
    <Circle
      cx={ripple.cx}
      cy={ripple.cy}
      r={r}
      style="stroke"
      strokeWidth={2.5}
      color={ripple.color}
      opacity={opacity}
    >
      <Blur blur={6} />
    </Circle>
  );
}

// A cell: a soft blooming core that pulses, a thin ring outline, and the wave
// glyph (bloom underlay + crisp white). Brightens when on; pops on each sound;
// zooms to center when focused (and fades out while the OTHER cell is focused).
function DuetCell({
  cell,
  d,
  color,
  onV,
  pulse,
  myIndex,
  dx,
  dy,
  scaleTarget,
  focusSel,
  focusAmt,
}: {
  cell: Cell;
  d: string;
  color: string;
  onV: SharedValue<number>;
  pulse: SharedValue<number>;
  myIndex: number;
  dx: number;
  dy: number;
  scaleTarget: number;
  focusSel: SharedValue<number>;
  focusAmt: SharedValue<number>;
}) {
  // f = how zoomed THIS cell is (0..1); away = how faded it is because the
  // OTHER cell is the one zoomed.
  const transform = useDerivedValue(() => {
    const f = focusSel.value === myIndex ? focusAmt.value : 0;
    const base = (1 + (scaleTarget - 1) * f) * (1 + 0.09 * pulse.value);
    return [{ translateX: dx * f }, { translateY: dy * f }, { scale: base }];
  });
  const coreOpacity = useDerivedValue(() => {
    const f = focusSel.value === myIndex ? focusAmt.value : 0;
    const away = focusSel.value !== myIndex ? focusAmt.value : 0;
    return (0.1 + 0.32 * onV.value) * (0.75 + 0.25 * pulse.value) * (1 - away) * (1 + 0.5 * f);
  });
  const ringOpacity = useDerivedValue(() => {
    const away = focusSel.value !== myIndex ? focusAmt.value : 0;
    return (0.25 + 0.55 * onV.value) * (1 - away);
  });
  const glyphOpacity = useDerivedValue(() => {
    const away = focusSel.value !== myIndex ? focusAmt.value : 0;
    return (0.34 + 0.66 * onV.value) * (1 - away);
  });
  const glowOpacity = useDerivedValue(() => {
    const away = focusSel.value !== myIndex ? focusAmt.value : 0;
    return (0.18 + 0.4 * onV.value) * (0.7 + 0.3 * pulse.value) * (1 - away);
  });

  return (
    <Group transform={transform} origin={{ x: cell.cx, y: cell.cy }}>
      {/* blooming core */}
      <Circle cx={cell.cx} cy={cell.cy} r={cell.r * 0.74} color={color} opacity={coreOpacity}>
        <Blur blur={cell.r * 0.34} />
      </Circle>
      {/* ring outline */}
      <Circle
        cx={cell.cx}
        cy={cell.cy}
        r={cell.r}
        style="stroke"
        strokeWidth={2.5}
        color={color}
        opacity={ringOpacity}
      >
        <Blur blur={1.5} />
      </Circle>
      {/* glyph: bloom underlay */}
      <Path
        path={d}
        style="stroke"
        strokeWidth={9}
        strokeJoin="round"
        strokeCap="round"
        color={color}
        opacity={glowOpacity}
      >
        <Blur blur={7} />
      </Path>
      {/* glyph: crisp */}
      <Path
        path={d}
        style="stroke"
        strokeWidth={3.5}
        strokeJoin="round"
        strokeCap="round"
        color="white"
        opacity={glyphOpacity}
      />
    </Group>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  hint: {
    position: 'absolute',
    bottom: 60,
    alignSelf: 'center',
    color: 'rgba(255,255,255,0.3)',
    fontSize: 15,
    letterSpacing: 1,
  },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.25)' },
  panel: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  panelTitle: { fontSize: 17, fontWeight: '700', letterSpacing: 0.5, marginBottom: 14 },
  panelLabel: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  row: { flexDirection: 'row', gap: 10 },
  subBtn: {
    minWidth: 50,
    paddingHorizontal: 12,
    height: 46,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  subBtnText: { color: 'rgba(255,255,255,0.85)', fontSize: 16, fontWeight: '600' },
  subBtnTextOn: { color: '#0a0a0a' },
  closeHint: {
    color: 'rgba(255,255,255,0.32)',
    fontSize: 13,
    letterSpacing: 0.5,
    marginTop: 18,
  },
});
