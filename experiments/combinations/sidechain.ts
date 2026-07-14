// Sidechain "duck" — the kick momentarily pulls the melodic voices down, then
// they swell back: the pump.
//
// A true sidechain gain-modulates voices that are ALREADY ringing, which needs
// the native synth. Over OTA we do the tractable version: duck each melodic
// note's gain at the moment it fires, by how recently the kick hit. On a dense
// arp (Paths) that reads as a convincing pump — notes landing in the duck window
// come in quieter and recover over the release. Notes already sounding from
// before the kick aren't touched (that's the part that wants native).
//
// Timebase is wall-clock ms (Date.now) so every caller agrees without threading
// a clock around: the kick stamps `lastKickMs`, melodic voices read `duckGain()`.

let lastKickMs = -1e9;
let depth = 0; // 0..1 — how far the kick ducks the melodic voices (0 = off/bypassed)
let releaseMs = 150; // how long they take to swell back to full

/** Configure the duck. depth 0 disables it entirely (no attenuation applied). */
export function setSidechain(d: number, rel = 150) {
  depth = Math.max(0, Math.min(1, d));
  releaseMs = Math.max(1, rel);
}

/** Call when the kick fires — opens a fresh duck. */
export function triggerDuck(nowMs: number = Date.now()) {
  lastKickMs = nowMs;
}

/** Gain multiplier (0..1) for a melodic note firing now; 1 = no duck. */
export function duckGain(nowMs: number = Date.now()): number {
  if (depth <= 0) return 1;
  const age = nowMs - lastKickMs;
  if (age < 0 || age >= releaseMs) return 1;
  const recover = age / releaseMs; // 0 at the kick → 1 at the end of the release
  return 1 - depth * (1 - recover); // (1 - depth) right at the kick → 1 when recovered
}
