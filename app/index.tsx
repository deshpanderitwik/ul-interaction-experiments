import {
  Canvas,
  Circle,
  Fill,
  RadialGradient,
  useClock,
  vec,
} from '@shopify/react-native-skia';
import { Link, Stack } from 'expo-router';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useDerivedValue } from 'react-native-reanimated';
import UpdateButton from '../components/UpdateButton';
import { sketches } from '../sketches/registry';
import type { Sketch } from '../sketches/types';

// per-card accent palette — each sketch gets its own colour so the cards read
// as distinct
const ACCENTS = [
  '#6c5ce7',
  '#00d2a8',
  '#3b5bff',
  '#ff7a00',
  '#ff2d6b',
  '#b14bff',
  '#21d4fd',
  '#ffd23f',
];

// '#rrggbb' + alpha → rgba() string
function tint(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// A slow, shifting aurora gradient drawn in Skia — kept very dark/subtle here,
// just faint hints of colour drifting on near-black. Skia is already in the
// native build, so this ships over-the-air.
function ShiftingBackdrop() {
  const { width: W, height: H } = useWindowDimensions();
  const clock = useClock();
  const R = Math.max(W, H) * 0.85;

  const cA = useDerivedValue(() =>
    vec(
      W * 0.28 + Math.sin(clock.value * 0.00021) * W * 0.18,
      H * 0.2 + Math.cos(clock.value * 0.00017) * H * 0.1,
    ),
  );
  const cB = useDerivedValue(() =>
    vec(
      W * 0.8 + Math.sin(clock.value * 0.00016 + 2) * W * 0.16,
      H * 0.34 + Math.cos(clock.value * 0.00023 + 1) * H * 0.12,
    ),
  );
  const cC = useDerivedValue(() =>
    vec(
      W * 0.45 + Math.sin(clock.value * 0.00013 + 4) * W * 0.2,
      H * 0.74 + Math.cos(clock.value * 0.00019 + 3) * H * 0.14,
    ),
  );
  const cD = useDerivedValue(() =>
    vec(
      W * 0.62 + Math.sin(clock.value * 0.00011 + 1.5) * W * 0.18,
      H * 0.52 + Math.cos(clock.value * 0.00015 + 2.5) * H * 0.16,
    ),
  );

  return (
    <Canvas style={StyleSheet.absoluteFill}>
      <Fill color="#040405" />
      <Circle c={cA} r={R} opacity={0.16} blendMode="screen">
        <RadialGradient c={cA} r={R} colors={['#6c5ce7', '#6c5ce700']} />
      </Circle>
      <Circle c={cB} r={R} opacity={0.13} blendMode="screen">
        <RadialGradient c={cB} r={R} colors={['#00d2a8', '#00d2a800']} />
      </Circle>
      <Circle c={cC} r={R} opacity={0.14} blendMode="screen">
        <RadialGradient c={cC} r={R} colors={['#3b5bff', '#3b5bff00']} />
      </Circle>
      <Circle c={cD} r={R} opacity={0.09} blendMode="screen">
        <RadialGradient c={cD} r={R} colors={['#b14bff', '#b14bff00']} />
      </Circle>
    </Canvas>
  );
}

// Flatten into display order: each top-level sketch followed by its children,
// so children render indented directly under their parent.
type Row = { sketch: Sketch; child: boolean };
const rows: Row[] = sketches
  .filter((s) => !s.parentId)
  .flatMap((parent) => [
    { sketch: parent, child: false },
    ...sketches
      .filter((s) => s.parentId === parent.id)
      .map((c) => ({ sketch: c, child: true })),
  ]);

export default function Home() {
  return (
    <>
      <Stack.Screen options={{ headerRight: () => <UpdateButton /> }} />
      <View style={styles.root}>
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <ShiftingBackdrop />
        </View>
        <FlatList
          style={styles.list}
          contentContainerStyle={styles.content}
          data={rows}
          keyExtractor={(r) => r.sketch.id}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <Text style={styles.lead}>
              {sketches.length} interaction experiment
              {sketches.length === 1 ? '' : 's'}
            </Text>
          }
          renderItem={({ item, index }) => {
            const accent = ACCENTS[index % ACCENTS.length];
            return (
              <View
                style={
                  item.child
                    ? [styles.childWrap, { borderLeftColor: tint(accent, 0.55) }]
                    : undefined
                }
              >
                <Link href={`/sketch/${item.sketch.id}`} asChild>
                  <Pressable
                    style={({ pressed }) => [
                      styles.card,
                      item.child && styles.cardChild,
                      {
                        backgroundColor: tint(accent, item.child ? 0.06 : 0.09),
                        borderColor: tint(accent, 0.4),
                      },
                      pressed && [
                        styles.cardPressed,
                        { backgroundColor: tint(accent, 0.16) },
                      ],
                    ]}
                  >
                    <View style={styles.titleRow}>
                      <View style={[styles.dot, { backgroundColor: accent }]} />
                      <Text
                        style={[styles.title, item.child && styles.titleChild]}
                      >
                        {item.sketch.title}
                      </Text>
                    </View>
                    <Text style={styles.desc}>{item.sketch.description}</Text>
                  </Pressable>
                </Link>
              </View>
            );
          }}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#040405' },
  list: { flex: 1, backgroundColor: 'transparent' },
  content: { padding: 16, paddingTop: 8 },
  lead: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    marginBottom: 14,
    marginLeft: 4,
  },
  // glass card: accent-tinted translucent fill + accent border + soft shadow
  card: {
    borderRadius: 22,
    borderWidth: 1,
    padding: 18,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
  },
  cardChild: { padding: 14 },
  cardPressed: { transform: [{ scale: 0.985 }] },
  childWrap: {
    marginLeft: 20,
    borderLeftWidth: 2,
    paddingLeft: 12,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  title: { color: '#fff', fontSize: 18, fontWeight: '600' },
  titleChild: { fontSize: 16 },
  desc: { color: 'rgba(255,255,255,0.62)', fontSize: 14, marginTop: 5 },
});
