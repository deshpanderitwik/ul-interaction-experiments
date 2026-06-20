import { Link } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text } from 'react-native';
import { sketches } from '../sketches/registry';

export default function Home() {
  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.content}
      data={sketches}
      keyExtractor={(s) => s.id}
      ListHeaderComponent={
        <Text style={styles.lead}>
          {sketches.length} interaction experiment
          {sketches.length === 1 ? '' : 's'}
        </Text>
      }
      renderItem={({ item }) => (
        <Link href={`/sketch/${item.id}`} asChild>
          <Pressable style={styles.row}>
            <Text style={styles.rowTitle}>{item.title}</Text>
            <Text style={styles.rowDesc}>{item.description}</Text>
          </Pressable>
        </Link>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: '#0b0b0f' },
  content: { padding: 16 },
  lead: { color: '#5a5a6b', fontSize: 13, marginBottom: 12, marginLeft: 4 },
  row: {
    backgroundColor: '#15151d',
    borderRadius: 18,
    padding: 18,
    marginBottom: 12,
  },
  rowTitle: { color: '#fff', fontSize: 18, fontWeight: '600' },
  rowDesc: { color: '#8a8a99', fontSize: 14, marginTop: 4 },
});
