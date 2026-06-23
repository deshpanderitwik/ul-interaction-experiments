import { Link } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { experiments } from '../experiments/registry';

// Home menu. Maps over the experiment registry — adding an experiment there
// makes it appear here automatically. Tapping a card pushes its host route.
export default function Home() {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <Text style={[styles.heading, { marginTop: insets.top + 16 }]}>Experiments</Text>
      <FlatList
        data={experiments}
        keyExtractor={(e) => e.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>No experiments yet.</Text>}
        renderItem={({ item }) => (
          <Link href={`/experiments/${item.id}`} asChild>
            <Pressable
              style={[styles.card, { borderColor: item.accent ?? '#222' }]}
            >
              <Text style={styles.cardTitle}>{item.title}</Text>
              {item.blurb ? <Text style={styles.cardBlurb}>{item.blurb}</Text> : null}
            </Pressable>
          </Link>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  heading: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '700',
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  list: { paddingHorizontal: 20, paddingBottom: 40, gap: 12 },
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
});
