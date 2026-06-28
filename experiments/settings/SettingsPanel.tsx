import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { ScalePicker } from './ScalePicker';
import { TempoControl } from './TempoControl';
import { useSettingsContext } from './context';
import { Slider } from './Slider';
import type { SliderSetting } from './types';

// Gear control, mirroring the host's back button but on the right. Shown when
// there's something to configure: a musical experiment (scale + tempo) or one
// that registered its own controls.
export function SettingsGear() {
  const { setOpen, audio, schema } = useSettingsContext();
  if (!audio && !schema) return null;
  return (
    <Pressable
      onPress={() => setOpen(true)}
      hitSlop={16}
      accessibilityRole="button"
      accessibilityLabel="Open settings"
      style={styles.gear}
    >
      <Text style={styles.gearIcon}>⚙</Text>
    </Pressable>
  );
}

const SHEET_W = 320;

// Side sheet that slides in from the right. Live-apply: each control writes
// straight to the settings store, so the experiment behind updates immediately.
export function SettingsSheet() {
  const { schema, values, setValue, open, setOpen, audio } = useSettingsContext();
  const { width } = useWindowDimensions();
  const sheetW = Math.min(SHEET_W, width * 0.86);

  const tx = useSharedValue(sheetW);
  const scrim = useSharedValue(0);
  useEffect(() => {
    tx.value = withTiming(open ? 0 : sheetW, {
      duration: 240,
      easing: Easing.out(Easing.cubic),
    });
    scrim.value = withTiming(open ? 1 : 0, { duration: 240 });
  }, [open, sheetW, tx, scrim]);

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrim.value * 0.5 }));

  return (
    <View pointerEvents={open ? 'auto' : 'none'} style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
      </Animated.View>

      <Animated.View style={[styles.sheet, { width: sheetW }, sheetStyle]}>
        <View style={styles.header}>
          <Text style={styles.title}>Settings</Text>
          <Pressable onPress={() => setOpen(false)} hitSlop={12}>
            <Text style={styles.done}>Done</Text>
          </Pressable>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {audio ? (
            <>
              <ScalePicker />
              <TempoControl />
            </>
          ) : null}

          {Object.entries(schema ?? {}).map(([key, ctrl]) => {
            const value = values[key] ?? ctrl.default;
            if (ctrl.type === 'select') {
              return (
                <View key={key} style={styles.row}>
                  <Text style={styles.label}>{ctrl.label}</Text>
                  <View style={styles.segments}>
                    {ctrl.options.map((opt) => {
                      const on = value === opt.value;
                      return (
                        <Pressable
                          key={opt.value}
                          onPress={() => setValue(key, opt.value)}
                          style={[styles.segment, on && styles.segmentOn]}
                        >
                          <Text style={[styles.segmentText, on && styles.segmentTextOn]}>
                            {opt.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              );
            }
            return (
              <View key={key} style={styles.row}>
                <View style={styles.rowHead}>
                  <Text style={styles.label}>{ctrl.label}</Text>
                  <Text style={styles.value}>{formatValue(value, ctrl)}</Text>
                </View>
                <Slider
                  value={value}
                  minimumValue={ctrl.min}
                  maximumValue={ctrl.max}
                  step={ctrl.step ?? 0}
                  onValueChange={(v) => setValue(key, v)}
                />
              </View>
            );
          })}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

function formatValue(v: number, ctrl: SliderSetting): string {
  const n = ctrl.step && ctrl.step >= 1 ? Math.round(v) : Math.round(v * 100) / 100;
  return `${n}${ctrl.unit ? ` ${ctrl.unit}` : ''}`;
}

const styles = StyleSheet.create({
  gear: {
    position: 'absolute',
    top: 56,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  gearIcon: { color: '#fff', fontSize: 18 },
  scrim: { backgroundColor: '#000' },
  sheet: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#141414',
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: 'rgba(255,255,255,0.12)',
    paddingTop: 64,
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: { color: '#fff', fontSize: 20, fontWeight: '700' },
  done: { color: '#5b8cff', fontSize: 16, fontWeight: '600' },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 48 },
  row: { marginBottom: 22 },
  rowHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  label: { color: '#dddddd', fontSize: 15 },
  value: { color: '#888888', fontSize: 14, fontVariant: ['tabular-nums'] },
  segments: { flexDirection: 'row', gap: 8, marginTop: 10 },
  segment: {
    flex: 1,
    height: 38,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1c1c1c',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  segmentOn: { backgroundColor: '#5b8cff', borderColor: '#5b8cff' },
  segmentText: { color: '#bbbbbb', fontSize: 14, fontWeight: '600' },
  segmentTextOn: { color: '#ffffff' },
});
