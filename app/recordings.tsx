import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  deleteRecording,
  renameRecording,
  shareRecording,
  useLibrary,
  type Recording,
} from '../experiments/recorder/library';

// Recordings library: list, rename, delete, and AirDrop (share) saved MIDI clips.
export default function Recordings() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const recordings = useLibrary();

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <View style={[styles.header, { marginTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={16} style={styles.back}>
          <Text style={styles.chevron}>‹</Text>
        </Pressable>
        <Text style={styles.heading}>Recordings</Text>
        <View style={styles.back} />
      </View>

      <FlatList
        data={recordings}
        keyExtractor={(r) => r.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>
            No recordings yet. Open an experiment, tap REC, play, then tap again.
          </Text>
        }
        renderItem={({ item }) => <Row rec={item} />}
      />
    </View>
  );
}

function Row({ rec }: { rec: Recording }) {
  const onRename = () => {
    Alert.prompt(
      'Rename recording',
      undefined,
      (text) => {
        const name = text?.trim();
        if (name) renameRecording(rec.id, name);
      },
      'plain-text',
      rec.name
    );
  };

  const onDelete = () => {
    Alert.alert('Delete recording?', rec.name, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteRecording(rec.id) },
    ]);
  };

  const onShare = () => {
    shareRecording(rec).catch(() => {});
  };

  return (
    <View style={styles.card}>
      <Text style={styles.name}>{rec.name}</Text>
      <Text style={styles.meta}>{metaLine(rec)}</Text>
      <View style={styles.actions}>
        <Action label="AirDrop" onPress={onShare} />
        <Action label="Rename" onPress={onRename} />
        <Action label="Delete" onPress={onDelete} danger />
      </View>
    </View>
  );
}

function Action({
  label,
  onPress,
  danger,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={styles.action}>
      <Text style={[styles.actionText, danger && styles.actionDanger]}>{label}</Text>
    </Pressable>
  );
}

function metaLine(rec: Recording): string {
  const d = new Date(rec.createdAt);
  const date = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes()
  ).padStart(2, '0')}`;
  const secs = Math.max(1, Math.round(rec.durationMs / 1000));
  return `${date} · ${rec.noteCount} notes · ${secs}s`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  chevron: { color: '#fff', fontSize: 30, lineHeight: 32, marginTop: -2 },
  heading: { color: '#fff', fontSize: 22, fontWeight: '700' },
  list: { paddingHorizontal: 20, paddingBottom: 40, gap: 12 },
  empty: { color: '#666', fontSize: 15, paddingHorizontal: 4, marginTop: 24, lineHeight: 22 },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#262626',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: '#0c0c0c',
  },
  name: { color: '#fff', fontSize: 17, fontWeight: '600' },
  meta: { color: '#8a8a8a', fontSize: 13, marginTop: 4, fontVariant: ['tabular-nums'] },
  actions: { flexDirection: 'row', gap: 18, marginTop: 14 },
  action: { paddingVertical: 2 },
  actionText: { color: '#5b8cff', fontSize: 14, fontWeight: '600' },
  actionDanger: { color: '#ff5a5a' },
});
