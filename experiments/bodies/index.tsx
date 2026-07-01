import { Blur, Canvas, Circle, Group } from '@shopify/react-native-skia';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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
import { midiToFreq, noteName, useScale } from '../scale';
import { useTempo } from '../tempo';
import { Slider } from '../settings/Slider';
import {
  BODY_R,
  HIT_R,
  MAX_BODIES,
  SUBDIVISIONS,
  bodyColor,
  nearestIndex,
  periodMs,
  scaleMidiLadder,
  type Body,
} from './shared';
import { playSine } from './voice';

// Bodies — the first "compose a scene" atom (see THESIS.md).
//   double-tap  → plant a body at that point (starts playing, on the scale)
//   single-tap  → play / pause that body
//   long-press  → open its properties (subdivision, note, delete)
//   drag        → move it around the scene
// Each playing body plucks a sine on its subdivision, pulsing and shedding a
// ripple on every note. Audio is scheduled off per-body setInterval timers,
// reconciled from state; visuals are driven by per-body shared values so note
// firing never re-renders React.

// The note picker (and new-body defaults) span this range of the shared scale.
const LADDER_MIN = 48; // C3
const LADDER_MAX = 72; // C5

type Fx = { pulse: SharedValue<number>; ripple: SharedValue<number> };

export default function Bodies() {
  const live = useExperimentActive();
  const scale = useScale();
  const tempo = useTempo();

  const ladder = useMemo(() => scaleMidiLadder(scale, LADDER_MIN, LADDER_MAX), [scale]);
  const ladderRef = useRef(ladder);
  ladderRef.current = ladder;

  const [bodies, setBodies] = useState<Body[]>([]);
  const [editing, setEditing] = useState<number | null>(null);

  // Refs the audio timers and gesture callbacks read so they see current state
  // without re-subscribing.
  const bodiesRef = useRef(bodies);
  bodiesRef.current = bodies;
  const idRef = useRef(0);
  const draggingRef = useRef<number | null>(null);

  // Per-body visual channels, registered by each BodyView on mount.
  const fxRef = useRef<Map<number, Fx>>(new Map());
  const registerFx = useCallback((id: number, fx: Fx) => {
    fxRef.current.set(id, fx);
  }, []);
  const unregisterFx = useCallback((id: number) => {
    fxRef.current.delete(id);
  }, []);

  // Per-body interval handles, keyed by id, with the schedule signature they
  // were built for so we only restart a timer when its rhythm actually changes.
  const timersRef = useRef<Map<number, { handle: ReturnType<typeof setInterval>; sig: string }>>(
    new Map()
  );

  // Fire a body: sound + kick its pulse/ripple channels.
  const fire = useCallback((b: Body) => {
    playSine(midiToFreq(b.midi));
    const fx = fxRef.current.get(b.id);
    if (!fx) return;
    fx.pulse.value = 0;
    fx.pulse.value = withSequence(
      withTiming(1, { duration: 70, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: 320, easing: Easing.out(Easing.quad) })
    );
    fx.ripple.value = 0;
    fx.ripple.value = withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) });
  }, []);

  // Reconcile timers to the current scene: (re)start a body's interval when its
  // subdivision or the tempo changes, and clear timers for paused/removed bodies.
  useEffect(() => {
    const timers = timersRef.current;
    const alive = new Set<number>();
    for (const b of bodies) {
      if (!live || !b.playing) continue;
      alive.add(b.id);
      const sig = `${b.subdivision}:${tempo}`;
      const existing = timers.get(b.id);
      if (existing && existing.sig === sig) continue;
      if (existing) clearInterval(existing.handle);
      const period = periodMs(b.subdivision, tempo);
      const tick = () => {
        const cur = bodiesRef.current.find((x) => x.id === b.id);
        if (cur) fire(cur); // read fresh so a note change doesn't restart the clock
      };
      tick();
      timers.set(b.id, { handle: setInterval(tick, period), sig });
    }
    for (const [id, t] of timers) {
      if (!alive.has(id)) {
        clearInterval(t.handle);
        timers.delete(id);
      }
    }
  }, [bodies, tempo, live, fire]);

  // Tear every timer down on unmount.
  useEffect(
    () => () => {
      for (const t of timersRef.current.values()) clearInterval(t.handle);
      timersRef.current.clear();
    },
    []
  );

  // Close the panel if its body is deleted out from under it.
  useEffect(() => {
    if (editing != null && !bodies.some((b) => b.id === editing)) setEditing(null);
  }, [editing, bodies]);

  // Topmost body under a point (last drawn wins), or null.
  const hitId = (x: number, y: number): number | null => {
    const bs = bodiesRef.current;
    for (let i = bs.length - 1; i >= 0; i--) {
      if (Math.hypot(x - bs[i].x, y - bs[i].y) <= HIT_R) return bs[i].id;
    }
    return null;
  };

  const addBody = (x: number, y: number) => {
    setBodies((prev) => {
      if (prev.length >= MAX_BODIES) return prev;
      const l = ladderRef.current;
      const midi = l.length ? l[prev.length % l.length] : 60;
      return [...prev, { id: idRef.current++, x, y, midi, subdivision: 4, playing: true }];
    });
  };

  const toggleAt = (x: number, y: number) => {
    const id = hitId(x, y);
    if (id == null) return;
    setBodies((prev) => prev.map((b) => (b.id === id ? { ...b, playing: !b.playing } : b)));
  };

  const openPropsAt = (x: number, y: number) => {
    const id = hitId(x, y);
    if (id != null) setEditing(id);
  };

  const onDragBegin = (x: number, y: number) => {
    draggingRef.current = hitId(x, y);
  };
  const onDragMove = (x: number, y: number) => {
    const id = draggingRef.current;
    if (id == null) return;
    setBodies((prev) => prev.map((b) => (b.id === id ? { ...b, x, y } : b)));
  };
  const onDragEnd = () => {
    draggingRef.current = null;
  };

  const singleTap = Gesture.Tap()
    .maxDuration(250)
    .onStart((e) => {
      if (!live) return;
      runOnJS(toggleAt)(e.x, e.y);
    });
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(280)
    .onStart((e) => {
      if (!live) return;
      runOnJS(addBody)(e.x, e.y);
    });
  const longPress = Gesture.LongPress()
    .minDuration(380)
    .onStart((e) => {
      if (!live) return;
      runOnJS(openPropsAt)(e.x, e.y);
    });
  const pan = Gesture.Pan()
    .minDistance(8)
    .onBegin((e) => runOnJS(onDragBegin)(e.x, e.y))
    .onUpdate((e) => runOnJS(onDragMove)(e.x, e.y))
    .onFinalize(() => runOnJS(onDragEnd)());
  // Race so the first intent to activate wins: move → drag, hold → properties,
  // otherwise a tap (double preferred over single, so a double-tap adds not toggles).
  const gesture = Gesture.Race(pan, longPress, Gesture.Exclusive(doubleTap, singleTap));

  const editingBody = editing != null ? bodies.find((b) => b.id === editing) : undefined;

  const setSubdivision = (d: number) =>
    setBodies((prev) => prev.map((b) => (b.id === editing ? { ...b, subdivision: d } : b)));
  const setMidi = (midi: number) =>
    setBodies((prev) => prev.map((b) => (b.id === editing ? { ...b, midi } : b)));
  const deleteEditing = () => {
    setBodies((prev) => prev.filter((b) => b.id !== editing));
    setEditing(null);
  };

  return (
    <View style={styles.fill}>
      <GestureDetector gesture={gesture}>
        <View style={styles.fill}>
          <Canvas style={StyleSheet.absoluteFill}>
            {bodies.map((b) => (
              <BodyView key={b.id} body={b} register={registerFx} unregister={unregisterFx} />
            ))}
          </Canvas>
          {bodies.length === 0 ? (
            <Text style={styles.hint} pointerEvents="none">
              double-tap to add a body
            </Text>
          ) : (
            <Text style={styles.hint} pointerEvents="none">
              tap to play/pause · drag to move · hold to tune
            </Text>
          )}
        </View>
      </GestureDetector>

      {editingBody ? (
        <PropertiesPanel
          body={editingBody}
          ladder={ladder}
          onSubdivision={setSubdivision}
          onMidi={setMidi}
          onDelete={deleteEditing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </View>
  );
}

// A single body: a blooming core that brightens when playing and pops on each
// note, a ring outline, and an expanding ripple shed on every pluck. All motion
// rides shared values kicked from the audio tick, so notes don't re-render React.
function BodyView({
  body,
  register,
  unregister,
}: {
  body: Body;
  register: (id: number, fx: Fx) => void;
  unregister: (id: number) => void;
}) {
  const pulse = useSharedValue(0); // 0→1→0 per note
  const ripple = useSharedValue(1); // 0→1 per note; rests at 1 (done, invisible)

  useEffect(() => {
    register(body.id, { pulse, ripple });
    return () => unregister(body.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body.id]);

  const color = bodyColor(body.midi);

  const transform = useDerivedValue(() => [{ scale: 1 + 0.12 * pulse.value }]);
  const coreOpacity = useDerivedValue(
    () => (body.playing ? 0.42 : 0.13) + 0.5 * pulse.value,
    [body.playing]
  );
  const ringR = useDerivedValue(() => BODY_R * (1 + ripple.value * 2.2));
  const ringOpacity = useDerivedValue(() => {
    const p = ripple.value;
    return (1 - p) * (1 - p) * 0.55;
  });

  return (
    <Group transform={transform} origin={{ x: body.x, y: body.y }}>
      {/* ripple ring shed on each note */}
      <Circle cx={body.x} cy={body.y} r={ringR} style="stroke" strokeWidth={2.5} color={color} opacity={ringOpacity}>
        <Blur blur={5} />
      </Circle>
      {/* blooming core */}
      <Circle cx={body.x} cy={body.y} r={BODY_R * 0.8} color={color} opacity={coreOpacity}>
        <Blur blur={BODY_R * 0.34} />
      </Circle>
      {/* ring outline — solid when playing, faint when paused */}
      <Circle
        cx={body.x}
        cy={body.y}
        r={BODY_R}
        style="stroke"
        strokeWidth={2}
        color={color}
        opacity={body.playing ? 0.85 : 0.3}
      />
    </Group>
  );
}

// Long-press panel: subdivision buttons, a scale-stepped note slider, and delete.
function PropertiesPanel({
  body,
  ladder,
  onSubdivision,
  onMidi,
  onDelete,
  onClose,
}: {
  body: Body;
  ladder: number[];
  onSubdivision: (d: number) => void;
  onMidi: (midi: number) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const color = bodyColor(body.midi);
  const idx = nearestIndex(ladder, body.midi);

  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.panel} pointerEvents="box-none">
        <Text style={[styles.panelTitle, { color }]}>{noteName(body.midi)}</Text>

        <Text style={styles.panelLabel}>subdivision</Text>
        <View style={styles.row}>
          {SUBDIVISIONS.map((s) => {
            const on = s.d === body.subdivision;
            return (
              <Pressable
                key={s.d}
                onPress={() => onSubdivision(s.d)}
                style={[
                  styles.subBtn,
                  on
                    ? { backgroundColor: color, borderColor: color }
                    : { borderColor: 'rgba(255,255,255,0.28)' },
                ]}
              >
                <Text style={[styles.subBtnText, on ? styles.subBtnTextOn : null]}>{s.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.panelLabel}>note</Text>
        <View style={styles.sliderRow}>
          <Slider
            value={idx}
            minimumValue={0}
            maximumValue={Math.max(0, ladder.length - 1)}
            step={1}
            onValueChange={(v) => onMidi(ladder[Math.round(v)] ?? body.midi)}
            fillColor={color}
            thumbColor="#ffffff"
          />
        </View>

        <Pressable style={styles.deleteBtn} onPress={onDelete}>
          <Text style={styles.deleteText}>Delete</Text>
        </Pressable>
        <Text style={styles.closeHint}>tap outside to close</Text>
      </View>
    </View>
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
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)' },
  panel: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 60,
    alignItems: 'center',
    paddingVertical: 22,
    paddingHorizontal: 20,
    borderRadius: 20,
    backgroundColor: 'rgba(14,14,16,0.96)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  panelTitle: { fontSize: 20, fontWeight: '700', letterSpacing: 0.5, marginBottom: 16 },
  panelLabel: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 10,
    alignSelf: 'center',
  },
  row: { flexDirection: 'row', gap: 10, marginBottom: 18 },
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
  sliderRow: { alignSelf: 'stretch', marginBottom: 8 },
  deleteBtn: {
    marginTop: 16,
    paddingVertical: 11,
    paddingHorizontal: 28,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(255,90,90,0.7)',
  },
  deleteText: { color: '#ff5a5a', fontSize: 15, fontWeight: '700', letterSpacing: 0.5 },
  closeHint: {
    color: 'rgba(255,255,255,0.32)',
    fontSize: 13,
    letterSpacing: 0.5,
    marginTop: 16,
  },
});
