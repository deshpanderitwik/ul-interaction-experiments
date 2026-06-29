import { NoteSynth } from '../../modules/note-synth';

// The ADSR experiment edits a single envelope and fires it on a fixed pitch.
// A3 (220 Hz) reads as a warm, mid-register tone where the envelope shaping is
// easy to hear.
export const PITCH_HZ = 220;

// Parameter ranges. The editor stores attack/decay/release as 0..1 fractions of
// these maxima (so a handle dragged fully right == the max time); sustain is a
// level (0..1) stored directly. `HOLD_S` is how long sustain is held for a
// one-shot pulse before the release begins.
export const A_MAX_S = 1.2;
export const D_MAX_S = 1.2;
export const R_MAX_S = 2.0;
export const HOLD_S = 0.28;

export type Envelope = {
  /** attack fraction of A_MAX_S, 0..1 */
  a: number;
  /** decay fraction of D_MAX_S, 0..1 */
  d: number;
  /** sustain level, 0..1 */
  s: number;
  /** release fraction of R_MAX_S, 0..1 */
  r: number;
};

export const DEFAULT_ENV: Envelope = { a: 0.18, d: 0.32, s: 0.55, r: 0.4 };

/** Concrete segment times (seconds) for a given envelope. */
export function envSeconds(env: Envelope) {
  return {
    attack: env.a * A_MAX_S,
    decay: env.d * D_MAX_S,
    sustain: env.s,
    hold: HOLD_S,
    release: env.r * R_MAX_S,
  };
}

/**
 * Fire one sine pulse shaped by `env`. Uses the native ADSR voice when the
 * binary has it; on an older install received over OTA (no `playADSR` yet) it
 * degrades to a plain pluck whose decay spans the envelope's total length, so
 * something still sounds. Never throws.
 */
export function playEnvelope(env: Envelope) {
  const { attack, decay, sustain, hold, release } = envSeconds(env);
  // NoteSynth is typed without an index signature; widen to feature-detect the
  // newer method without a hard dependency on the native build.
  const synth = NoteSynth as
    | (typeof NoteSynth & { playADSR?: (...a: number[]) => Promise<void> })
    | null;
  if (!synth) return;

  if (typeof synth.playADSR === 'function') {
    synth.playADSR(PITCH_HZ, 0.9, attack, decay, sustain, hold, release).catch(() => {});
  } else {
    // Fallback: approximate loudness with the sustain level, span the whole env.
    const total = attack + decay + hold + release;
    synth.pluck(PITCH_HZ, 0.9 * Math.max(0.25, sustain), Math.max(0.1, total)).catch(() => {});
  }
}
