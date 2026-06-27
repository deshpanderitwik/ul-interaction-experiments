import * as Haptics from 'expo-haptics';
import { FineHaptics } from '../../modules/fine-haptics';
import { NoteSynth } from '../../modules/note-synth';
import { recordNote } from '../recorder/recorder';

// The "voice" seam for NoteSketch. A pluck is both heard and felt:
//   - audio: a sine pluck from the NoteSynth native module (Swift/AVAudioEngine)
//   - haptic: a fine-haptics transient, sharper for higher notes
// Both degrade gracefully — NoteSynth is null on a build without the native
// synth (e.g. an older install over OTA), and fine-haptics falls back to the
// stock selection haptic on devices without CoreHaptics. Fire-and-forget.

let fineSupported: boolean | null = null;
function canFineHaptics(): boolean {
  if (fineSupported === null) {
    try {
      fineSupported = FineHaptics.isSupported();
    } catch {
      fineSupported = false;
    }
  }
  return fineSupported;
}

/**
 * Fire one pluck. `freq` is the pitch in Hz; `bright` (0..1) tracks pitch so
 * higher notes feel sharper. Never throws.
 */
export function playPluck(freq: number, bright: number) {
  const b = Math.max(0, Math.min(1, bright));

  recordNote(freq, 0.85);

  // Sine pluck. Optional-chaining short-circuits (no call, no throw) when the
  // synth module isn't in this binary.
  NoteSynth?.pluck(freq, 0.85, 0.55).catch(() => {});

  if (canFineHaptics()) {
    FineHaptics.transient(0.7, 0.35 + 0.55 * b).catch(() => {});
  } else {
    Haptics.selectionAsync().catch(() => {});
  }
}
