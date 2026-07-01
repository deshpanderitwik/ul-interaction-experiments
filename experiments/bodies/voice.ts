import { NoteSynth } from '../../modules/note-synth';
import { recordNote } from '../recorder/recorder';

// Bodies' voice seam. For now every body is a plucked sine (the native NoteSynth),
// with the same record hook every experiment uses so REC captures the scene.
// Timbre per body is a future expressiveness dimension — this is the atom.
export function playSine(freq: number, gain = 0.3, decay = 1.4) {
  recordNote(freq, gain);
  NoteSynth?.pluck(freq, gain, decay).catch(() => {});
}
