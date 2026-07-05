import { useEffect, useReducer } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { noteName, type Scale } from '../scale';
import { scaleMidiLadder } from './shared';

// The shared pitch field for Bodies and its Paths variation: vertical position →
// scale note, plus the left ruler and note-boundary grid geometry. Defined once
// so both screens trace the exact same grid.

export const LADDER_MIN = 48; // C3
export const LADDER_MAX = 72; // C5 (two octaves)
export const PITCH_TOP = 130; // y of the highest note (kept clear of the top bar / back button)
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

// Per-note on/off mask over the grid, shared across the bodies experiments (in
// memory, like the global scale). A disabled note is muted everywhere; tap its
// label on the ruler to toggle it.
let disabled = new Set<number>();
const disabledListeners = new Set<() => void>();

export function toggleNote(midi: number) {
  const next = new Set(disabled);
  if (next.has(midi)) next.delete(midi);
  else next.add(midi);
  disabled = next;
  for (const l of disabledListeners) l();
}
export function noteEnabled(midi: number): boolean {
  return !disabled.has(midi);
}
export function useDisabledNotes(): Set<number> {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    disabledListeners.add(force);
    return () => {
      disabledListeners.delete(force);
    };
  }, []);
  return disabled;
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

// Left-edge ruler: each scale note at the exact y its position maps to. Tap a
// label to toggle that note on/off (disabled = dimmed + struck).
export function PitchRuler({ ladder, height }: { ladder: number[]; height: number }) {
  const off = useDisabledNotes();
  const n = ladder.length;
  const top = PITCH_TOP;
  const bottom = height - PITCH_BOTTOM_INSET;
  return (
    <View style={styles.ruler} pointerEvents="box-none">
      <View style={[styles.rulerSpine, { top, height: Math.max(0, bottom - top) }]} pointerEvents="none" />
      {ladder.map((midi, i) => {
        const y = n > 1 ? bottom - (i / (n - 1)) * (bottom - top) : (top + bottom) / 2;
        const isOff = off.has(midi);
        return (
          <Pressable
            key={midi}
            onPress={() => toggleNote(midi)}
            hitSlop={{ top: 5, bottom: 5, left: 6, right: 14 }}
            style={[styles.rulerRow, { top: y - 11 }]}
          >
            <Text style={[styles.rulerLabel, isOff && styles.rulerLabelOff]}>{noteName(midi)}</Text>
            <View style={[styles.rulerTick, isOff && styles.rulerTickOff]} />
          </Pressable>
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
  rulerRow: {
    position: 'absolute',
    left: 10,
    height: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rulerLabel: {
    width: 26,
    textAlign: 'right',
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  rulerLabelOff: { color: 'rgba(255,255,255,0.22)', textDecorationLine: 'line-through' },
  rulerTick: { width: 8, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.3)' },
  rulerTickOff: { backgroundColor: 'rgba(255,255,255,0.12)' },
});
