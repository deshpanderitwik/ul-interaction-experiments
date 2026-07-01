import { Canvas, Fill, Path, Shader, Skia, useClock } from '@shopify/react-native-skia';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

// Fence · Rung 2 — Combine.
// A modular synth for shaping functions. Press & hold anywhere to open a radial
// of tools; release on one to drop it into the chain at that spot. Tools are
// CHAINED in add-order (each feeds the next), and lines are drawn between the
// chips to show the order. Double-tap a chip to open its settings (a parameter
// slider + Delete). The combined result is the live shader in the background.
const TOOLS = ['Linear', 'Step', 'Smooth', 'Fract', 'Sin', 'Pow', 'Abs'];
const MAX = 8;
const RADIAL_R = 96;
const DEADZONE = 26;

function angleFor(i: number): number {
  return -Math.PI / 2 + (i * 2 * Math.PI) / TOOLS.length;
}

const source = Skia.RuntimeEffect.Make(`
uniform float2 u_resolution;
uniform float u_time;
uniform float u_count;
uniform float u_tools[${MAX}];
uniform float u_params[${MAX}];

float applyTool(float x, float tool, float p, float time) {
  if (tool < 0.5) {
    return x;                                     // linear
  } else if (tool < 1.5) {
    return step(mix(0.15, 0.85, p), x);           // step
  } else if (tool < 2.5) {
    float w = 0.02 + p * 0.4;                      // smoothstep
    return smoothstep(0.5 - w, 0.5 + w, x);
  } else if (tool < 3.5) {
    return fract(x * (1.0 + p * 7.0));            // fract
  } else if (tool < 4.5) {
    float fr = 0.5 + p * 5.5;                      // sin
    return 0.5 + 0.5 * sin(x * fr * 6.2831 + time);
  } else if (tool < 5.5) {
    return pow(x, mix(0.25, 4.0, p));            // pow
  } else {
    return abs(x * 2.0 - 1.0);                    // abs
  }
}

half4 main(float2 fragcoord) {
  float2 uv = fragcoord / u_resolution;
  float y = 1.0 - uv.y;

  // Chain the tools in order: each one's output is the next one's input.
  float v = uv.x;
  for (int i = 0; i < ${MAX}; i++) {
    if (float(i) >= u_count) { break; }
    v = applyTool(v, u_tools[i], u_params[i], u_time);
  }
  float fx = clamp(v, 0.0, 1.0);

  half3 col = mix(half3(0.04, 0.06, 0.11), half3(0.30, 0.66, 0.92), fx);
  float axes = smoothstep(0.004, 0.0, abs(uv.x - 0.5)) + smoothstep(0.004, 0.0, abs(y - 0.5));
  col += half3(0.05, 0.06, 0.09) * axes;
  float line = smoothstep(0.016, 0.0, abs(y - fx));
  col = mix(col, half3(1.0, 0.94, 0.6), line);
  return half4(col, 1.0);
}
`)!;

type Node = { id: number; tool: number; param: number; x: number; y: number };

export default function FenceCombine() {
  const { width, height } = useWindowDimensions();
  const clock = useClock();

  const [chain, setChain] = useState<Node[]>([]);
  const [settingsIdx, setSettingsIdx] = useState<number | null>(null);
  const [radialShown, setRadialShown] = useState(false);
  const [radialCenter, setRadialCenter] = useState({ x: 0, y: 0 });

  const nextId = useRef(1);
  const radialRef = useRef({ x: 0, y: 0 });
  const chainRef = useRef<Node[]>([]);
  chainRef.current = chain;

  const centerX = useSharedValue(0);
  const centerY = useSharedValue(0);
  const selected = useSharedValue(-1);

  // Mirror the chain into a shared value for the shader uniforms.
  const chainSV = useSharedValue<{ tool: number; param: number }[]>([]);
  useEffect(() => {
    chainSV.value = chain.map((c) => ({ tool: c.tool, param: c.param }));
  }, [chain, chainSV]);

  const uniforms = useDerivedValue(() => {
    const c = chainSV.value;
    const tools: number[] = [];
    const params: number[] = [];
    for (let i = 0; i < MAX; i++) {
      if (i < c.length) {
        tools.push(c[i].tool);
        params.push(c[i].param);
      } else {
        tools.push(0);
        params.push(0);
      }
    }
    return {
      u_resolution: [width, height],
      u_time: clock.value / 1000,
      u_count: Math.min(c.length, MAX),
      u_tools: tools,
      u_params: params,
    };
  });

  // Lines connecting the chips in chain order.
  const linePath = useMemo(() => {
    const p = Skia.Path.Make();
    if (chain.length > 0) {
      p.moveTo(chain[0].x, chain[0].y);
      for (let i = 1; i < chain.length; i++) p.lineTo(chain[i].x, chain[i].y);
    }
    return p;
  }, [chain]);

  // ---- actions (JS thread) ----
  const showRadial = (x: number, y: number) => {
    radialRef.current = { x, y };
    setRadialCenter({ x, y });
    setRadialShown(true);
  };
  const hideRadial = () => setRadialShown(false);
  const commitRadial = (sel: number) => {
    if (sel >= 0 && sel < TOOLS.length && chainRef.current.length < MAX) {
      const { x, y } = radialRef.current;
      setChain((prev) => [...prev, { id: nextId.current++, tool: sel, param: 0.5, x, y }]);
    }
  };
  const onDoubleTap = (x: number, y: number) => {
    let hit = -1;
    chainRef.current.forEach((c, i) => {
      if (Math.hypot(x - c.x, y - c.y) <= 44) hit = i;
    });
    if (hit >= 0) setSettingsIdx(hit);
  };
  const setParam = (idx: number, p: number) => {
    setChain((prev) => prev.map((c, i) => (i === idx ? { ...c, param: p } : c)));
  };
  const deleteTool = (idx: number) => {
    setChain((prev) => prev.filter((_, i) => i !== idx));
    setSettingsIdx(null);
  };

  // ---- gestures ----
  const pan = Gesture.Pan()
    .activateAfterLongPress(220)
    .onStart((e) => {
      centerX.value = e.x;
      centerY.value = e.y;
      selected.value = -1;
      runOnJS(showRadial)(e.x, e.y);
    })
    .onUpdate((e) => {
      const dx = e.x - centerX.value;
      const dy = e.y - centerY.value;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < DEADZONE) {
        selected.value = -1;
        return;
      }
      const ang = Math.atan2(dy, dx);
      let best = -1;
      let bestDiff = 10;
      for (let i = 0; i < TOOLS.length; i++) {
        const theta = -Math.PI / 2 + (i * 2 * Math.PI) / TOOLS.length;
        let d = ang - theta;
        d = Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
        if (d < bestDiff) {
          bestDiff = d;
          best = i;
        }
      }
      selected.value = best;
    })
    .onEnd(() => {
      runOnJS(commitRadial)(selected.value);
    })
    .onFinalize(() => {
      selected.value = -1;
      runOnJS(hideRadial)();
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(300)
    .onEnd((e) => {
      runOnJS(onDoubleTap)(e.x, e.y);
    });

  const gesture = Gesture.Exclusive(doubleTap, pan);

  const editing = settingsIdx != null ? chain[settingsIdx] : null;

  return (
    <View style={styles.fill}>
      <GestureDetector gesture={gesture}>
        <View style={StyleSheet.absoluteFill}>
          <Canvas style={StyleSheet.absoluteFill}>
            <Fill>
              <Shader source={source} uniforms={uniforms} />
            </Fill>
            <Path path={linePath} style="stroke" strokeWidth={2} color="rgba(255,255,255,0.5)" />
          </Canvas>

          {/* chain chips (visual only) */}
          {chain.map((c, i) => (
            <View
              key={c.id}
              pointerEvents="none"
              style={[styles.chip, { left: c.x - 26, top: c.y - 20 }, settingsIdx === i && styles.chipActive]}
            >
              <Text style={styles.chipIndex}>{i + 1}</Text>
              <Text style={styles.chipLabel}>{TOOLS[c.tool]}</Text>
            </View>
          ))}

          {/* radial tool picker */}
          {radialShown ? (
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              {TOOLS.map((label, i) => {
                const theta = angleFor(i);
                return (
                  <RingTool
                    key={i}
                    index={i}
                    x={radialCenter.x + RADIAL_R * Math.cos(theta) - 30}
                    y={radialCenter.y + RADIAL_R * Math.sin(theta) - 22}
                    label={label}
                    selected={selected}
                  />
                );
              })}
            </View>
          ) : null}
        </View>
      </GestureDetector>

      {chain.length === 0 && !radialShown ? (
        <Text style={styles.hint} pointerEvents="none">
          press &amp; hold to add a tool
        </Text>
      ) : null}

      {/* settings popover (interactive, above the gesture layer) */}
      {editing ? (
        <>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setSettingsIdx(null)} />
          <Settings
            node={editing}
            index={settingsIdx as number}
            screenW={width}
            onParam={(p) => setParam(settingsIdx as number, p)}
            onDelete={() => deleteTool(settingsIdx as number)}
          />
        </>
      ) : null}
    </View>
  );
}

function RingTool({
  index,
  x,
  y,
  label,
  selected,
}: {
  index: number;
  x: number;
  y: number;
  label: string;
  selected: SharedValue<number>;
}) {
  const style = useAnimatedStyle(() => {
    const on = selected.value === index;
    return {
      backgroundColor: on ? '#9b8cff' : 'rgba(16,16,22,0.92)',
      borderColor: on ? '#ffffff' : 'rgba(255,255,255,0.3)',
      transform: [{ scale: withTiming(on ? 1.22 : 1, { duration: 90 }) }],
    };
  });
  return (
    <Animated.View style={[styles.ringTool, { left: x, top: y }, style]}>
      <Text style={styles.ringToolText}>{label}</Text>
    </Animated.View>
  );
}

const TRACK_W = 190;

function Settings({
  node,
  index,
  screenW,
  onParam,
  onDelete,
}: {
  node: Node;
  index: number;
  screenW: number;
  onParam: (p: number) => void;
  onDelete: () => void;
}) {
  const PANEL_W = 232;
  const left = Math.max(12, Math.min(screenW - PANEL_W - 12, node.x - PANEL_W / 2));
  const top = Math.max(80, node.y + 34);
  const hasParam = node.tool !== 0 && node.tool !== 6; // linear & abs have none

  const setFromX = (x: number) => onParam(Math.max(0, Math.min(1, x / TRACK_W)));
  const track = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => runOnJS(setFromX)(e.x))
    .onUpdate((e) => runOnJS(setFromX)(e.x));

  return (
    <View style={[styles.panel, { left, top, width: PANEL_W }]}>
      <View style={styles.panelHead}>
        <Text style={styles.panelTitle}>
          {index + 1}. {TOOLS[node.tool]}
        </Text>
        <Pressable onPress={onDelete} hitSlop={8} style={styles.del}>
          <Text style={styles.delText}>Delete</Text>
        </Pressable>
      </View>
      {hasParam ? (
        <GestureDetector gesture={track}>
          <View style={styles.trackWrap}>
            <View style={styles.track} />
            <View style={[styles.trackFill, { width: node.param * TRACK_W }]} />
            <View style={[styles.thumb, { left: node.param * TRACK_W - 9 }]} />
          </View>
        </GestureDetector>
      ) : (
        <Text style={styles.noParam}>no parameter</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  hint: {
    position: 'absolute',
    top: 70,
    alignSelf: 'center',
    color: 'rgba(255,255,255,0.55)',
    fontSize: 15,
    letterSpacing: 0.5,
  },
  chip: {
    position: 'absolute',
    width: 52,
    minHeight: 40,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 5,
    backgroundColor: 'rgba(16,16,22,0.9)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  chipActive: { borderColor: '#9b8cff', borderWidth: 1.5 },
  chipIndex: { color: '#9b8cff', fontSize: 10, fontWeight: '700' },
  chipLabel: { color: '#fff', fontSize: 12, fontWeight: '600' },
  ringTool: {
    position: 'absolute',
    width: 60,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  ringToolText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  panel: {
    position: 'absolute',
    borderRadius: 14,
    backgroundColor: 'rgba(24,24,30,0.98)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
    padding: 14,
  },
  panelHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  panelTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
  del: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: 'rgba(204,59,59,0.9)',
  },
  delText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  trackWrap: { height: 24, justifyContent: 'center' },
  track: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.18)' },
  trackFill: {
    position: 'absolute',
    height: 4,
    borderRadius: 2,
    backgroundColor: '#9b8cff',
  },
  thumb: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#fff',
  },
  noParam: { color: 'rgba(255,255,255,0.5)', fontSize: 13, fontStyle: 'italic' },
});
