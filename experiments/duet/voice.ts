import { NoteSynth } from '../../modules/note-synth';
import { recordNote } from '../recorder/recorder';

// The "voice" seam for Duet. Two instruments share one sine-only native synth
// (NoteSynth plucks a decaying sine), so the two timbres are built in JS:
//
//   - sine  → a single pluck with a long decay, re-voiced on the beat so it
//             reads as a sustained, legato tone.
//   - square→ additive synthesis: a square wave is the sum of its ODD harmonics
//             with 1/n amplitude (Fourier series), so stacking sine plucks at
//             f, 3f, 5f, 7f, 9f on the native synth approximates a square's buzz
//             without touching native code (ships over OTA).
//
// Both degrade to silence (no throw) on a build without the native synth.

const SQUARE_HARMONICS = [1, 3, 5, 7, 9];
// Sum of 1/n over the harmonics, used to normalize total gain back to ~`gain`.
const SQUARE_NORM = SQUARE_HARMONICS.reduce((s, n) => s + 1 / n, 0);

/** Sine instrument: one long-decay pluck. Re-voice on the beat for legato. */
export function playSine(freq: number, gain = 0.32, decay = 1.6) {
  recordNote(freq, gain);
  NoteSynth?.pluck(freq, gain, decay).catch(() => {});
}

/** Square instrument: odd harmonics summed into a square-ish buzz. */
export function playSquare(freq: number, gain = 0.5, decay = 0.16) {
  recordNote(freq, gain);
  if (!NoteSynth) return;
  for (const n of SQUARE_HARMONICS) {
    const g = (gain * (1 / n)) / SQUARE_NORM;
    NoteSynth.pluck(freq * n, g, decay).catch(() => {});
  }
}
