import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
} from 'react-native-vision-camera';
import type { Sketch } from './types';

// First camera sketch — the one that justifies the native rebuild. Once the
// vision-camera native module ships in the binary, any future sketch can use
// the live camera over-the-air with no rebuild. This one keeps it minimal:
// ask for permission, show a full-screen preview, tap to flip front/back.
function CameraView() {
  const { hasPermission, requestPermission } = useCameraPermission();
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const device = useCameraDevice(facing);

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  if (!hasPermission) {
    return (
      <View style={styles.center}>
        <Text style={styles.msg}>Camera permission needed</Text>
        <Pressable style={styles.btn} onPress={requestPermission}>
          <Text style={styles.btnText}>Grant access</Text>
        </Pressable>
      </View>
    );
  }

  if (device == null) {
    return (
      <View style={styles.center}>
        <Text style={styles.msg}>No {facing} camera available</Text>
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <Camera style={StyleSheet.absoluteFill} device={device} isActive />
      <Text style={styles.hint}>Tap to flip camera</Text>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  msg: { color: '#8a8a99', fontSize: 16, textAlign: 'center' },
  hint: {
    position: 'absolute',
    bottom: 48,
    alignSelf: 'center',
    color: '#fff',
    fontSize: 14,
    opacity: 0.8,
    backgroundColor: 'rgba(0,0,0,0.4)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  btn: {
    backgroundColor: '#ff7675',
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 14,
  },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});

const sketch: Sketch = {
  id: 'camera-view',
  title: 'Camera view',
  description: 'Live camera preview via vision-camera; tap to flip front/back.',
  order: 100,
  Component: CameraView,
};

export default sketch;
