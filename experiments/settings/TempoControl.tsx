import { StyleSheet, Text, View } from 'react-native';
import { TEMPO_MAX, TEMPO_MIN, setTempo, useTempo } from '../tempo';
import { Slider } from './Slider';

// Global tempo (BPM) section for the settings side sheet. Affects experiments
// with a fixed-tempo clock (Note Radial's progression, NoteSketch's arp).
export function TempoControl() {
  const tempo = useTempo();
  return (
    <View style={styles.section}>
      <View style={styles.head}>
        <Text style={styles.label}>Tempo</Text>
        <Text style={styles.value}>{tempo} BPM</Text>
      </View>
      <Slider
        value={tempo}
        minimumValue={TEMPO_MIN}
        maximumValue={TEMPO_MAX}
        step={1}
        onValueChange={setTempo}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 22 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  label: { color: '#dddddd', fontSize: 15 },
  value: { color: '#888888', fontSize: 14, fontVariant: ['tabular-nums'] },
});
