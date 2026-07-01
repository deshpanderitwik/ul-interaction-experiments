import { Canvas, Fill, Path, Shader, Skia, useClock } from '@shopify/react-native-skia';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useDerivedValue, useSharedValue } from 'react-native-reanimated';

// Fence · Rung 2 — Combine.
// A modular synth for shaping functions. Double-tap opens a radial of tools;
// tap one to drop it into the chain. Between consecutive nodes sits an OPERATOR
// (a small point on the line) that decides how the next node joins: Chain (the
// default — compose, feeding the running value into the next tool) or an
// arithmetic merge (Add/Mult/Min/Max/Mix, which branch the next tool off the
// original x and combine). Long-press a node OR an operator to open it; swap to
// change its type; nodes can also be deleted and tuned. Drag nodes to arrange.
const TOOLS = ['Linear', 'Step', 'Smooth', 'Fract', 'Sin', 'Pow', 'Abs'];
const OPERATORS = ['Chain', 'Add', 'Mult', 'Min', 'Max', 'Mix'];
const OP_SHORT = ['∘', '+', '×', 'mn', 'mx', '~'];
const MAX = 8;
const RADIAL_R = 96;

function angleFor(i: number, count: number): number {
  return -Math.PI / 2 + (i * 2 * Math.PI) / count;
}

const source = Skia.RuntimeEffect.Make(`
uniform float2 u_resolution;
uniform float u_time;
uniform float u_count;
uniform float u_tools[${MAX}];
uniform float u_params[${MAX}];
uniform float u_ops[${MAX}];   // op joining node i to the running value (i>=1)
uniform float u_mode;          // 0 = field, 1 = sphere

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

// Run x through the chain. The first node composes on x; each later node joins
// the running value via its operator.
float chainValue(float x) {
  float v = x;
  for (int i = 0; i < ${MAX}; i++) {
    if (float(i) >= u_count) { break; }
    if (i == 0) {
      v = applyTool(v, u_tools[i], u_params[i], u_time);
    } else {
      float op = u_ops[i];
      if (op < 0.5) {
        v = applyTool(v, u_tools[i], u_params[i], u_time); // chain (compose)
      } else {
        float b = applyTool(x, u_tools[i], u_params[i], u_time); // branch off x
        if (op < 1.5) { v = clamp(v + b, 0.0, 1.0); }  // add
        else if (op < 2.5) { v = v * b; }               // mult
        else if (op < 3.5) { v = min(v, b); }           // min
        else if (op < 4.5) { v = max(v, b); }           // max
        else { v = mix(v, b, 0.5); }                    // mix
      }
    }
  }
  return clamp(v, 0.0, 1.0);
}

half3 shadeField(float2 fc) {
  float2 uv = fc / u_resolution;
  float y = 1.0 - uv.y;
  float fx = chainValue(uv.x);
  half3 col = mix(half3(0.04, 0.06, 0.11), half3(0.30, 0.66, 0.92), fx);
  float axes = smoothstep(0.004, 0.0, abs(uv.x - 0.5)) + smoothstep(0.004, 0.0, abs(y - 0.5));
  col += half3(0.05, 0.06, 0.09) * axes;
  float line = smoothstep(0.016, 0.0, abs(y - fx));
  col = mix(col, half3(1.0, 0.94, 0.6), line);
  return col;
}

half3 shadeSphere(float2 fc) {
  float2 uv = (fc - 0.5 * u_resolution) / u_resolution.y;
  float r = length(uv);
  float radius = 0.34;
  float mask = smoothstep(radius, radius - 0.006, r);
  float sph = sqrt(max(0.0, 1.0 - (r / radius) * (r / radius)));
  float sx = clamp(uv.x / radius * 0.5 + 0.5, 0.0, 1.0);
  float fx = chainValue(sx);
  half3 grad = mix(half3(0.04, 0.06, 0.11), half3(0.30, 0.66, 0.92), fx) * (0.55 + 0.45 * sph);
  return mix(half3(0.02, 0.03, 0.05), grad, mask);
}

half3 shadeAt(float2 fc) {
  if (u_mode < 0.5) { return shadeField(fc); }
  return shadeSphere(fc);
}

half4 main(float2 fragcoord) {
  half3 c = shadeAt(fragcoord + float2(0.125, 0.375));
  c += shadeAt(fragcoord + float2(0.375, -0.125));
  c += shadeAt(fragcoord + float2(-0.125, -0.375));
  c += shadeAt(fragcoord + float2(-0.375, 0.125));
  return half4(c * 0.25, 1.0);
}
`)!;

type Node = { id: number; tool: number; param: number; x: number; y: number; op: number };
type Target = { kind: 'node' | 'op'; idx: number };

export default function FenceCombine() {
  const { width, height } = useWindowDimensions();
  const clock = useClock();

  const [chain, setChain] = useState<Node[]>([]);
  const [settingsTarget, setSettingsTarget] = useState<Target | null>(null);
  const [radialShown, setRadialShown] = useState(false);
  const [radialCenter, setRadialCenter] = useState({ x: 0, y: 0 });
  const [radialKind, setRadialKind] = useState<'tool' | 'op'>('tool');
  const [renderMode, setRenderMode] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const modeSV = useSharedValue(0);
  const selectMode = (i: number) => {
    setRenderMode(i);
    modeSV.value = i;
    setMenuOpen(false);
  };

  const nextId = useRef(1);
  const radialRef = useRef({ x: 0, y: 0 });
  const radialKindRef = useRef<'tool' | 'op'>('tool');
  const replaceRef = useRef<Target | null>(null);
  const chainRef = useRef<Node[]>([]);
  chainRef.current = chain;

  // Midpoint of the connector before node i (the operator's position).
  const opPos = (i: number) => ({
    x: (chain[i - 1].x + chain[i].x) / 2,
    y: (chain[i - 1].y + chain[i].y) / 2,
  });

  const chainSV = useSharedValue<{ tool: number; param: number; op: number }[]>([]);
  useEffect(() => {
    chainSV.value = chain.map((c) => ({ tool: c.tool, param: c.param, op: c.op }));
  }, [chain, chainSV]);

  const uniforms = useDerivedValue(() => {
    const c = chainSV.value;
    const tools: number[] = [];
    const params: number[] = [];
    const ops: number[] = [];
    for (let i = 0; i < MAX; i++) {
      if (i < c.length) {
        tools.push(c[i].tool);
        params.push(c[i].param);
        ops.push(c[i].op);
      } else {
        tools.push(0);
        params.push(0);
        ops.push(0);
      }
    }
    return {
      u_resolution: [width, height],
      u_time: clock.value / 1000,
      u_count: Math.min(c.length, MAX),
      u_tools: tools,
      u_params: params,
      u_ops: ops,
      u_mode: modeSV.value,
    };
  });

  const linePath = useMemo(() => {
    const p = Skia.Path.Make();
    if (chain.length > 0) {
      p.moveTo(chain[0].x, chain[0].y);
      for (let i = 1; i < chain.length; i++) p.lineTo(chain[i].x, chain[i].y);
    }
    return p;
  }, [chain]);

  // ---- actions ----
  const showRadial = (kind: 'tool' | 'op', x: number, y: number) => {
    radialKindRef.current = kind;
    setRadialKind(kind);
    radialRef.current = { x, y };
    setRadialCenter({ x, y });
    setRadialShown(true);
  };
  const dismissRadial = () => {
    replaceRef.current = null;
    setRadialShown(false);
  };
  const startAdd = (x: number, y: number) => {
    replaceRef.current = null;
    showRadial('tool', x, y);
  };
  // Tap a ring item: add/replace a tool, or set an operator, depending on kind.
  const pick = (i: number) => {
    const rep = replaceRef.current;
    if (radialKindRef.current === 'op') {
      if (rep && rep.kind === 'op') {
        setChain((prev) => prev.map((c, j) => (j === rep.idx ? { ...c, op: i } : c)));
      }
    } else if (rep && rep.kind === 'node') {
      setChain((prev) => prev.map((c, j) => (j === rep.idx ? { ...c, tool: i, param: 0.5 } : c)));
    } else if (chainRef.current.length < MAX) {
      const { x, y } = radialRef.current;
      setChain((prev) => [...prev, { id: nextId.current++, tool: i, param: 0.5, x, y, op: 0 }]);
    }
    replaceRef.current = null;
    setRadialShown(false);
  };
  // Long-press a node → its settings panel.
  const openSettings = (x: number, y: number) => {
    const c = chainRef.current;
    let node = -1;
    c.forEach((n, i) => {
      if (Math.hypot(x - n.x, y - n.y) <= 44) node = i;
    });
    if (node >= 0) setSettingsTarget({ kind: 'node', idx: node });
  };
  const openReplace = (target: Target) => {
    const c = chainRef.current;
    replaceRef.current = target;
    setSettingsTarget(null);
    if (target.kind === 'node') {
      const n = c[target.idx];
      showRadial('tool', n.x, n.y);
    } else {
      const mx = (c[target.idx - 1].x + c[target.idx].x) / 2;
      const my = (c[target.idx - 1].y + c[target.idx].y) / 2;
      showRadial('op', mx, my);
    }
  };
  const setParam = (idx: number, p: number) => {
    setChain((prev) => prev.map((c, i) => (i === idx ? { ...c, param: p } : c)));
  };
  const deleteNode = (idx: number) => {
    setChain((prev) => prev.filter((_, i) => i !== idx));
    setSettingsTarget(null);
  };

  // ---- drag a node ----
  const draggingRef = useRef<{ idx: number; dx: number; dy: number } | null>(null);
  const startDrag = (x: number, y: number) => {
    let hit = -1;
    chainRef.current.forEach((c, i) => {
      if (Math.hypot(x - c.x, y - c.y) <= 44) hit = i;
    });
    draggingRef.current =
      hit >= 0 ? { idx: hit, dx: x - chainRef.current[hit].x, dy: y - chainRef.current[hit].y } : null;
  };
  const dragMove = (x: number, y: number) => {
    const d = draggingRef.current;
    if (!d) return;
    const nx = Math.max(30, Math.min(width - 30, x - d.dx));
    const ny = Math.max(44, Math.min(height - 44, y - d.dy));
    setChain((prev) => prev.map((c, i) => (i === d.idx ? { ...c, x: nx, y: ny } : c)));
  };
  const endDrag = () => {
    draggingRef.current = null;
  };

  // ---- gestures ----
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(300)
    .onEnd((e) => {
      runOnJS(startAdd)(e.x, e.y);
    });
  const longPress = Gesture.LongPress()
    .minDuration(300)
    .onStart((e) => {
      runOnJS(openSettings)(e.x, e.y);
    });
  const dragPan = Gesture.Pan()
    .minDistance(6)
    .onBegin((e) => {
      runOnJS(startDrag)(e.x, e.y);
    })
    .onUpdate((e) => {
      runOnJS(dragMove)(e.x, e.y);
    })
    .onFinalize(() => {
      runOnJS(endDrag)();
    });
  const gesture = Gesture.Race(dragPan, longPress, doubleTap);

  const ringItems = radialKind === 'op' ? OPERATORS : TOOLS;

  // Settings panel data for the current target.
  let panel: null | {
    title: string;
    x: number;
    hasParam: boolean;
    param: number;
    onDelete?: () => void;
  } = null;
  if (settingsTarget) {
    const n = chain[settingsTarget.idx];
    if (n && settingsTarget.kind === 'node') {
      panel = {
        title: `${settingsTarget.idx + 1}. ${TOOLS[n.tool]}`,
        x: n.x,
        hasParam: n.tool !== 0 && n.tool !== 6,
        param: n.param,
        onDelete: () => deleteNode(settingsTarget.idx),
      };
    } else if (n && settingsTarget.kind === 'op') {
      const p = opPos(settingsTarget.idx);
      panel = { title: `operator · ${OPERATORS[n.op]}`, x: p.x, hasParam: false, param: 0 };
    }
  }

  return (
    <View style={styles.fill}>
      <GestureDetector gesture={gesture}>
        <View style={StyleSheet.absoluteFill}>
          {chain.length > 0 ? (
            <Canvas style={StyleSheet.absoluteFill}>
              <Fill>
                <Shader source={source} uniforms={uniforms} />
              </Fill>
              <Path path={linePath} style="stroke" strokeWidth={2} color="rgba(255,255,255,0.5)" />
            </Canvas>
          ) : null}

          {/* operator points (between nodes) — tap one to open its radial */}
          {chain.map((c, i) =>
            i === 0 ? null : (
              <Pressable
                key={`op-${c.id}`}
                hitSlop={10}
                onPress={() => openReplace({ kind: 'op', idx: i })}
                style={[
                  styles.op,
                  { left: opPos(i).x - 15, top: opPos(i).y - 15 },
                  settingsTarget?.kind === 'op' && settingsTarget.idx === i && styles.opActive,
                ]}
              >
                <Text style={styles.opText}>{OP_SHORT[c.op]}</Text>
              </Pressable>
            )
          )}

          {/* node chips */}
          {chain.map((c, i) => (
            <View
              key={c.id}
              pointerEvents="none"
              style={[
                styles.chip,
                { left: c.x - 26, top: c.y - 20 },
                settingsTarget?.kind === 'node' && settingsTarget.idx === i && styles.chipActive,
              ]}
            >
              <Text style={styles.chipIndex}>{i + 1}</Text>
              <Text style={styles.chipLabel}>{TOOLS[c.tool]}</Text>
            </View>
          ))}
        </View>
      </GestureDetector>

      {chain.length === 0 && !radialShown ? (
        <Text style={styles.hint} pointerEvents="none">
          double-tap to add a tool
        </Text>
      ) : null}

      {/* gear: switch background rendering */}
      <Pressable style={styles.gear} hitSlop={10} onPress={() => setMenuOpen((o) => !o)}>
        <Text style={styles.gearIcon}>⚙</Text>
      </Pressable>
      {menuOpen ? (
        <>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenuOpen(false)} />
          <View style={styles.menu}>
            <Text style={styles.menuHeader}>Background</Text>
            {['Field', 'Sphere'].map((label, i) => {
              const on = renderMode === i;
              return (
                <Pressable
                  key={label}
                  onPress={() => selectMode(i)}
                  style={[styles.menuItem, on && styles.menuItemOn]}
                >
                  <Text style={[styles.menuText, on && styles.menuTextOn]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}

      {/* radial picker (tools or operators) */}
      {radialShown ? (
        <>
          <Pressable style={StyleSheet.absoluteFill} onPress={dismissRadial} />
          {ringItems.map((label, i) => {
            const theta = angleFor(i, ringItems.length);
            return (
              <Pressable
                key={label}
                onPress={() => pick(i)}
                style={[
                  styles.ringTool,
                  {
                    left: radialCenter.x + RADIAL_R * Math.cos(theta) - 30,
                    top: radialCenter.y + RADIAL_R * Math.sin(theta) - 22,
                  },
                ]}
              >
                <Text style={styles.ringToolText}>{label}</Text>
              </Pressable>
            );
          })}
        </>
      ) : null}

      {/* settings panel (node or operator) */}
      {panel ? (
        <>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setSettingsTarget(null)} />
          <Settings
            title={panel.title}
            nodeX={panel.x}
            nodeY={settingsTarget ? (settingsTarget.kind === 'node' ? chain[settingsTarget.idx].y : opPos(settingsTarget.idx).y) : 0}
            screenW={width}
            hasParam={panel.hasParam}
            param={panel.param}
            onParam={(p) => settingsTarget && setParam(settingsTarget.idx, p)}
            onSwap={() => settingsTarget && openReplace(settingsTarget)}
            onDelete={panel.onDelete}
          />
        </>
      ) : null}
    </View>
  );
}

const TRACK_W = 190;

function Settings({
  title,
  nodeX,
  nodeY,
  screenW,
  hasParam,
  param,
  onParam,
  onSwap,
  onDelete,
}: {
  title: string;
  nodeX: number;
  nodeY: number;
  screenW: number;
  hasParam: boolean;
  param: number;
  onParam: (p: number) => void;
  onSwap: () => void;
  onDelete?: () => void;
}) {
  const PANEL_W = 240;
  const left = Math.max(12, Math.min(screenW - PANEL_W - 12, nodeX - PANEL_W / 2));
  const top = Math.max(80, nodeY + 34);

  const setFromX = (x: number) => onParam(Math.max(0, Math.min(1, x / TRACK_W)));
  const track = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => runOnJS(setFromX)(e.x))
    .onUpdate((e) => runOnJS(setFromX)(e.x));

  return (
    <View style={[styles.panel, { left, top, width: PANEL_W }]}>
      <View style={styles.panelHead}>
        <Text style={styles.panelTitle}>{title}</Text>
        <View style={styles.headBtns}>
          <Pressable onPress={onSwap} hitSlop={6} style={styles.iconBtn}>
            <Text style={styles.swapIcon}>⇄</Text>
          </Pressable>
          {onDelete ? (
            <Pressable onPress={onDelete} hitSlop={6} style={[styles.iconBtn, styles.iconBtnDanger]}>
              <View style={styles.trash}>
                <View style={styles.trashHandle} />
                <View style={styles.trashLid} />
                <View style={styles.trashBody} />
              </View>
            </Pressable>
          ) : null}
        </View>
      </View>
      {hasParam ? (
        <GestureDetector gesture={track}>
          <View style={styles.trackWrap}>
            <View style={styles.track} />
            <View style={[styles.trackFill, { width: param * TRACK_W }]} />
            <View style={[styles.thumb, { left: param * TRACK_W - 9 }]} />
          </View>
        </GestureDetector>
      ) : (
        <Text style={styles.noParam}>swap to change · tap outside to close</Text>
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
  gear: {
    position: 'absolute',
    top: 56,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  gearIcon: { color: '#fff', fontSize: 18 },
  menu: {
    position: 'absolute',
    top: 102,
    right: 20,
    minWidth: 150,
    borderRadius: 12,
    backgroundColor: 'rgba(24,24,30,0.98)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
    padding: 6,
  },
  menuHeader: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    paddingHorizontal: 10,
    paddingTop: 4,
    paddingBottom: 6,
    textTransform: 'uppercase',
  },
  menuItem: { paddingVertical: 10, paddingHorizontal: 10, borderRadius: 8 },
  menuItemOn: { backgroundColor: '#9b8cff' },
  menuText: { color: '#e6e6ee', fontSize: 15, fontWeight: '600' },
  menuTextOn: { color: '#0b0b14' },
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
  op: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(40,34,60,0.95)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(155,140,255,0.6)',
  },
  opActive: { borderColor: '#9b8cff', borderWidth: 1.5 },
  opText: { color: '#cdbcff', fontSize: 12, fontWeight: '700' },
  ringTool: {
    position: 'absolute',
    width: 60,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    backgroundColor: 'rgba(16,16,22,0.95)',
    borderColor: 'rgba(255,255,255,0.4)',
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
  headBtns: { flexDirection: 'row', gap: 8 },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  iconBtnDanger: { backgroundColor: 'rgba(204,59,59,0.9)', borderColor: 'transparent' },
  swapIcon: { color: '#fff', fontSize: 18, fontWeight: '600', marginTop: -1 },
  trash: { alignItems: 'center' },
  trashHandle: { width: 6, height: 1.5, borderRadius: 1, backgroundColor: '#fff', marginBottom: 1 },
  trashLid: { width: 14, height: 2, borderRadius: 1, backgroundColor: '#fff' },
  trashBody: {
    width: 10,
    height: 9,
    marginTop: 1.5,
    borderWidth: 1.5,
    borderTopWidth: 0,
    borderColor: '#fff',
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
  },
  trackWrap: { height: 24, justifyContent: 'center' },
  track: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.18)' },
  trackFill: { position: 'absolute', height: 4, borderRadius: 2, backgroundColor: '#9b8cff' },
  thumb: { position: 'absolute', width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff' },
  noParam: { color: 'rgba(255,255,255,0.5)', fontSize: 12, fontStyle: 'italic' },
});
