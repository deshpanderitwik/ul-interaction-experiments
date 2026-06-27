import { useEffect, useReducer, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { exportAndShare } from './exportMidi';
import { isRecording, startRecording, stopRecording, subscribe } from './recorder';

// Top-center record control in the experiment host overlay. Tap to arm (shows a
// red dot + running timer); tap again to stop, encode the recorded notes to a
// .mid file, and open the share sheet (AirDrop). Works in any experiment.
export function RecordControl() {
  const [, force] = useReducer((x) => x + 1, 0);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(0);

  useEffect(() => subscribe(force), []);

  const recording = isRecording();
  useEffect(() => {
    if (!recording) return;
    startRef.current = Date.now();
    setElapsed(0);
    const id = setInterval(() => setElapsed(Date.now() - startRef.current), 200);
    return () => clearInterval(id);
  }, [recording]);

  const onPress = async () => {
    if (busy) return;
    if (!recording) {
      startRecording();
      return;
    }
    const events = stopRecording();
    setBusy(true);
    try {
      await exportAndShare(events);
    } catch {
      // share cancelled / failed — nothing to do
    } finally {
      setBusy(false);
    }
  };

  return (
    <View pointerEvents="box-none" style={styles.wrap}>
      <Pressable
        onPress={onPress}
        disabled={busy}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel={recording ? 'Stop recording and share MIDI' : 'Record MIDI'}
        style={[styles.pill, recording && styles.pillRec]}
      >
        {busy ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <>
            <View style={[styles.dot, recording && styles.dotRec]} />
            <Text style={styles.label}>{recording ? fmt(elapsed) : 'REC'}</Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 58, left: 0, right: 0, alignItems: 'center' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  pillRec: { backgroundColor: 'rgba(220,40,40,0.22)', borderColor: 'rgba(255,90,90,0.8)' },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 7,
    backgroundColor: '#ff5a5a',
  },
  dotRec: { backgroundColor: '#ff2a2a' },
  label: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    fontVariant: ['tabular-nums'],
  },
});
