import { Canvas, Path, Skia, useClock } from '@shopify/react-native-skia';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useFrameCallback, useSharedValue, runOnJS } from 'react-native-reanimated';
import { useExperimentActive } from '../_host';
import { useSharedClock } from '../combinations/clock';
import { useTempo } from '../tempo';

// Time · Sixteen Step — one bar of sixteenths wrapped onto the ring, each stop
// sized by its metric weight. Tap a stop to toggle it filled (no sound yet).
// Hold and drag across stops to lasso them into a group: the group is drawn as a
// stroked bracket that curves along the ring and envelops the selected stops.
// Tap the center to clear the group. Prototyping the core interactions only.

const STEPS = 16;
const BEATS_PER_BAR = 4;
const ACCENT = '#a0b4ff'; // playhead / current
const SEL_COLOR = '#ffd166'; // selection group

function metricLevel(p: number) {
  if (p % 16 === 0) return 4; // downbeat
  if (p % 8 === 0) return 3; // beat 3
  if (p % 4 === 0) return 2; // beats 2 & 4
  if (p % 2 === 0) return 1; // 8th "ands"
  return 0; // weak 16ths
}
const SIZE = [11, 15, 20, 26, 34];
const angleOf = (s: number) => (s / STEPS) * 2 * Math.PI - Math.PI / 2;

export default function SixteenStep() {
  const live = useExperimentActive();
  const tempo = useTempo();
  const localClock = useClock();
  const sharedClock = useSharedClock();
  const clock = sharedClock ?? localClock;
  const { width, height } = useWindowDimensions();

  const cx = width / 2;
  const cy = height * 0.42;
  const R = Math.min(width * 0.37, height * 0.27);

  const [loopStep, setLoopStep] = useState(0);
  const [curBeat, setCurBeat] = useState(1);
  const [on, setOn] = useState<boolean[]>(() => new Array(STEPS).fill(false));
  const [selArc, setSelArc] = useState<{ a: number; b: number } | null>(null); // step-space endpoints

  const toggleStep = (i: number) =>
    setOn((prev) => {
      const next = prev.slice();
      next[i] = !next[i];
      return next;
    });
  const setSel = (a: number, b: number) => setSelArc({ a, b });
  const clearSel = () => setSelArc(null);

  const tempoSV = useSharedValue(tempo);
  const phase = useSharedValue(0);
  const prevNow = useSharedValue(0);
  const started = useSharedValue(0);
  const lastStep = useSharedValue(-1);
  const lastBeat = useSharedValue(-1);
  // selection drag bookkeeping
  const anchorStep = useSharedValue(0);
  const contAngle = useSharedValue(0);
  const prevAngle = useSharedValue(0);
  const lastCur = useSharedValue(0);
  useEffect(() => {
    tempoSV.value = tempo;
  }, [tempo, tempoSV]);

  const frame = useFrameCallback(() => {
    'worklet';
    const now = clock.value;
    const beatMs = 60000 / tempoSV.value;
    const loopMs = BEATS_PER_BAR * beatMs;
    if (started.value === 0) {
      prevNow.value = now;
      started.value = 1;
      return;
    }
    let dt = now - prevNow.value;
    prevNow.value = now;
    if (dt < 0 || dt > 200) dt = 0;
    let ph = phase.value + dt / loopMs;
    ph = ph - Math.floor(ph);
    phase.value = ph;
    const step = Math.floor(ph * STEPS) % STEPS;
    if (step !== lastStep.value) {
      lastStep.value = step;
      runOnJS(setLoopStep)(step);
    }
    const beat = (Math.floor(ph * BEATS_PER_BAR) % BEATS_PER_BAR) + 1;
    if (beat !== lastBeat.value) {
      lastBeat.value = beat;
      runOnJS(setCurBeat)(beat);
    }
  }, false);

  useEffect(() => {
    started.value = 0;
    frame.setActive(live);
    return () => frame.setActive(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, frame]);

  const dots = useMemo(() => {
    return Array.from({ length: STEPS }, (_, i) => {
      const a = angleOf(i);
      return { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a), size: SIZE[metricLevel(i)] };
    });
  }, [cx, cy, R]);

  const handStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${phase.value * 360}deg` }] }));

  // Tap: near the ring toggles a stop; inside the ring clears the group.
  const tap = Gesture.Tap()
    .maxDistance(24)
    .onEnd((e) => {
      const dx = e.x - cx;
      const dy = e.y - cy;
      const r = Math.sqrt(dx * dx + dy * dy);
      if (r < R - 46) {
        runOnJS(clearSel)();
        return;
      }
      if (r > R + 46) return;
      const a = Math.atan2(dy, dx);
      let idx = Math.round(((a + Math.PI / 2) / (2 * Math.PI)) * STEPS);
      idx = ((idx % STEPS) + STEPS) % STEPS;
      runOnJS(toggleStep)(idx);
    });

  // Hold, then drag across stops to lasso an arc into a group. The angle is
  // unwrapped so dragging past the top or round the ring keeps a coherent arc.
  const lasso = Gesture.Pan()
    .activateAfterLongPress(220)
    .onStart((e) => {
      const a = Math.atan2(e.y - cy, e.x - cx);
      prevAngle.value = a;
      contAngle.value = a;
      const s = Math.round(((a + Math.PI / 2) / (2 * Math.PI)) * STEPS);
      anchorStep.value = s;
      lastCur.value = s;
      runOnJS(setSel)(s, s);
    })
    .onUpdate((e) => {
      const raw = Math.atan2(e.y - cy, e.x - cx);
      let d = raw - prevAngle.value;
      if (d > Math.PI) d -= 2 * Math.PI;
      else if (d < -Math.PI) d += 2 * Math.PI;
      prevAngle.value = raw;
      contAngle.value += d;
      const cur = Math.round(((contAngle.value + Math.PI / 2) / (2 * Math.PI)) * STEPS);
      if (cur !== lastCur.value) {
        lastCur.value = cur;
        runOnJS(setSel)(anchorStep.value, cur);
      }
    });

  // Resolve the selection arc into a set of stops + the enveloping bracket path.
  const { selectedSet, envPath } = useMemo(() => {
    if (!selArc) return { selectedSet: null as Set<number> | null, envPath: null };
    const lo = Math.min(selArc.a, selArc.b);
    const hi = Math.max(selArc.a, selArc.b);
    const span = Math.min(hi - lo, STEPS - 1);
    const set = new Set<number>();
    for (let s = lo; s <= lo + span; s++) set.add(((s % STEPS) + STEPS) % STEPS);
    const half = Math.PI / STEPS;
    const start = angleOf(lo) - half;
    const end = angleOf(lo + span) + half;
    const rIn = R - 26;
    const rOut = R + 26;
    const p = Skia.Path.Make();
    const SEG = 48;
    for (let i = 0; i <= SEG; i++) {
      const a = start + (end - start) * (i / SEG);
      const x = cx + rOut * Math.cos(a);
      const y = cy + rOut * Math.sin(a);
      if (i === 0) p.moveTo(x, y);
      else p.lineTo(x, y);
    }
    for (let i = SEG; i >= 0; i--) {
      const a = start + (end - start) * (i / SEG);
      const x = cx + rIn * Math.cos(a);
      const y = cy + rIn * Math.sin(a);
      p.lineTo(x, y);
    }
    p.close();
    return { selectedSet: set, envPath: p };
  }, [selArc, cx, cy, R]);

  return (
    <GestureDetector gesture={Gesture.Race(lasso, tap)}>
      <View style={styles.fill}>
        {/* ring outline */}
        <View
          style={{ position: 'absolute', left: cx - R, top: cy - R, width: 2 * R, height: 2 * R, borderRadius: R, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)' }}
          pointerEvents="none"
        />

        {/* selection bracket, curving along the ring */}
        {envPath && (
          <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
            <Path path={envPath} style="stroke" strokeWidth={2} color={SEL_COLOR} strokeJoin="round" />
          </Canvas>
        )}

        {/* sixteen step dots, sized by metric weight — stroke only until tapped */}
        {dots.map((d, i) => {
          const isOn = on[i];
          const current = i === loopStep;
          const isSel = selectedSet?.has(i) ?? false;
          const border = current ? ACCENT : isSel ? SEL_COLOR : isOn ? '#fff' : 'rgba(255,255,255,0.32)';
          return (
            <View
              key={i}
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: d.x - d.size / 2,
                top: d.y - d.size / 2,
                width: d.size,
                height: d.size,
                borderRadius: d.size / 2,
                borderWidth: isSel ? 2 : 1.5,
                borderColor: border,
                backgroundColor: isOn ? (current ? ACCENT : '#fff') : 'transparent',
              }}
            />
          );
        })}

        {/* sweeping hand */}
        <Animated.View style={[{ position: 'absolute', left: cx, top: cy, width: 0, height: 0 }, handStyle]} pointerEvents="none">
          <View style={{ position: 'absolute', left: -1.5, top: -R, width: 3, height: R, borderRadius: 1.5, backgroundColor: '#fff' }} />
        </Animated.View>
        <View style={{ position: 'absolute', left: cx - 4, top: cy - 4, width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.5)' }} pointerEvents="none" />

        {/* readout bottom-aligned with the screen */}
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 48, alignItems: 'center' }} pointerEvents="none">
          <Text style={styles.stepNum}>{loopStep + 1}</Text>
          <View style={{ flexDirection: 'row', marginTop: 6 }}>
            {Array.from({ length: BEATS_PER_BAR }, (_, i) => (
              <View
                key={i}
                style={{ width: 7, height: 7, borderRadius: 3.5, marginHorizontal: 3, backgroundColor: i + 1 === curBeat ? '#fff' : 'rgba(255,255,255,0.2)' }}
              />
            ))}
          </View>
        </View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  stepNum: { color: '#fff', fontSize: 56, fontWeight: '200', fontVariant: ['tabular-nums'], lineHeight: 60 },
});
