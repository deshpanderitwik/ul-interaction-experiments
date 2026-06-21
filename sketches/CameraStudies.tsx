import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useFrameOutput,
} from 'react-native-vision-camera';
import { ColorSwatches, makeColorProcessor } from '../studies/cameraColors';
import type { Sketch } from './types';

// Camera studies — a harness over the live preview, like Explosion studies but
// for camera-frame treatments. Each chip toggles one study on/off; tap the
// active chip to turn it off and see the bare preview. First study: "Colors",
// which reads each frame and paints its three dominant colors as swatches at
// the bottom-center. Fold a keeper back into the Camera view sketch.
const STUDIES = [{ key: 'colors', label: 'Colors' }] as const;
type StudyKey = (typeof STUDIES)[number]['key'];

function CameraStudies() {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  const [active, setActive] = useState<StudyKey | null>(null);

  // Frame-output → UI bridge for the Colors study.
  const colorsSV = useSharedValue<string[]>([]);
  const tickSV = useSharedValue(0);
  const frameOutput = useFrameOutput({
    pixelFormat: 'rgb',
    targetResolution: { width: 320, height: 240 },
    onFrame: makeColorProcessor(colorsSV, tickSV),
  });

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
        <Text style={styles.msg}>No back camera available</Text>
      </View>
    );
  }

  const colorsOn = active === 'colors';

  return (
    <View style={styles.fill}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive
        // Only attach the frame output while its study is on, so we don't pay
        // for frame processing when showing the bare preview.
        outputs={colorsOn ? [frameOutput] : []}
      />
      {colorsOn && <ColorSwatches colorsSV={colorsSV} />}

      <View style={styles.bar}>
        {STUDIES.map((s) => {
          const on = active === s.key;
          return (
            <Pressable
              key={s.key}
              onPress={() => setActive(on ? null : s.key)}
              style={[styles.chip, on && styles.chipOn]}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>
                {s.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.hint}>Tap a study to toggle it</Text>
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
  bar: {
    position: 'absolute',
    top: 12,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(21,21,29,0.7)',
    borderWidth: 1,
    borderColor: '#26263a',
  },
  chipOn: { backgroundColor: '#2a2a40', borderColor: '#6c5ce7' },
  chipText: { color: '#cfcfe0', fontSize: 13, fontWeight: '600' },
  chipTextOn: { color: '#fff' },
  hint: {
    position: 'absolute',
    bottom: 14,
    left: 0,
    right: 0,
    textAlign: 'center',
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
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
  id: 'camera-studies',
  title: 'Camera studies',
  description: 'Harness for camera-frame treatments. Colors: shows the frame’s three dominant colors.',
  order: 95,
  parentId: 'camera-view',
  Component: CameraStudies,
};

export default sketch;
