import { NoteSynth } from '../../modules/note-synth';
import { recordNote } from '../recorder/recorder';

// Drums' voice seam — the "hello world" of the drum family.
//
// The native synth is sine-only (no noise source, no filter), so a kick is the
// one drum voice it can carry convincingly with ZERO native changes: a kick is
// essentially a low sine with a very fast amplitude decay. We fake the punchy
// pitch-drop attack a real kick has by layering a short, higher "click"
// transient over the low body — two sine plucks, pure JS, ships over OTA.
//
// Snare / hats / cymbals are fundamentally *filtered noise* and can't be faked
// from sines cheaply; they need a native noise generator + filter (see the drum
// discussion in THESIS's neighborhood). Those aren't here yet — this family
// starts, deliberately, with the kick alone.

const BODY_FREQ = 50; // fundamental of the thump, Hz — deep but audible on a phone speaker
const BODY_DECAY = 0.22; // seconds to ~-60dB: short enough to read as percussive
const CLICK_FREQ = 120; // attack transient, Hz — fakes the fast downward pitch sweep
const CLICK_DECAY = 0.05; // very short: just the beater "click"

/** Fire one kick. `gain` (0..1) is the hit's velocity/loudness. */
export function playKick(gain = 0.95) {
  const g = Math.max(0, Math.min(1, gain));
  recordNote(BODY_FREQ, g); // capture the kick in REC (records the fundamental)
  if (!NoteSynth) return; // degrade to silence on a build without the native synth
  NoteSynth.pluck(BODY_FREQ, g, BODY_DECAY).catch(() => {}); // body thump
  NoteSynth.pluck(CLICK_FREQ, g * 0.5, CLICK_DECAY).catch(() => {}); // attack click
}
