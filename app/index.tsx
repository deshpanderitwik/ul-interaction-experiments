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

// A slow, shifting aurora gradient drawn in Skia (already in the native build,
// so this ships over-the-air). A handful of large, soft radial blobs drift on
// the dark base; the smoothness is what lets the translucent cards above read
// as glass without a native blur module.
function ShiftingBackdrop() {
  const { width: W, height: H } = useWindowDimensions();
  const clock = useClock();
  const R = Math.max(W, H) * 0.9;

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
      <Fill color="#07070b" />
      <Circle c={cA} r={R} opacity={0.5} blendMode="screen">
        <RadialGradient c={cA} r={R} colors={['#6c5ce7', '#6c5ce700']} />
      </Circle>
      <Circle c={cB} r={R} opacity={0.42} blendMode="screen">
        <RadialGradient c={cB} r={R} colors={['#00d2a8', '#00d2a800']} />
      </Circle>
      <Circle c={cC} r={R} opacity={0.45} blendMode="screen">
        <RadialGradient c={cC} r={R} colors={['#3b5bff', '#3b5bff00']} />
      </Circle>
      <Circle c={cD} r={R} opacity={0.32} blendMode="screen">
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
          renderItem={({ item }) => (
            <View style={item.child ? styles.childWrap : undefined}>
              <Link href={`/sketch/${item.sketch.id}`} asChild>
                <Pressable
                  style={({ pressed }) => [
                    styles.card,
                    item.child && styles.cardChild,
                    pressed && styles.cardPressed,
                  ]}
                >
                  <Text style={[styles.title, item.child && styles.titleChild]}>
                    {item.sketch.title}
                  </Text>
                  <Text style={styles.desc}>{item.sketch.description}</Text>
                </Pressable>
              </Link>
            </View>
          )}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#07070b' },
  list: { flex: 1, backgroundColor: 'transparent' },
  content: { padding: 16, paddingTop: 8 },
  lead: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    marginBottom: 14,
    marginLeft: 4,
  },
  // glass card: translucent fill + hairline border + soft shadow over the gradient
  card: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    padding: 18,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
  },
  cardChild: { backgroundColor: 'rgba(255,255,255,0.04)', padding: 14 },
  cardPressed: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    transform: [{ scale: 0.985 }],
  },
  childWrap: {
    marginLeft: 20,
    borderLeftWidth: 2,
    borderLeftColor: 'rgba(108,92,231,0.45)',
    paddingLeft: 12,
  },
  title: { color: '#fff', fontSize: 18, fontWeight: '600' },
  titleChild: { fontSize: 16 },
  desc: { color: 'rgba(255,255,255,0.62)', fontSize: 14, marginTop: 4 },
});
