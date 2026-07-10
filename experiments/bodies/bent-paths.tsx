import { Blur, Canvas, Circle, DashPathEffect, Fill, Group, Line, Path, rect, Shader, Skia, useClock, vec } from '@shopify/react-native-skia';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useExperimentActive } from '../_host';
import { getScale, midiToFreq, noteName, useScale } from '../scale';
import { useTempo } from '../tempo';
import { BODY_R, MAX_BODIES, SUBDIVISIONS, periodMs, scaleMidiLadder } from './shared';
import {
  PITCH_BOTTOM_INSET,
  PITCH_TOP,
  RULER_WIDTH,
  computeGridYs,
  midiFromY,
  noteEnabled,
  toggleNote,
  useDisabledNotes,
} from './field';
import { playSine } from './voice';

// Bodies · Bent Paths — a fork of Radial Drop. Everything works the same, but now
// pressing and dragging on a committed path's LENGTH (its line, not a waypoint
// handle) plucks it like a string: the path bows toward your finger, the body
// immediately rides the bent shape, and on release the path snaps back with a
// decaying oscillation (twang) while the body resumes on the original path.

const PULSES = 24;
const LIFE = 1.6;
const RING_ALPHA = 0.24;
const SCHED_MS = 15;
const MAX_DRIFT_FRAC = 0.18;
const EXT_MIN = 24; // C0 (Ableton labeling)
const EXT_MAX = 84; // C5
const GRAB_R = 48; // forgiving touch radius for grabbing a body (drag/tap/hold)
const HANDLE_R = 8; // drawn radius of a path waypoint handle
const HANDLE_HIT = 34; // touch radius to grab a waypoint handle
const BEND_HIT = 26; // touch distance to grab a path's length for bending
const RADIAL_R = 92; // radius of the subdivision picker ring

// Nearest point on segment AB to P → { d: distance, t: fraction along AB }.
function projectToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / len2)) : 0;
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  return { d: Math.hypot(px - cx, py - cy), t, cx, cy };
}

const RADIAL_HIT = 42; // how close the finger must be to a wedge to select it

// Angle of the i-th item on a ring of `count`, starting straight up.
function radialAngle(i: number, count: number): number {
  return -Math.PI / 2 + (i * 2 * Math.PI) / count;
}
// Screen position of wedge `i` around a ring centered at (cx, cy).
function radialItemPos(i: number, count: number, cx: number, cy: number) {
  const theta = radialAngle(i, count);
  return { x: cx + RADIAL_R * Math.cos(theta), y: cy + RADIAL_R * Math.sin(theta) };
}
// Keep the ring on screen: nudge its center in from the edges / bars.
function clampRadialCenter(x: number, y: number, width: number, height: number) {
  const padX = RADIAL_R + 40;
  return {
    cx: Math.max(padX, Math.min(width - padX, x)),
    cy: Math.max(PITCH_TOP + RADIAL_R, Math.min(height - PITCH_BOTTOM_INSET - RADIAL_R * 0.5, y)),
  };
}

// What a radial wedge selects: a subdivision denominator, delete, or extend-path.
const DELETE = 'delete' as const;
const EXTEND = 'extend' as const;
const EXTEND_ICON = '✎'; // swap freely: ✎ · ↝ · ⋯ · → · ↪
type RadialSel = number | typeof DELETE | typeof EXTEND;
type RItem = { key: string; label: string; sel: RadialSel; danger?: boolean };
// The wedges on the ring. Editing pins the control wedges (✎ extend when the body
// has a path, then ✕ delete) at the bottom center; the subdivisions then fill the
// rest, starting with "1" just to the left of the controls and running clockwise.
// Placing (no controls) uses the same ordering, so "1" sits at the bottom-left and
// runs clockwise with the bottom-center left empty.
function radialItems(editing: boolean, hasPath: boolean): RItem[] {
  const subs: RItem[] = SUBDIVISIONS.map((s) => ({ key: `s${s.d}`, label: s.label, sel: s.d }));
  const controls: RItem[] = [];
  if (editing) {
    if (hasPath) controls.push({ key: 'ext', label: EXTEND_ICON, sel: EXTEND });
    controls.push({ key: 'del', label: '✕', sel: DELETE, danger: true });
  }

  const total = subs.length + controls.length;
  const start = Math.round(total / 2 - controls.length / 2); // first control slot (bottom center)
  const ring: RItem[] = new Array(total);
  controls.forEach((c, k) => (ring[(start + k) % total] = c));
  let slot = (start + controls.length) % total; // the slot just clockwise of the controls
  subs.forEach((s) => {
    ring[slot] = s;
    slot = (slot + 1) % total;
  });
  return ring;
}

function driftMs(x: number, period: number, width: number): number {
  const frac = Math.max(-1, Math.min(1, (x - width / 2) / (width / 2)));
  return frac * MAX_DRIFT_FRAC * period;
}

// y of a note at window-position `pos` (0 = lowest/bottom … visible-1 = top).
function yOfPos(pos: number, visible: number, height: number): number {
  const bottom = height - PITCH_BOTTOM_INSET;
  return visible > 1 ? bottom - (pos / (visible - 1)) * (bottom - PITCH_TOP) : (PITCH_TOP + bottom) / 2;
}
// y for an absolute midi given the current window, or null if scrolled off-screen.
function yForMidi(
  midi: number,
  full: number[],
  scroll: number,
  visible: number,
  height: number
): number | null {
  const idx = full.indexOf(midi);
  if (idx < 0) return null;
  const pos = idx - scroll;
  if (pos < 0 || pos > visible - 1) return null;
  return yOfPos(pos, visible, height);
}
// Like yForMidi but never null: a note outside the window extrapolates linearly to
// a y beyond the screen edge, so a path's geometry and the body gliding it keep a
// continuous position as you scroll (rather than snapping off to infinity).
function yForMidiExt(
  midi: number,
  full: number[],
  scroll: number,
  visible: number,
  height: number
): number {
  const idx = full.indexOf(midi);
  const pos = (idx < 0 ? 0 : idx) - scroll;
  return yOfPos(pos, visible, height);
}
function nearestLadder(full: number[], midi: number): number {
  let best = full[0] ?? midi;
  let bd = Infinity;
  for (const m of full) {
    const d = Math.abs(m - midi);
    if (d < bd) {
      bd = d;
      best = m;
    }
  }
  return best;
}

const source = Skia.RuntimeEffect.Make(`
uniform float2 u_resolution;
uniform float u_time;
uniform float2 u_pulses[${PULSES}];
uniform float u_pulseTimes[${PULSES}];
uniform float u_pulseSeed[${PULSES}];

float2 flow(float2 p, float time) {
  return float2(
    0.7 * sin(p.y * 1.5 + time * 0.35) + 0.22 * sin(p.y * 3.0 - time * 0.5),
    0.7 * sin(p.x * 1.3 + time * 0.3) + 0.22 * sin(p.x * 2.6 + time * 0.45)
  );
}

half4 main(float2 fragcoord) {
  float light = 0.0;
  for (int i = 0; i < ${PULSES}; i++) {
    float age = u_time - u_pulseTimes[i];
    if (age < 0.0 || age > ${LIFE}) { continue; }
    float seed = u_pulseSeed[i];
    float2 d = fragcoord - u_pulses[i];
    float len = length(d);
    float bump = flow(d * 0.012 + float2(seed * 21.0, seed * 13.0), u_time * 0.15).x;
    float dist = len * (1.0 + 0.06 * bump);
    float speed = 200.0 + seed * 70.0;
    float width = 1.2;
    float r = age * speed;
    float band = (dist - r) / width;
    float env = exp(-band * band);
    float decay = max(0.0, 1.0 - age / ${LIFE});
    light += env * decay * ${RING_ALPHA};
  }
  light = clamp(light, 0.0, 1.0);
  half3 col = half3(light);
  float dither = fract(sin(dot(fragcoord, float2(12.9898, 78.233))) * 43758.5453);
  col += half3((dither - 0.5) / 255.0);
  return half4(col, 1.0);
}
`)!;

type Waypoint = { x: number; midi: number };
type Body = {
  id: number;
  x: number;
  midi: number;
  subdivision: number;
  playing: boolean;
  path?: Waypoint[]; // if set (>=2), the body travels through these, playing each
  pathT0?: number; // clock ms when traversal started
  muted?: boolean; // silent but still alive (keeps its place / keeps gliding)
};
type Fx = { pulse: SharedValue<number>; px: SharedValue<number>; py: SharedValue<number>; op: SharedValue<number> };
type Pulse = { x: number; y: number; t: number; seed: number }; // published to the shader
type BufPulse = { x: number; midi: number; t: number; seed: number }; // anchored to its note

export default function BentPaths() {
  const live = useExperimentActive();
  const scale = useScale();
  const tempo = useTempo();
  const { width, height } = useWindowDimensions();
  const clock = useClock();
  const disabled = useDisabledNotes();

  const fullLadder = useMemo(() => scaleMidiLadder(scale, EXT_MIN, EXT_MAX), [scale]);
  const visibleCount = useMemo(() => Math.max(1, scaleMidiLadder(scale, 48, 72).length), [scale]);
  const maxScroll = Math.max(0, fullLadder.length - visibleCount);

  const [scrollIndex, setScrollIndex] = useState(() => {
    const fl = scaleMidiLadder(getScale(), EXT_MIN, EXT_MAX);
    const i = fl.indexOf(48); // start showing from ~C2 up
    return i < 0 ? 0 : i;
  });
  const scroll = Math.max(0, Math.min(maxScroll, scrollIndex));
  const windowLadder = useMemo(
    () => fullLadder.slice(scroll, scroll + visibleCount),
    [fullLadder, scroll, visibleCount]
  );
  const gridYs = useMemo(() => computeGridYs(windowLadder, height), [windowLadder, height]);

  const [bodies, setBodies] = useState<Body[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [laying, setLaying] = useState<Waypoint[] | null>(null); // path being laid for `editing`
  const layingRef = useRef<Waypoint[] | null>(null);
  layingRef.current = laying;
  // The open subdivision radial: `x,y` is the drop point, `cx,cy` the (clamped)
  // ring center. It lives only while the placing long-press is held; releasing
  // commits the hovered wedge (if any) and closes it.
  // `targetId` null = placing a new body; otherwise the radial is re-picking the
  // subdivision of that existing body.
  const [placing, setPlacing] = useState<
    { x: number; y: number; cx: number; cy: number; targetId: number | null; hasPath: boolean } | null
  >(null);
  const placingRef = useRef<typeof placing>(null);
  placingRef.current = placing;
  const [closing, setClosing] = useState(false); // radial is playing its recede-out animation
  const openSeqRef = useRef(0); // bumps each open so the radial remounts and re-springs
  const [layClosing, setLayClosing] = useState(false); // the Done/Cancel bar is animating out
  const laySeqRef = useRef(0); // bumps each laying start so the bar remounts and re-animates
  const [hoverSub, setHoverSub] = useState<RadialSel | null>(null); // wedge under the finger
  const hoverRef = useRef<RadialSel | null>(null);

  const bodiesRef = useRef(bodies);
  bodiesRef.current = bodies;
  const tempoRef = useRef(tempo);
  tempoRef.current = tempo;
  const widthRef = useRef(width);
  widthRef.current = width;
  const heightRef = useRef(height);
  heightRef.current = height;
  const fullRef = useRef(fullLadder);
  fullRef.current = fullLadder;
  const scrollRef = useRef(scroll);
  scrollRef.current = scroll;
  const visibleRef = useRef(visibleCount);
  visibleRef.current = visibleCount;
  const maxScrollRef = useRef(maxScroll);
  maxScrollRef.current = maxScroll;
  const idRef = useRef(0);
  const draggingRef = useRef<number | null>(null);

  // Bend (pluck) state. `bend` (state) picks which body renders bent + carries the
  // plucked segment (index j) and its rest grab point; the shared values drive the
  // grab vertex's displacement each frame (only that one segment bends).
  // `t` is the grab fraction along segment j — a note-relative anchor, so the bend
  // (and its twang) tracks the segment as the grid scrolls instead of a fixed pixel.
  const [bend, setBend] = useState<{ bodyId: number; j: number; t: number } | null>(null);
  const bendActiveRef = useRef<{ bodyId: number; j: number } | null>(null); // scheduler suppresses this body
  const bendRestRef = useRef({ gx: 0, gy: 0 }); // rest position of the grabbed point
  const bendPhaseRef = useRef(0); // clock phase at grab, to resume exactly where it froze
  const bendS = useSharedValue(0); // pluck amount: 1 held, springs through 0 on release
  const bendOx = useSharedValue(0); // finger offset from the rest grab point
  const bendOy = useSharedValue(0);
  // Shape: 0 = the pluck triangle (peaked at the grab), 1 = the smooth fundamental
  // (half-sine). Held at 0, eases to 1 on release as the pointy higher modes decay.
  const bendMorph = useSharedValue(0);

  const pulses = useSharedValue<Pulse[]>([]);
  const pulseBufRef = useRef<BufPulse[]>([]);
  const fxRef = useRef<Map<number, Fx>>(new Map());
  const registerFx = useCallback((id: number, fx: Fx) => {
    fxRef.current.set(id, fx);
  }, []);
  const unregisterFx = useCallback((id: number) => {
    fxRef.current.delete(id);
  }, []);

  // Keep bodies on the current scale (snap to nearest note) when the scale changes.
  useEffect(() => {
    setBodies((prev) => prev.map((b) => ({ ...b, midi: nearestLadder(fullLadder, b.midi) })));
  }, [fullLadder]);

  useEffect(() => {
    if (editing != null && !bodies.some((b) => b.id === editing)) setEditing(null);
  }, [editing, bodies]);

  // Sound a note: play, pop the body, and shed a ripple anchored to the note.
  const emitNote = useCallback(
    (bodyId: number, midi: number, x: number) => {
      if (!noteEnabled(midi)) return;
      playSine(midiToFreq(midi));
      const fx = fxRef.current.get(bodyId);
      if (fx) {
        fx.pulse.value = 0;
        fx.pulse.value = withSequence(
          withTiming(1, { duration: 70, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 320, easing: Easing.out(Easing.quad) })
        );
      }
      pulseBufRef.current.push({ x, midi, t: clock.value / 1000, seed: Math.random() });
    },
    [clock]
  );
  const fire = useCallback((b: Body) => emitNote(b.id, b.midi, b.x), [emitNote]);

  // Shared-grid scheduler with drift (identical to Bodies), publishing the ripple
  // buffer once per tick so simultaneous bodies all show.
  const schedRef = useRef<Map<number, { k: number; sig: string }>>(new Map());
  const t0Ref = useRef(0);
  useEffect(() => {
    if (t0Ref.current === 0) t0Ref.current = clock.value;
    if (!live) return;
    const sched = schedRef.current;
    const handle = setInterval(() => {
      const now = clock.value;
      const nowSec = now / 1000;
      const bpm = tempoRef.current;
      const w = widthRef.current;
      const present = new Set<number>();
      for (const b of bodiesRef.current) {
        present.add(b.id);
        if (!b.playing) {
          sched.delete(b.id);
          continue;
        }
        // Path body: glide through its waypoints (one per subdivision), playing
        // each note as it arrives. Its rendered position rides px/py.
        if (b.path && b.path.length >= 2 && b.pathT0 != null) {
          // While this path is being plucked (and twanging), the body is frozen and
          // silent — faded out — until the twang settles and it resumes.
          if (bendActiveRef.current?.bodyId === b.id) continue;
          const N = b.path.length;
          const P = periodMs(b.subdivision, bpm);
          const stepF = (now - b.pathT0) / P;
          const step = Math.floor(stepF);
          const frac = stepF - step;
          const i0 = ((step % N) + N) % N;
          const i1 = (i0 + 1) % N;
          const fx = fxRef.current.get(b.id);
          if (fx) {
            const y0 = yForMidiExt(b.path[i0].midi, fullRef.current, scrollRef.current, visibleRef.current, heightRef.current);
            const y1 = yForMidiExt(b.path[i1].midi, fullRef.current, scrollRef.current, visibleRef.current, heightRef.current);
            fx.px.value = b.path[i0].x + (b.path[i1].x - b.path[i0].x) * frac;
            fx.py.value = y0 + (y1 - y0) * frac;
          }
          // pathT0 is part of the signature: (re)starting a path (Move/Extend
          // resets pathT0) re-aligns the scheduler instead of waiting for `step`
          // to climb back past the previous traversal's last slot.
          const sig = `path:${b.subdivision}:${bpm}:${b.pathT0}`;
          const entry = sched.get(b.id);
          if (entry === undefined || entry.sig !== sig) sched.set(b.id, { k: step, sig });
          else if (step > entry.k) {
            sched.set(b.id, { k: step, sig });
            if (!b.muted) emitNote(b.id, b.path[i0].midi, b.path[i0].x); // muted: keep gliding, stay silent
          }
          continue;
        }
        const P = periodMs(b.subdivision, bpm);
        const k = Math.floor((now - t0Ref.current - driftMs(b.x, P, w)) / P);
        const sig = `${b.subdivision}:${bpm}`;
        // (No mute while dragging — a body keeps sounding as you move it.)
        const entry = sched.get(b.id);
        if (entry === undefined || entry.sig !== sig) sched.set(b.id, { k, sig });
        else if (k > entry.k) {
          sched.set(b.id, { k, sig });
          if (!b.muted) fire(b); // muted: stays put, stays silent
        }
      }
      for (const id of sched.keys()) if (!present.has(id)) sched.delete(id);

      let buf = pulseBufRef.current.filter((p) => nowSec - p.t <= LIFE);
      if (buf.length > PULSES) buf = buf.slice(buf.length - PULSES);
      pulseBufRef.current = buf;
      // Recompute each ripple's screen y from the current scroll so it tracks its
      // note; off-window ripples are parked off-screen.
      pulses.value = buf.map((p) => {
        const py = yForMidiExt(p.midi, fullRef.current, scrollRef.current, visibleRef.current, heightRef.current);
        return { x: p.x, y: py, t: p.t, seed: p.seed };
      });
    }, SCHED_MS);
    return () => {
      clearInterval(handle);
      sched.clear();
      pulseBufRef.current = [];
      pulses.value = [];
    };
  }, [live, fire, emitNote, clock, pulses]);

  const midiAtY = (y: number) => midiFromY(y, windowLadder, height);
  const wpY = (midi: number) =>
    yForMidi(midi, fullRef.current, scrollRef.current, visibleRef.current, heightRef.current);
  // Tap/hold hit-test: a path body is hit at its gliding dot OR at any waypoint;
  // a static body at its note position. Topmost first.
  const hitId = (x: number, y: number): number | null => {
    const bs = bodiesRef.current;
    for (let i = bs.length - 1; i >= 0; i--) {
      const b = bs[i];
      if (b.path && b.path.length >= 2) {
        const fx = fxRef.current.get(b.id);
        if (fx && Math.hypot(x - fx.px.value, y - fx.py.value) <= GRAB_R) return b.id;
        for (const wp of b.path) {
          const wy = wpY(wp.midi);
          if (wy != null && Math.hypot(x - wp.x, y - wy) <= GRAB_R) return b.id;
        }
      } else {
        const by = wpY(b.midi);
        if (by != null && Math.hypot(x - b.x, y - by) <= GRAB_R) return b.id;
      }
    }
    return null;
  };
  // Static bodies only — path bodies aren't dragged as a whole (they ride rails);
  // you move them by dragging their waypoints instead.
  const hitStaticBody = (x: number, y: number): number | null => {
    const bs = bodiesRef.current;
    for (let i = bs.length - 1; i >= 0; i--) {
      const b = bs[i];
      if (b.path && b.path.length >= 2) continue;
      const by = wpY(b.midi);
      if (by != null && Math.hypot(x - b.x, y - by) <= GRAB_R) return b.id;
    }
    return null;
  };
  // A waypoint handle under the finger (for reshaping a laid path). Topmost first.
  const hitWaypoint = (x: number, y: number): { bodyId: number; index: number } | null => {
    const bs = bodiesRef.current;
    for (let i = bs.length - 1; i >= 0; i--) {
      const b = bs[i];
      if (!(b.path && b.path.length >= 2)) continue;
      for (let j = 0; j < b.path.length; j++) {
        const wy = wpY(b.path[j].midi);
        if (wy != null && Math.hypot(x - b.path[j].x, y - wy) <= HANDLE_HIT) return { bodyId: b.id, index: j };
      }
    }
    return null;
  };
  // A grab on a path's LENGTH (an open segment between waypoints) for plucking. Returns
  // the body, the segment index j, and the rest position of the grabbed point.
  const hitPathSegment = (
    x: number,
    y: number
  ): { bodyId: number; j: number; t: number; gx: number; gy: number } | null => {
    const bs = bodiesRef.current;
    let best: { bodyId: number; j: number; t: number; gx: number; gy: number } | null = null;
    let bestD = BEND_HIT;
    for (let i = bs.length - 1; i >= 0; i--) {
      const b = bs[i];
      if (!(b.path && b.path.length >= 2)) continue;
      for (let j = 0; j < b.path.length - 1; j++) {
        const ay = wpY(b.path[j].midi);
        const by = wpY(b.path[j + 1].midi);
        if (ay == null || by == null) continue;
        const pr = projectToSeg(x, y, b.path[j].x, ay, b.path[j + 1].x, by);
        if (pr.d < bestD) {
          bestD = pr.d;
          best = { bodyId: b.id, j, t: pr.t, gx: pr.cx, gy: pr.cy };
        }
      }
    }
    return best;
  };

  // While laying a path, a tap on the grid adds a waypoint.
  const addPathPoint = (x: number, y: number) => {
    const midi = midiAtY(y);
    const cx = Math.max(RULER_WIDTH, x);
    setLaying((prev) => (prev ? [...prev, { x: cx, midi }] : [{ x: cx, midi }]));
  };
  // Drop a body at (x, y) with a chosen subdivision (the radial's payload).
  const placeBody = (x: number, y: number, subdivision: number) => {
    if (x < RULER_WIDTH) return;
    setBodies((prev) =>
      prev.length >= MAX_BODIES
        ? prev
        : [...prev, { id: idRef.current++, x, midi: midiAtY(y), subdivision, playing: true }]
    );
  };
  // While the placing long-press is held, track which wedge the finger is over.
  const updateHover = (fx: number, fy: number) => {
    const p = placingRef.current;
    if (!p) return;
    const items = radialItems(p.targetId != null, p.hasPath);
    let best: RadialSel | null = null;
    let bestD = RADIAL_HIT;
    items.forEach((it, i) => {
      const pos = radialItemPos(i, items.length, p.cx, p.cy);
      const d = Math.hypot(fx - pos.x, fy - pos.y);
      if (d < bestD) {
        bestD = d;
        best = it.sel;
      }
    });
    if (best !== hoverRef.current) {
      hoverRef.current = best;
      setHoverSub(best);
    }
  };
  // Releasing the long-press: drop the body on the hovered wedge (if any), then let
  // the ring play its staggered recede-out (which unmounts it via onRadialClosed).
  const commitRadial = () => {
    const p = placingRef.current;
    const sub = hoverRef.current;
    if (!p) return;
    placingRef.current = null;
    if (sub === DELETE) {
      if (p.targetId != null) setBodies((prev) => prev.filter((b) => b.id !== p.targetId));
    } else if (sub === EXTEND) {
      if (p.targetId != null) beginLayingFor(p.targetId); // append more waypoints
    } else if (sub != null) {
      if (p.targetId != null) {
        // re-pick an existing body's subdivision
        setBodies((prev) => prev.map((b) => (b.id === p.targetId ? { ...b, subdivision: sub } : b)));
      } else {
        placeBody(p.x, p.y, sub);
      }
    }
    setClosing(true); // keep it mounted; the chips stagger back, then unmount
  };
  const onRadialClosed = () => {
    setPlacing(null);
    setClosing(false);
    setHoverSub(null);
    hoverRef.current = null;
  };
  const toggleAt = (x: number, y: number) => {
    if (layingRef.current) {
      addPathPoint(x, y);
      return;
    }
    const id = hitId(x, y);
    if (id == null) return;
    setBodies((prev) => prev.map((b) => (b.id === id ? { ...b, playing: !b.playing } : b)));
  };
  // Long-press opens the subdivision radial (held-and-slid, released to pick). On a
  // body it re-picks that body's subdivision; on empty grid it drops a new body.
  const openRadial = (x: number, y: number, targetId: number | null) => {
    const { cx, cy } = clampRadialCenter(x, y, widthRef.current, heightRef.current);
    const body = targetId != null ? bodiesRef.current.find((b) => b.id === targetId) : undefined;
    const seed = body?.subdivision ?? null; // pre-highlight the body's current subdivision
    const hasPath = !!(body?.path && body.path.length >= 2);
    hoverRef.current = seed;
    setHoverSub(seed);
    openSeqRef.current += 1; // fresh mount → re-run the spring-out
    const p = { x, y, cx, cy, targetId, hasPath };
    placingRef.current = p; // available immediately for the first onTouchesMove
    setClosing(false);
    setPlacing(p);
  };
  const onLongPress = (x: number, y: number) => {
    if (layingRef.current) return;
    const id = hitId(x, y);
    if (id != null) openRadial(x, y, id);
    else if (hitPathSegment(x, y)) return; // on a path's length → reserved for the pluck drag
    else if (x >= RULER_WIDTH) openRadial(x, y, null);
  };
  // Start laying a body's path (seeded with its current spot, or its existing
  // waypoints to extend). Driven by the bottom Done/Cancel bar — no sheet.
  const beginLayingFor = (id: number) => {
    const b = bodiesRef.current.find((bb) => bb.id === id);
    if (!b) return;
    laySeqRef.current += 1; // fresh mount → re-run the buttons' rise-in
    setLayClosing(false);
    setEditing(id);
    setLaying(b.path && b.path.length >= 2 ? [...b.path] : [{ x: b.x, midi: b.midi }]);
  };
  // Double-tap a body → start laying its path.
  const onDoubleTap = (x: number, y: number) => {
    if (layingRef.current) return;
    const id = hitId(x, y);
    if (id != null) beginLayingFor(id);
  };
  // Resume the body right away (on release): unfreeze it exactly where it froze and
  // fade it back in — the string keeps twanging on its own behind it.
  const resumeBody = () => {
    const bnd = bendActiveRef.current;
    if (!bnd) return;
    setBodies((prev) =>
      prev.map((b) => (b.id === bnd.bodyId ? { ...b, pathT0: clock.value - bendPhaseRef.current } : b))
    );
    const fx = fxRef.current.get(bnd.bodyId);
    if (fx) fx.op.value = withTiming(1, { duration: 130 });
    bendActiveRef.current = null;
  };
  // When the twang finally settles: drop the bent rendering (back to the plain path).
  const endBendRender = () => setBend(null);
  // A drag grabs (in priority order) a path waypoint, then a path's length (to
  // bend/pluck it), then a static body, else it scrolls the window.
  const dragModeRef = useRef<'body' | 'waypoint' | 'bend' | 'scroll' | null>(null);
  const waypointDragRef = useRef<{ bodyId: number; index: number } | null>(null);
  const onDragBegin = (x: number, y: number) => {
    if (layingRef.current) {
      dragModeRef.current = null;
      return;
    }
    const wp = hitWaypoint(x, y);
    if (wp) {
      waypointDragRef.current = wp;
      dragModeRef.current = 'waypoint';
      return;
    }
    const seg = hitPathSegment(x, y);
    if (seg) {
      bendActiveRef.current = { bodyId: seg.bodyId, j: seg.j };
      bendRestRef.current = { gx: seg.gx, gy: seg.gy };
      bendOx.value = 0;
      bendOy.value = 0;
      bendMorph.value = 0; // held as the pointy pluck shape peaked at the grab
      bendS.value = 1; // held taut (also cancels any prior twang spring)
      // Freeze the body's clock phase so it can resume exactly here, and fade it out.
      const b = bodiesRef.current.find((bb) => bb.id === seg.bodyId);
      if (b && b.pathT0 != null) bendPhaseRef.current = clock.value - b.pathT0;
      const fx = fxRef.current.get(seg.bodyId);
      if (fx) fx.op.value = withTiming(0, { duration: 130 });
      dragModeRef.current = 'bend';
      setBend({ bodyId: seg.bodyId, j: seg.j, t: seg.t });
      return;
    }
    const id = hitStaticBody(x, y);
    if (id != null) {
      draggingRef.current = id;
      dragModeRef.current = 'body';
    } else {
      draggingRef.current = null;
      dragModeRef.current = 'scroll';
      scrollStartRef.current = scrollRef.current;
      scrollY0Ref.current = y;
    }
  };
  const onDragMove = (x: number, y: number) => {
    if (dragModeRef.current === 'scroll') {
      onScrollMove(y);
      return;
    }
    if (dragModeRef.current === 'bend') {
      bendOx.value = x - bendRestRef.current.gx;
      bendOy.value = y - bendRestRef.current.gy;
      return;
    }
    if (dragModeRef.current === 'waypoint') {
      const wp = waypointDragRef.current;
      if (!wp) return;
      const cx = Math.max(RULER_WIDTH, x);
      const midi = midiAtY(y);
      setBodies((prev) =>
        prev.map((b) =>
          b.id === wp.bodyId && b.path
            ? { ...b, path: b.path.map((p, idx) => (idx === wp.index ? { x: cx, midi } : p)) }
            : b
        )
      );
      return;
    }
    const id = draggingRef.current;
    if (id == null) return;
    const cx = Math.max(RULER_WIDTH, x);
    const midi = midiAtY(y);
    setBodies((prev) => prev.map((b) => (b.id === id ? { ...b, x: cx, midi } : b)));
  };
  const onDragEnd = () => {
    if (dragModeRef.current === 'bend') {
      dragModeRef.current = null;
      // Sound the two notes at the ends of the plucked segment.
      const bnd = bendActiveRef.current;
      if (bnd) {
        const b = bodiesRef.current.find((bb) => bb.id === bnd.bodyId);
        const a = b?.path?.[bnd.j];
        const c = b?.path?.[bnd.j + 1];
        if (b && a) emitNote(b.id, a.midi, a.x);
        if (b && c) emitNote(b.id, c.midi, c.x);
      }
      // Body comes back immediately; the string keeps twanging behind it. The spring
      // is underdamped so the segment whips past and oscillates; when it finally
      // settles we drop the bent rendering.
      resumeBody();
      // The pluck relaxes into the smooth fundamental as the sharp higher modes die.
      bendMorph.value = withTiming(1, { duration: 240, easing: Easing.out(Easing.quad) });
      bendS.value = withSpring(0, { damping: 4.5, stiffness: 260, mass: 0.5 }, (finished) => {
        'worklet';
        if (finished) runOnJS(endBendRender)();
      });
      return;
    }
    draggingRef.current = null;
    dragModeRef.current = null;
    waypointDragRef.current = null;
  };

  // Single tap toggles play/pause (or lays a path point); double-tap starts path
  // laying; placement is by long-press → radial.
  const singleTap = Gesture.Tap()
    .maxDuration(250)
    .onStart((e) => {
      if (!live) return;
      runOnJS(toggleAt)(e.x, e.y);
    });
  const longPress = Gesture.LongPress()
    .minDuration(380)
    .maxDistance(10000) // allow sliding out to the wedges once the press has activated
    .onStart((e) => {
      if (!live) return;
      runOnJS(onLongPress)(e.x, e.y);
    })
    .onTouchesMove((e) => {
      const t = e.allTouches[0];
      if (t) runOnJS(updateHover)(t.x, t.y);
    })
    .onFinalize(() => {
      runOnJS(commitRadial)();
    });
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(280)
    .onStart((e) => {
      if (!live) return;
      runOnJS(onDoubleTap)(e.x, e.y);
    });
  const pan = Gesture.Pan()
    .minDistance(8)
    .onStart((e) => runOnJS(onDragBegin)(e.x, e.y))
    .onUpdate((e) => runOnJS(onDragMove)(e.x, e.y))
    .onFinalize(() => runOnJS(onDragEnd)());
  const gesture = Gesture.Race(pan, longPress, Gesture.Exclusive(doubleTap, singleTap));

  // Scroll gesture on the ruler column (drag up = higher notes).
  const scrollStartRef = useRef(0);
  const scrollY0Ref = useRef(0);
  const onScrollBegin = (y: number) => {
    scrollStartRef.current = scrollRef.current;
    scrollY0Ref.current = y;
  };
  const onScrollMove = (y: number) => {
    const bottom = heightRef.current - PITCH_BOTTOM_INSET;
    const spacing = (bottom - PITCH_TOP) / Math.max(1, visibleRef.current - 1);
    const dNotes = Math.round((y - scrollY0Ref.current) / spacing); // swipe down → higher notes
    setScrollIndex(Math.max(0, Math.min(maxScrollRef.current, scrollStartRef.current + dNotes)));
  };
  const scrollPan = Gesture.Pan()
    .minDistance(6)
    .onBegin((e) => runOnJS(onScrollBegin)(e.y))
    .onUpdate((e) => runOnJS(onScrollMove)(e.y));

  // While laying a path, the catcher still lets you scroll the grid: a tap drops a
  // waypoint, a drag scrolls the visible window (same handlers as the ruler).
  const layTap = Gesture.Tap()
    .maxDuration(250)
    .onStart((e) => runOnJS(addPathPoint)(e.x, e.y));
  const layScrollPan = Gesture.Pan()
    .minDistance(8)
    .onBegin((e) => runOnJS(onScrollBegin)(e.y))
    .onUpdate((e) => runOnJS(onScrollMove)(e.y));
  const layingGesture = Gesture.Race(layScrollPan, layTap);

  // `editing` here tracks which body a path is being laid for (set on double-tap).
  // Both end laying by nulling it but keep the bar mounted (layClosing) so its
  // buttons can animate out before unmounting (via onLayClosed).
  const cancelLaying = () => {
    if (laying == null) return;
    setLaying(null);
    setEditing(null);
    setLayClosing(true);
  };
  const confirmLaying = () => {
    if (laying == null) return;
    const pts = laying;
    const targetId = editing;
    setLaying(null);
    setEditing(null);
    setLayClosing(true);
    if (pts.length >= 2) {
      setBodies((prev) => prev.map((b) => (b.id === targetId ? { ...b, path: pts, pathT0: clock.value } : b)));
    }
  };
  const onLayClosed = () => setLayClosing(false);

  const uniforms = useDerivedValue(() => {
    const pos: number[] = [];
    const times: number[] = [];
    const seeds: number[] = [];
    const ps = pulses.value;
    for (let i = 0; i < PULSES; i++) {
      const p = ps[i];
      if (p) {
        pos.push(p.x, p.y);
        times.push(p.t);
        seeds.push(p.seed);
      } else {
        pos.push(0, 0);
        times.push(-100);
        seeds.push(0);
      }
    }
    return {
      u_resolution: [width, height],
      u_time: clock.value / 1000,
      u_pulses: pos,
      u_pulseTimes: times,
      u_pulseSeed: seeds,
    };
  });

  // One render entry per body. Path bodies always render (position via px/py);
  // static bodies render only when their note is in the window.
  const bodyViews = bodies.map((b) => {
    const isPath = !!(b.path && b.path.length >= 2);
    const y0 = isPath
      ? yForMidiExt(b.path![0].midi, fullLadder, scroll, visibleCount, height)
      : yForMidi(b.midi, fullLadder, scroll, visibleCount, height);
    return { b, isPath, y0 };
  });

  // Clip the grid content (lines, paths, bodies) to the field — half a row past the
  // top and bottom notes — so extrapolated off-window geometry doesn't bleed into
  // the top bar or the drift ruler. The background shader/ripples stay full-screen.
  const fieldClip = useMemo(() => {
    const bottom = height - PITCH_BOTTOM_INSET;
    const step = (bottom - PITCH_TOP) / Math.max(1, visibleCount - 1);
    const top = PITCH_TOP - step / 2;
    return rect(0, top, width, bottom + step / 2 - top);
  }, [width, height, visibleCount]);

  return (
    <View style={styles.fill}>
      <GestureDetector gesture={gesture}>
        <View style={styles.fill}>
          <Canvas style={StyleSheet.absoluteFill}>
            <Fill>
              <Shader source={source} uniforms={uniforms} />
            </Fill>
            <Group clip={fieldClip}>
              {gridYs.map((y, i) => (
                <Line key={i} p1={vec(0, y)} p2={vec(width, y)} color="rgba(255,255,255,0.09)" strokeWidth={1} />
              ))}
              {bodyViews.map(({ b, isPath }) =>
                isPath ? (
                  bend?.bodyId === b.id ? (
                    <BentPathLine
                      key={`p${b.id}`}
                      points={b.path!}
                      j={bend.j}
                      t={bend.t}
                      full={fullLadder}
                      scroll={scroll}
                      visible={visibleCount}
                      height={height}
                      bendS={bendS}
                      bendOx={bendOx}
                      bendOy={bendOy}
                      bendMorph={bendMorph}
                    />
                  ) : (
                    <PathLine
                      key={`p${b.id}`}
                      points={b.path!}
                      full={fullLadder}
                      scroll={scroll}
                      visible={visibleCount}
                      height={height}
                      handles
                      dashed={placing?.targetId === b.id} // dashed while its subdivision radial is open
                    />
                  )
                ) : null
              )}
              {laying && laying.length > 0 ? (
                <PathLine points={laying} full={fullLadder} scroll={scroll} visible={visibleCount} height={height} dots />
              ) : null}
              {bodyViews.map(({ b, isPath, y0 }) =>
                isPath || y0 != null ? (
                  <BodyView
                    key={b.id}
                    body={b}
                    y0={y0 ?? -9999}
                    isPath={isPath}
                    register={registerFx}
                    unregister={unregisterFx}
                  />
                ) : null
              )}
            </Group>
          </Canvas>
          <View style={styles.centerGuide} pointerEvents="none" />
          <DriftRuler />
        </View>
      </GestureDetector>

      {/* scrollable, tappable pitch ruler */}
      <GestureDetector gesture={scrollPan}>
        <View style={styles.ruler} pointerEvents="box-none">
          <View
            style={[styles.rulerSpine, { top: PITCH_TOP, height: Math.max(0, height - PITCH_BOTTOM_INSET - PITCH_TOP) }]}
            pointerEvents="none"
          />
          {windowLadder.map((midi, i) => {
            const y = yOfPos(i, visibleCount, height);
            const isOff = disabled.has(midi);
            return (
              <Pressable
                key={midi}
                onPress={() => toggleNote(midi)}
                hitSlop={{ top: 4, bottom: 4, left: 6, right: 14 }}
                style={[styles.rulerRow, { top: y - 11 }]}
              >
                <Text style={[styles.rulerLabel, isOff && styles.rulerLabelOff]}>{noteName(midi)}</Text>
                <View style={[styles.rulerTick, isOff && styles.rulerTickOff]} />
              </Pressable>
            );
          })}
        </View>
      </GestureDetector>

      {/* While laying a path, a full-screen catcher sits above the base gesture
          layer (so input doesn't need to pass through the panel overlay) but below
          the panel's buttons: a tap drops a waypoint, a drag scrolls the grid. */}
      {laying != null ? (
        <GestureDetector gesture={layingGesture}>
          <View style={StyleSheet.absoluteFill} />
        </GestureDetector>
      ) : null}

      {/* While laying a path, just a Done / Cancel icon bar at the bottom — no sheet.
          Tick (done) on the left, cross (cancel) on the right; each rises in from
          below one at a time and drops back out the same way. */}
      {laying != null || layClosing ? (
        <View style={styles.layBar} pointerEvents={laying != null ? 'box-none' : 'none'}>
          <LayIconButton
            key={`done-${laySeqRef.current}`}
            kind="done"
            index={0}
            count={2}
            disabled={laying != null && laying.length < 2}
            closing={laying == null}
            onPress={confirmLaying}
            onClosed={onLayClosed} // index 0 lands last on the way out → owns the unmount
          />
          <LayIconButton
            key={`cancel-${laySeqRef.current}`}
            kind="cancel"
            index={1}
            count={2}
            closing={laying == null}
            onPress={cancelLaying}
          />
        </View>
      ) : null}

      {placing ? (
        <SubdivisionRadial
          key={openSeqRef.current}
          placing={placing}
          hover={hoverSub}
          closing={closing}
          ghost={placing.targetId == null}
          onClosed={onRadialClosed}
        />
      ) : null}
    </View>
  );
}

const STAGGER_IN = 34; // ms between successive wedges springing out
const STAGGER_OUT = 24; // ms between wedges receding back

// The subdivision picker that blooms on a long-press: a ghost body at the drop
// point ringed by subdivision wedges. It's a pure visual overlay (pointerEvents
// none) — the same held finger slides over a wedge to highlight it, and releasing
// commits it. The wedge under the finger (`hover`) lights up. On open the wedges
// spring out from the center one by one; on `closing` they stagger back in and the
// last to land calls `onClosed` so the parent can unmount.
function SubdivisionRadial({
  placing,
  hover,
  closing,
  ghost: showGhost,
  onClosed,
}: {
  placing: { x: number; y: number; cx: number; cy: number; targetId: number | null; hasPath: boolean };
  hover: RadialSel | null;
  closing: boolean;
  ghost: boolean;
  onClosed: () => void;
}) {
  const { x, y, cx, cy } = placing;
  const items = radialItems(placing.targetId != null, placing.hasPath);
  const n = items.length;

  // The ghost tracks the same in/out timing as the ring core.
  const ghost = useSharedValue(0);
  useEffect(() => {
    ghost.value = withSpring(1, { damping: 14, stiffness: 190, mass: 0.6 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (closing) ghost.value = withTiming(0, { duration: 150, easing: Easing.in(Easing.quad) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing]);
  const ghostStyle = useAnimatedStyle(() => ({
    opacity: ghost.value,
    transform: [{ scale: 0.4 + 0.6 * ghost.value }],
  }));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {showGhost ? (
        <Animated.View style={[styles.radialGhost, { left: x - BODY_R, top: y - BODY_R }, ghostStyle]} />
      ) : null}
      {items.map((item, i) => {
        const pos = radialItemPos(i, n, cx, cy);
        return (
          <RadialChip
            key={item.key}
            label={item.label}
            tx={pos.x}
            ty={pos.y}
            ox={x} // wedges emanate from the thumb point
            oy={y}
            index={i}
            count={n}
            on={hover === item.sel}
            danger={!!item.danger}
            closing={closing}
            // Index 0 lands last on the way out, so it owns the unmount signal.
            onClosed={i === 0 ? onClosed : undefined}
          />
        );
      })}
    </View>
  );
}

// One subdivision wedge. It flies from the ring center out to (tx, ty) on a spring,
// staggered by its index; when `closing`, it flies back to the center (reverse
// stagger) and fades to nothing.
function RadialChip({
  label,
  tx,
  ty,
  ox,
  oy,
  index,
  count,
  on,
  danger,
  closing,
  onClosed,
}: {
  label: string;
  tx: number;
  ty: number;
  ox: number;
  oy: number;
  index: number;
  count: number;
  on: boolean;
  danger?: boolean;
  closing: boolean;
  onClosed?: () => void;
}) {
  const a = useSharedValue(0); // 0 = collapsed at center, 1 = seated on the ring
  useEffect(() => {
    a.value = withDelay(index * STAGGER_IN, withSpring(1, { damping: 13, stiffness: 200, mass: 0.7 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!closing) return;
    a.value = withDelay(
      (count - 1 - index) * STAGGER_OUT,
      withTiming(0, { duration: 150, easing: Easing.in(Easing.quad) }, (finished) => {
        if (finished && onClosed) runOnJS(onClosed)();
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing]);

  const style = useAnimatedStyle(() => {
    const inv = 1 - a.value;
    return {
      opacity: a.value,
      transform: [
        { translateX: (ox - tx) * inv },
        { translateY: (oy - ty) * inv },
        { scale: 0.3 + 0.7 * a.value },
      ],
    };
  });

  return (
    <Animated.View
      style={[
        styles.radialChip,
        danger && styles.radialChipDanger,
        on && (danger ? styles.radialChipDangerOn : styles.radialChipOn),
        { left: tx - 30, top: ty - 22 },
        style,
      ]}
    >
      <Text
        style={[
          styles.radialChipText,
          danger && styles.radialChipDangerText,
          on && (danger ? styles.radialChipDangerTextOn : styles.radialChipTextOn),
        ]}
      >
        {label}
      </Text>
    </Animated.View>
  );
}

// A path-laying control (tick = done, cross = cancel). It rises in from below,
// staggered by index; when `closing` it drops back down (reverse stagger) and the
// index-0 button (which lands last) signals unmount via onClosed.
function LayIconButton({
  kind,
  index,
  count,
  disabled,
  closing,
  onPress,
  onClosed,
}: {
  kind: 'done' | 'cancel';
  index: number;
  count: number;
  disabled?: boolean;
  closing: boolean;
  onPress: () => void;
  onClosed?: () => void;
}) {
  const a = useSharedValue(0);
  useEffect(() => {
    a.value = withDelay(index * STAGGER_IN, withSpring(1, { damping: 13, stiffness: 200, mass: 0.7 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!closing) return;
    a.value = withDelay(
      (count - 1 - index) * STAGGER_OUT,
      withTiming(0, { duration: 150, easing: Easing.in(Easing.quad) }, (finished) => {
        if (finished && onClosed) runOnJS(onClosed)();
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing]);

  const style = useAnimatedStyle(() => ({
    opacity: a.value,
    transform: [{ translateY: 34 * (1 - a.value) }, { scale: 0.6 + 0.4 * a.value }],
  }));

  const isDone = kind === 'done';
  return (
    <Animated.View style={style}>
      <Pressable
        disabled={disabled}
        onPress={onPress}
        style={[
          styles.layIconBtn,
          isDone ? styles.layDoneBtn : styles.layCancelBtn,
          disabled && styles.layIconDisabled,
        ]}
      >
        <Text style={[styles.layIconText, isDone ? styles.layDoneText : styles.layCancelText]}>
          {isDone ? '✓' : '✕'}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

// The faint line a path body travels. `dots` marks the waypoints (used while
// laying); `handles` draws grabbable rings at each waypoint (a committed path you
// can drag to reshape).
function PathLine({
  points,
  full,
  scroll,
  visible,
  height,
  dots,
  handles,
  dashed,
}: {
  points: Waypoint[];
  full: number[];
  scroll: number;
  visible: number;
  height: number;
  dots?: boolean;
  handles?: boolean;
  dashed?: boolean;
}) {
  // Extrapolate every waypoint's y (never null) so the stroke stays a single
  // continuous polyline as points scroll past the screen edge; Skia clips the
  // off-screen portion.
  const skPath = useMemo(() => {
    const p = Skia.Path.Make();
    points.forEach((wp, i) => {
      const y = yForMidiExt(wp.midi, full, scroll, visible, height);
      if (i === 0) p.moveTo(wp.x, y);
      else p.lineTo(wp.x, y);
    });
    return p;
  }, [points, full, scroll, visible, height]);

  return (
    <Group>
      <Path
        path={skPath}
        style="stroke"
        strokeWidth={1.5}
        strokeJoin="round"
        color={dashed ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.32)'}
      >
        {dashed ? <DashPathEffect intervals={[7, 6]} /> : null}
      </Path>
      {dots
        ? points.map((wp, i) => (
            <Circle
              key={i}
              cx={wp.x}
              cy={yForMidiExt(wp.midi, full, scroll, visible, height)}
              r={4.5}
              color="rgba(255,255,255,0.7)"
            />
          ))
        : null}
      {handles
        ? points.map((wp, i) => (
            <Circle
              key={i}
              cx={wp.x}
              cy={yForMidiExt(wp.midi, full, scroll, visible, height)}
              r={HANDLE_R}
              style="stroke"
              strokeWidth={2}
              color="rgba(255,255,255,0.6)"
            />
          ))
        : null}
    </Group>
  );
}

// The path while it's being plucked: only the grabbed segment (j → j+1) bends. Its
// two endpoints stay pinned; a grab vertex is inserted between them and displaced by
// the finger offset times the animated pluck amount (which twangs to 0 on release).
function BentPathLine({
  points,
  j,
  t,
  full,
  scroll,
  visible,
  height,
  bendS,
  bendOx,
  bendOy,
  bendMorph,
}: {
  points: Waypoint[];
  j: number;
  t: number;
  full: number[];
  scroll: number;
  visible: number;
  height: number;
  bendS: SharedValue<number>;
  bendOx: SharedValue<number>;
  bendOy: SharedValue<number>;
  bendMorph: SharedValue<number>;
}) {
  const rest = useMemo(
    () => points.map((wp) => ({ x: wp.x, y: yForMidiExt(wp.midi, full, scroll, visible, height) })),
    [points, full, scroll, visible, height]
  );

  const path = useDerivedValue(() => {
    const p = Skia.Path.Make();
    const amp = bendS.value;
    const ox = bendOx.value;
    const oy = bendOy.value;
    const m = bendMorph.value; // 0 = pluck triangle at t, 1 = fundamental half-sine
    const ax = rest[j].x;
    const ay = rest[j].y;
    const bx = rest[j + 1].x;
    const by = rest[j + 1].y;

    p.moveTo(rest[0].x, rest[0].y);
    for (let k = 1; k < rest.length; k++) {
      if (k - 1 === j) {
        // Sample the plucked segment: each point displaces along the pull vector by
        // the shape φ(s). φ blends a rounded pluck-triangle peaked at the grab (t) —
        // so the string follows the finger where it was pulled — toward a smooth
        // half-sine as it relaxes to the fundamental vibration.
        const M = 20;
        for (let s0 = 1; s0 <= M; s0++) {
          const s = s0 / M;
          let tri;
          if (t <= 0 || t >= 1) tri = 0;
          else if (s <= t) {
            const u = s / t;
            tri = u * u * (3 - 2 * u);
          } else {
            const u = (1 - s) / (1 - t);
            tri = u * u * (3 - 2 * u);
          }
          const fund = Math.sin(Math.PI * s);
          const sh = (tri + (fund - tri) * m) * amp;
          p.lineTo(ax + (bx - ax) * s + ox * sh, ay + (by - ay) * s + oy * sh);
        }
      } else {
        p.lineTo(rest[k].x, rest[k].y);
      }
    }
    return p;
  }, [rest, j, t]);

  return (
    <Group>
      <Path path={path} style="stroke" strokeWidth={1.6} strokeJoin="round" color="rgba(255,255,255,0.65)" />
      {/* anchor handles stay put (pinned) through the twang */}
      {rest.map((pt, k) => (
        <Circle key={k} cx={pt.x} cy={pt.y} r={HANDLE_R} style="stroke" strokeWidth={2} color="rgba(255,255,255,0.6)" />
      ))}
    </Group>
  );
}

function BodyView({
  body,
  y0,
  isPath,
  register,
  unregister,
}: {
  body: Body;
  y0: number;
  isPath: boolean;
  register: (id: number, fx: Fx) => void;
  unregister: (id: number) => void;
}) {
  const pulse = useSharedValue(0);
  const px = useSharedValue(isPath && body.path ? body.path[0].x : body.x);
  const py = useSharedValue(y0);
  const op = useSharedValue(1); // fades to 0 while this body's path is being plucked
  useEffect(() => {
    register(body.id, { pulse, px, py, op });
    return () => unregister(body.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body.id]);

  const center = useDerivedValue(
    () => (isPath ? { x: px.value, y: py.value } : { x: body.x, y: y0 }),
    [isPath, body.x, y0]
  );
  const r = useDerivedValue(() => BODY_R * (1 + 0.14 * pulse.value));
  const muted = !!body.muted;
  const glowOpacity = useDerivedValue(
    () => op.value * (muted ? 0.0 : (body.playing ? 0.2 : 0.0) + 0.45 * pulse.value),
    [body.playing, muted]
  );
  const coreOpacity = useDerivedValue(() => op.value * (muted ? 0.3 : 1), [muted]);
  const ringOpacity = useDerivedValue(() => op.value * (muted ? 0.22 : 0.5), [muted]);

  // A muted body reads dimmer; a plucked one fades out entirely (op) and back in.
  return (
    <Group>
      <Circle c={center} r={BODY_R * 1.1} color="white" opacity={glowOpacity}>
        <Blur blur={BODY_R * 0.5} />
      </Circle>
      {body.playing ? (
        <Circle c={center} r={r} color="white" opacity={coreOpacity} />
      ) : (
        <Circle c={center} r={r} style="stroke" strokeWidth={2} color="white" opacity={ringOpacity} />
      )}
    </Group>
  );
}

// Horizontal drift ruler along the bottom (center = quantized), same as Bodies.
function DriftRuler() {
  return (
    <View style={styles.driftRuler} pointerEvents="none">
      <View style={styles.driftLine} />
      <View style={styles.driftCenterTick} />
      <View style={styles.driftLabels}>
        <Text style={styles.driftText}>early</Text>
        <Text style={styles.driftText}>grid</Text>
        <Text style={styles.driftText}>late</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  label: {
    position: 'absolute',
    width: 80,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
    fontVariant: ['tabular-nums'],
  },
  ruler: { position: 'absolute', left: 0, top: 0, bottom: 0, width: RULER_WIDTH },
  rulerSpine: {
    position: 'absolute',
    left: 50,
    width: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  rulerRow: { position: 'absolute', left: 10, height: 22, flexDirection: 'row', alignItems: 'center', gap: 6 },
  rulerLabel: {
    width: 26,
    textAlign: 'right',
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  rulerLabelOff: { color: 'rgba(255,255,255,0.22)', textDecorationLine: 'line-through' },
  rulerTick: { width: 8, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.3)' },
  rulerTickOff: { backgroundColor: 'rgba(255,255,255,0.12)' },
  centerGuide: {
    position: 'absolute',
    left: '50%',
    marginLeft: -0.5,
    top: PITCH_TOP,
    bottom: PITCH_BOTTOM_INSET,
    width: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  driftRuler: { position: 'absolute', left: 20, right: 20, bottom: 46, height: 26 },
  driftLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 4,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  driftCenterTick: {
    position: 'absolute',
    left: '50%',
    marginLeft: -0.5,
    top: 0,
    width: StyleSheet.hairlineWidth,
    height: 10,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  driftLabels: { position: 'absolute', left: 0, right: 0, top: 10, flexDirection: 'row', justifyContent: 'space-between' },
  driftText: { color: 'rgba(255,255,255,0.4)', fontSize: 10, letterSpacing: 1 },
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
  panelTitle: { color: '#fff', fontSize: 20, fontWeight: '700', letterSpacing: 0.5, marginBottom: 16 },
  panelLabel: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 10,
    alignSelf: 'center',
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, marginBottom: 18 },
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
  deleteBtn: {
    marginTop: 4,
    paddingVertical: 11,
    paddingHorizontal: 28,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(255,90,90,0.7)',
  },
  deleteText: { color: '#ff5a5a', fontSize: 15, fontWeight: '700', letterSpacing: 0.5 },
  deleteRow: { flexDirection: 'row', gap: 10, marginTop: 4, alignItems: 'center' },
  muteBtn: {
    paddingVertical: 11,
    paddingHorizontal: 28,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.45)',
  },
  muteBtnOn: { backgroundColor: '#fff', borderColor: '#fff' },
  muteText: { color: '#fff', fontSize: 15, fontWeight: '700', letterSpacing: 0.5 },
  muteTextOn: { color: '#0a0a0a' },
  actionRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  moveBtn: {
    paddingVertical: 10,
    paddingHorizontal: 22,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  moveText: { color: '#fff', fontSize: 15, fontWeight: '700', letterSpacing: 0.5 },
  panelHint: { color: 'rgba(255,255,255,0.6)', fontSize: 13, marginBottom: 18, textAlign: 'center' },
  confirmRow: { flexDirection: 'row', gap: 12 },
  cancelBtn: {
    paddingVertical: 11,
    paddingHorizontal: 26,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  cancelText: { color: '#ddd', fontSize: 15, fontWeight: '700', letterSpacing: 0.5 },
  confirmBtn: {
    paddingVertical: 11,
    paddingHorizontal: 30,
    borderRadius: 12,
    backgroundColor: '#54f2b0',
  },
  confirmDisabled: { backgroundColor: 'rgba(84,242,176,0.3)' },
  confirmText: { color: '#0a0a0a', fontSize: 15, fontWeight: '700', letterSpacing: 0.5 },
  radialGhost: {
    position: 'absolute',
    width: BODY_R * 2,
    height: BODY_R * 2,
    borderRadius: BODY_R,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.55)',
  },
  radialChip: {
    position: 'absolute',
    width: 60,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(14,14,16,0.96)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  radialChipOn: { backgroundColor: '#fff', borderColor: '#fff' },
  radialChipText: { color: '#fff', fontSize: 15, fontWeight: '700', letterSpacing: 0.3 },
  radialChipTextOn: { color: '#0a0a0a' },
  radialChipDanger: { borderColor: 'rgba(255,90,90,0.75)' },
  radialChipDangerOn: { backgroundColor: '#ff5a5a', borderColor: '#ff5a5a' },
  radialChipDangerText: { color: '#ff5a5a', fontSize: 18 },
  radialChipDangerTextOn: { color: '#0a0a0a', fontSize: 18 },
  layBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 44,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 20,
  },
  layIconBtn: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  layIconDisabled: { opacity: 0.35 },
  layIconText: { fontSize: 24, fontWeight: '800', marginTop: -1 },
  layDoneBtn: { backgroundColor: 'rgba(14,14,16,0.92)', borderColor: 'rgba(255,255,255,0.4)' },
  layDoneText: { color: '#fff' },
  layCancelBtn: { backgroundColor: 'rgba(14,14,16,0.92)', borderColor: 'rgba(255,255,255,0.4)' },
  layCancelText: { color: '#fff' },
});
