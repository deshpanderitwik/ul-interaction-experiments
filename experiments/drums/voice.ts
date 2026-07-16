import { NoteSynth } from '../../modules/note-synth';
import { triggerDuck } from '../combinations/sidechain';
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
  triggerDuck(); // the kick is the sidechain source — open a duck on the melodic voices
  if (!NoteSynth) return; // degrade to silence on a build without the native synth
  NoteSynth.pluck(BODY_FREQ, g, BODY_DECAY).catch(() => {}); // body thump
  NoteSynth.pluck(CLICK_FREQ, g * 0.5, CLICK_DECAY).catch(() => {}); // attack click
}

// Snare and hats are broadband "noise", which the sine-only engine can't make
// directly — so we approximate it the way Duet fakes a square: stack a spread of
// inharmonic sine plucks. Jittered partials + short decays read as a percussive
// noise burst. Not real filtered noise (that wants the native engine), but a
// convincing kit over OTA. These are drum voices, so they don't duck themselves.

/** Snare: a bit of tonal body + a burst of inharmonic partials for the "noise". */
export function playSnare(gain = 0.7) {
  const g = Math.max(0, Math.min(1, gain));
  recordNote(200, g);
  if (!NoteSynth) return;
  NoteSynth.pluck(180, g * 0.35, 0.12).catch(() => {}); // body
  NoteSynth.pluck(330, g * 0.2, 0.1).catch(() => {}); // body overtone
  for (let i = 0; i < 7; i++) {
    const f = 1500 + i * 900 + Math.random() * 400; // ~1.5k–8k inharmonic spread
    NoteSynth.pluck(f, g * 0.12, 0.09).catch(() => {});
  }
}

/** Hi-hat: high inharmonic partials; `open` rings longer, closed is a short tick. */
export function playHat(open = false, gain = 0.5) {
  const g = Math.max(0, Math.min(1, gain));
  recordNote(8000, g);
  if (!NoteSynth) return;
  const decay = open ? 0.28 : 0.045;
  for (let i = 0; i < 7; i++) {
    const f = 5000 + i * 1300 + Math.random() * 600; // high, metallic, inharmonic
    NoteSynth.pluck(f, g * 0.09, decay).catch(() => {});
  }
}

/** Tom: a tonal drum — a low-ish sine body with a short pitch-drop click for punch. */
export function playTom(freq = 150, gain = 0.85) {
  const g = Math.max(0, Math.min(1, gain));
  recordNote(freq, g);
  if (!NoteSynth) return;
  NoteSynth.pluck(freq, g, 0.34).catch(() => {}); // tonal body
  NoteSynth.pluck(freq * 1.6, g * 0.4, 0.06).catch(() => {}); // attack, fakes the pitch drop
}

/** Clap: a few very short bright noise bursts, flammed a hair apart for the "clap". */
export function playClap(gain = 0.7) {
  const g = Math.max(0, Math.min(1, gain));
  recordNote(1000, g);
  if (!NoteSynth) return;
  const burst = () => {
    for (let i = 0; i < 6; i++) {
      const f = 1200 + i * 700 + Math.random() * 500; // bright, inharmonic
      NoteSynth!.pluck(f, g * 0.1, 0.05).catch(() => {});
    }
  };
  burst();
  setTimeout(burst, 12); // the flam that reads as a clap, not a single hit
  setTimeout(burst, 26);
}
