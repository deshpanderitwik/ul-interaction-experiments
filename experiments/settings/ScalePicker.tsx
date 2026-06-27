import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ROOT_NAMES, getScale, setScale, useScale } from '../scale';

// Global scale picker for the settings side sheet: a root (all 12 chromatic
// roots) plus quality (natural Major / Minor). Changing it re-pitches every
// experiment's notes.
export function ScalePicker() {
  const scale = useScale();
  return (
    <View style={styles.section}>
      <Text style={styles.label}>Scale</Text>

      <View style={styles.roots}>
        {ROOT_NAMES.map((name, i) => {
          const on = scale.root === i;
          return (
            <Pressable
              key={name}
              onPress={() => setScale({ ...getScale(), root: i })}
              style={[styles.root, on && styles.selected]}
            >
              <Text style={[styles.rootText, on && styles.selectedText]}>{name}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.quality}>
        {(['major', 'minor'] as const).map((q) => {
          const on = scale.type === q;
          return (
            <Pressable
              key={q}
              onPress={() => setScale({ ...getScale(), type: q })}
              style={[styles.qual, on && styles.selected]}
            >
              <Text style={[styles.qualText, on && styles.selectedText]}>
                {q === 'major' ? 'Major' : 'Minor'}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 24 },
  label: { color: '#dddddd', fontSize: 15, marginBottom: 12 },
  roots: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  root: {
    width: 40,
    height: 36,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1c1c1c',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  rootText: { color: '#bbbbbb', fontSize: 13, fontWeight: '600' },
  quality: { flexDirection: 'row', gap: 10 },
  qual: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1c1c1c',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  qualText: { color: '#bbbbbb', fontSize: 14, fontWeight: '600' },
  selected: { backgroundColor: '#5b8cff', borderColor: '#5b8cff' },
  selectedText: { color: '#ffffff' },
});
