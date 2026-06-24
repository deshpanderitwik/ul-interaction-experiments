import * as Haptics from 'expo-haptics';
import { FineHaptics } from '../../modules/fine-haptics';

// The "voice" seam for NoteSketch. Today a pluck is a haptic transient (felt,
// not heard) via the fine-haptics native module already in the binary — so it
// ships over OTA. Phase 2 adds a real sine pluck from a custom Swift synth
// module here, behind the same playPluck() call.

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
 * Fire one short pluck. `bright` (0..1) tracks pitch — higher notes feel
 * sharper. Fire-and-forget; never throws.
 */
export function playPluck(bright: number) {
  const b = Math.max(0, Math.min(1, bright));
  if (canFineHaptics()) {
    // Crisp, light tap; sharpness rises with pitch for a brighter "pluck".
    FineHaptics.transient(0.7, 0.35 + 0.55 * b).catch(() => {});
  } else {
    Haptics.selectionAsync().catch(() => {});
  }
}
