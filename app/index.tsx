import { Link } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import UpdateButton from '../components/UpdateButton';
import { sketches } from '../sketches/registry';
import type { Sketch } from '../sketches/types';

// Flatten into display order: each top-level sketch followed by its children,
// so children render indented directly under their parent regardless of where
// they sit in the registry array.
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
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.fill}>
      {/* Own header chrome instead of the native stack bar — see
          components/GlassButton.tsx for why (the native glass header blooms
          bright on every arrival). The Refresh button keeps its glass bubble,
          just drawn in JS so it appears already settled. */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.headerTitle}>Sketches</Text>
        <UpdateButton />
      </View>
      <FlatList
        style={styles.list}
        contentContainerStyle={styles.content}
        data={rows}
        keyExtractor={(r) => r.sketch.id}
        ListHeaderComponent={
          <Text style={styles.lead}>
            {sketches.length} interaction experiment
            {sketches.length === 1 ? '' : 's'}
          </Text>
        }
        renderItem={({ item }) => (
          <View style={item.child ? styles.childWrap : undefined}>
            <Link href={`/sketch/${item.sketch.id}`} asChild>
              <Pressable style={[styles.row, item.child && styles.rowChild]}>
                <Text style={[styles.rowTitle, item.child && styles.rowTitleChild]}>
                  {item.sketch.title}
                </Text>
                <Text style={styles.rowDesc}>{item.sketch.description}</Text>
              </Pressable>
            </Link>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#0b0b0f' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: '700' },
  list: { flex: 1, backgroundColor: '#0b0b0f' },
  content: { padding: 16 },
  lead: { color: '#5a5a6b', fontSize: 13, marginBottom: 12, marginLeft: 4 },
  row: {
    backgroundColor: '#15151d',
    borderRadius: 18,
    padding: 18,
    marginBottom: 12,
  },
  // indent children and give them a subtle left accent + smaller card
  childWrap: {
    marginLeft: 20,
    borderLeftWidth: 2,
    borderLeftColor: '#2a2a40',
    paddingLeft: 12,
  },
  rowChild: { backgroundColor: '#121219', padding: 14 },
  rowTitle: { color: '#fff', fontSize: 18, fontWeight: '600' },
  rowTitleChild: { fontSize: 16 },
  rowDesc: { color: '#8a8a99', fontSize: 14, marginTop: 4 },
});
