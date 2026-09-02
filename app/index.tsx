import { Link, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { FlatList, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLibrary } from '../experiments/recorder/library';
import { experiments } from '../experiments/registry';
import { webExperiments } from '../experiments/web';

// Home menu. Maps over the experiment registry — adding an experiment (or a
// variation) there makes it appear here automatically. Tapping a card pushes
// its host route; variations render indented under their parent.
//
// On the web the menu is filtered to the vetted allowlist (experiments/web.ts)
// and the Recordings library (on-device files) is hidden.
const IS_WEB = Platform.OS === 'web';
const MENU = IS_WEB ? webExperiments(experiments) : experiments;

export default function Home() {
  const insets = useSafeAreaInsets();
  const recordings = useLibrary();
  const router = useRouter();

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <View style={[styles.header, { marginTop: insets.top + 16 }]}>
        <Text style={styles.heading}>Experiments</Text>
      </View>
      <FlatList
        ListHeaderComponent={
          IS_WEB ? null : (
            <Link href="/recordings" asChild>
              <Pressable style={styles.recordings}>
                <Text style={styles.recordingsTitle}>♪ Recordings</Text>
                <Text style={styles.recordingsCount}>{recordings.length}</Text>
              </Pressable>
            </Link>
          )
        }
        data={MENU}
        keyExtractor={(e) => e.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>No experiments yet.</Text>}
        renderItem={({ item }) => (
          <View style={styles.group}>
            {/* Plain Pressables (not Link asChild): on web, Link's slot hands
                the array style to a DOM node and throws. Same push either way. */}
            <Pressable
              onPress={() => router.push(`/experiments/${item.id}`)}
              style={[styles.card, { borderColor: item.accent ?? '#222' }]}
            >
              <Text style={styles.cardTitle}>{item.title}</Text>
              {item.blurb ? <Text style={styles.cardBlurb}>{item.blurb}</Text> : null}
            </Pressable>
            {item.variations?.map((v) => (
              <Pressable
                key={v.id}
                onPress={() => router.push(`/experiments/${item.id}/${v.id}`)}
                style={styles.subCard}
              >
                <Text style={styles.subTitle}>
                  <Text style={styles.branch}>↳ </Text>
                  {v.title}
                </Text>
                {v.blurb ? <Text style={styles.subBlurb}>{v.blurb}</Text> : null}
              </Pressable>
            ))}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  heading: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '700',
  },
  list: { paddingHorizontal: 20, paddingBottom: 40, gap: 16 },
  recordings: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#2a2f3a',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 16,
    backgroundColor: '#0c0c0c',
  },
  recordingsTitle: { color: '#fff', fontSize: 17, fontWeight: '600' },
  recordingsCount: {
    color: '#8a8a8a',
    fontSize: 15,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  group: { gap: 8 },
  empty: { color: '#666', fontSize: 15, paddingHorizontal: 20 },
  card: {
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 18,
    paddingHorizontal: 16,
    backgroundColor: '#0c0c0c',
  },
  cardTitle: { color: '#fff', fontSize: 18, fontWeight: '600' },
  cardBlurb: { color: '#9a9a9a', fontSize: 13, marginTop: 4 },
  // Variations: indented, lighter, visually subordinate to the parent.
  subCard: {
    marginLeft: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#222',
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 14,
    backgroundColor: '#080808',
  },
  subTitle: { color: '#d8d8d8', fontSize: 15, fontWeight: '500' },
  branch: { color: '#555' },
  subBlurb: { color: '#7e7e7e', fontSize: 12, marginTop: 3 },
});
