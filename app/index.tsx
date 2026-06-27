import { Link } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RefreshButton } from '../components/RefreshButton';
import { experiments } from '../experiments/registry';

// Home menu. Maps over the experiment registry — adding an experiment (or a
// variation) there makes it appear here automatically. Tapping a card pushes
// its host route; variations render indented under their parent.
export default function Home() {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <View style={[styles.header, { marginTop: insets.top + 16 }]}>
        <Text style={styles.heading}>Experiments</Text>
        <RefreshButton />
      </View>
      <FlatList
        data={experiments}
        keyExtractor={(e) => e.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>No experiments yet.</Text>}
        renderItem={({ item }) => (
          <View style={styles.group}>
            <Link href={`/experiments/${item.id}`} asChild>
              <Pressable style={[styles.card, { borderColor: item.accent ?? '#222' }]}>
                <Text style={styles.cardTitle}>{item.title}</Text>
                {item.blurb ? <Text style={styles.cardBlurb}>{item.blurb}</Text> : null}
              </Pressable>
            </Link>
            {item.variations?.map((v) => (
              <Link key={v.id} href={`/experiments/${item.id}/${v.id}`} asChild>
                <Pressable style={styles.subCard}>
                  <Text style={styles.subTitle}>
                    <Text style={styles.branch}>↳ </Text>
                    {v.title}
                  </Text>
                  {v.blurb ? <Text style={styles.subBlurb}>{v.blurb}</Text> : null}
                </Pressable>
              </Link>
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
