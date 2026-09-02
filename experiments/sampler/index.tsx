import { Canvas, Line, Path, Skia, vec } from '@shopify/react-native-skia';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { MicTap, type MicFrame } from '../../modules/mic-tap';
import { useExperimentActive } from '../_host';

// Sampler — the phone starts listening to the world. Press start and the mic
// streams the room in live, drawn as a scrolling mirrored waveform (newest at
// the right edge); press stop and the stream pauses, freezing what's on screen.
// Raw PCM stays native: the mic-tap module folds each hardware buffer into
// ~16ms peak columns + an RMS level and ships only those over the bridge.

const COL_W = 3; // px per waveform column (2px bar + 1px gap)
const PAD = 18; // side padding for the waveform strip
const WAVE_FRAC = 0.30; // half-height of a full-scale bar, as a fraction of screen height

export default function Sampler() {
  const live = useExperimentActive();
  const { width, height } = useWindowDimensions();

  const [peaks, setPeaks] = useState<number[]>([]); // rolling columns, oldest first
  const [rms, setRms] = useState(0);
  const [running, setRunning] = useState(false);
  const [denied, setDenied] = useState(false);
  const runningRef = useRef(false);
  runningRef.current = running;
  const busyRef = useRef(false);
  // Keep only as many columns as fit the strip (rolls off the left edge).
  const maxColsRef = useRef(1);
  maxColsRef.current = Math.max(1, Math.floor((width - PAD * 2) / COL_W));

  // One subscription for the screen's life; frames only arrive while capturing.
  useEffect(() => {
    if (!MicTap) return;
    const sub = MicTap.addListener('onAudio', (f: MicFrame) => {
      setRms(f.rms);
      setPeaks((prev) => {
        const next = prev.concat(f.peaks);
        const over = next.length - maxColsRef.current;
        return over > 0 ? next.slice(over) : next;
      });
    });
    return () => sub.remove();
  }, []);

  const start = async () => {
    if (!MicTap || busyRef.current) return;
    busyRef.current = true;
    try {
      const ok = await MicTap.start();
      if (ok) {
        setDenied(false);
        setRunning(true);
      } else {
        setDenied(true);
      }
    } catch {
      // No input available (e.g. simulator without a mic) — stay idle.
    } finally {
      busyRef.current = false;
    }
  };
  const stop = () => {
    setRunning(false);
    setRms(0);
    MicTap?.stop();
  };

  // Release the mic whenever the experiment stops being the active screen, and
  // on unmount — never leave the input running behind another sketch.
  useEffect(() => {
    if (!live && runningRef.current) stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);
  useEffect(
    () => () => {
      MicTap?.stop();
    },
    []
  );

  const midY = height * 0.44;
  const wavePath = useMemo(() => {
    const p = Skia.Path.Make();
    const n = peaks.length;
    for (let i = 0; i < n; i++) {
      // Perceptual lift so room-level audio isn't a flatline: soft-knee curve,
      // then a floor of 2px so silence still reads as a living dotted line.
      const v = Math.min(1, Math.pow(peaks[i], 0.55) * 1.35);
      const h = Math.max(2, v * height * WAVE_FRAC);
      const x = width - PAD - (n - 1 - i) * COL_W;
      if (x < PAD) continue;
      p.addRRect(Skia.RRectXY(Skia.XYWHRect(x - 2, midY - h, 2, h * 2), 1, 1));
    }
    return p;
  }, [peaks, width, height, midY]);

  // The transport ring breathes with the room's level while listening.
  const glow = Math.min(1, Math.pow(rms, 0.5) * 1.6);

  return (
    <View style={styles.fill}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Line
          p1={vec(PAD, midY)}
          p2={vec(width - PAD, midY)}
          color="rgba(255,255,255,0.10)"
          strokeWidth={1}
        />
        <Path path={wavePath} color={running ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.45)'} />
      </Canvas>

      {MicTap == null ? (
        <View style={styles.notice} pointerEvents="none">
          <Text style={styles.noticeText}>
            {Platform.OS === 'web'
              ? 'Sampler listens through a native mic engine — it runs on the phone app, not in the browser.'
              : 'Sampler needs the new native build — install the latest TestFlight build.'}
          </Text>
        </View>
      ) : denied ? (
        <View style={styles.notice} pointerEvents="none">
          <Text style={styles.noticeText}>
            Microphone access is off — enable it for this app in Settings.
          </Text>
        </View>
      ) : null}

      <View style={styles.transport} pointerEvents="box-none">
        <Pressable
          onPress={running ? stop : start}
          disabled={MicTap == null}
          style={({ pressed }) => [
            styles.button,
            running && {
              borderColor: `rgba(255,255,255,${0.35 + 0.5 * glow})`,
              transform: [{ scale: 1 + 0.05 * glow }],
            },
            pressed && styles.buttonPressed,
            MicTap == null && styles.buttonDisabled,
          ]}
        >
          {running ? <View style={styles.stopShape} /> : <View style={styles.startShape} />}
        </Pressable>
        <Text style={styles.transportLabel}>{running ? 'listening' : 'start'}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#0a0a0a' },
  notice: {
    position: 'absolute',
    top: 0,
    left: 32,
    right: 32,
    bottom: '30%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  noticeText: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  transport: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 56,
    alignItems: 'center',
    gap: 10,
  },
  button: {
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: { opacity: 0.7 },
  buttonDisabled: { opacity: 0.3 },
  startShape: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#ffffff',
  },
  stopShape: {
    width: 30,
    height: 30,
    borderRadius: 7,
    backgroundColor: '#ffffff',
  },
  transportLabel: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 12,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
});
