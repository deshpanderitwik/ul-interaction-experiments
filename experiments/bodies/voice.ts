import { NoteSynth } from '../../modules/note-synth';
import { duckGain } from '../combinations/sidechain';
import { recordNote } from '../recorder/recorder';

// Bodies' voice seam. For now every body is a plucked sine (the native NoteSynth),
// with the same record hook every experiment uses so REC captures the scene.
// Timbre per body is a future expressiveness dimension — this is the atom.
//
// Melodic voices are the sidechain TARGET: their gain is ducked by a recent kick
// (duckGain, 1 when no sidechain is set / no kick is playing, so standalone
// experiments are unaffected). We record the pre-duck gain — the musical intent —
// and only attenuate the audio.
export function playSine(freq: number, gain = 0.3, decay = 1.4) {
  recordNote(freq, gain);
  NoteSynth?.pluck(freq, gain * duckGain(), decay).catch(() => {});
}
