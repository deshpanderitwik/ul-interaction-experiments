import { StyleSheet, Text, View } from 'react-native';
import { noteName, type Scale } from '../scale';
import { scaleMidiLadder } from './shared';

// The shared pitch field for Bodies and its Paths variation: vertical position →
// scale note, plus the left ruler and note-boundary grid geometry. Defined once
// so both screens trace the exact same grid.

export const LADDER_MIN = 48; // C3
export const LADDER_MAX = 72; // C5 (two octaves)
export const PITCH_TOP = 110; // y of the highest note
export const PITCH_BOTTOM_INSET = 92; // y (from bottom) of the lowest note

export function fieldLadder(scale: Scale): number[] {
  return scaleMidiLadder(scale, LADDER_MIN, LADDER_MAX);
}

// y → nearest scale note (top of the field = high, bottom = low).
export function midiFromY(y: number, ladder: number[], height: number): number {
  if (ladder.length === 0) return 48;
  const bottom = height - PITCH_BOTTOM_INSET;
  const f = Math.max(0, Math.min(1, (bottom - y) / (bottom - PITCH_TOP)));
  return ladder[Math.round(f * (ladder.length - 1))];
}

// Boundary line ys between adjacent notes (midpoints between note centers).
export function computeGridYs(ladder: number[], height: number): number[] {
  const n = ladder.length;
  if (n < 2) return [];
  const bottom = height - PITCH_BOTTOM_INSET;
  const step = (bottom - PITCH_TOP) / (n - 1);
  const ys: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    ys.push(bottom - (i / (n - 1)) * (bottom - PITCH_TOP) - step / 2);
  }
  return ys;
}

// Left-edge ruler: each scale note at the exact y its position maps to.
export function PitchRuler({ ladder, height }: { ladder: number[]; height: number }) {
  const n = ladder.length;
  const top = PITCH_TOP;
  const bottom = height - PITCH_BOTTOM_INSET;
  return (
    <View style={styles.ruler} pointerEvents="none">
      <View style={[styles.rulerSpine, { top, height: Math.max(0, bottom - top) }]} />
      {ladder.map((midi, i) => {
        const y = n > 1 ? bottom - (i / (n - 1)) * (bottom - top) : (top + bottom) / 2;
        return (
          <View key={midi} style={[styles.rulerRow, { top: y - 7 }]}>
            <Text style={styles.rulerLabel}>{noteName(midi)}</Text>
            <View style={styles.rulerTick} />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  ruler: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 64 },
  rulerSpine: {
    position: 'absolute',
    left: 50,
    width: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  rulerRow: { position: 'absolute', left: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
  rulerLabel: {
    width: 26,
    textAlign: 'right',
    color: 'rgba(255,255,255,0.42)',
    fontSize: 11,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  rulerTick: { width: 8, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.3)' },
});
