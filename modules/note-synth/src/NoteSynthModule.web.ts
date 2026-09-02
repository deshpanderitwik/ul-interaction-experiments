import { registerWebModule, NativeModule } from 'expo';

/** Oscillator shapes for the v2 voices, by native index. */
export const WAVES = { sine: 0, triangle: 1, saw: 2, square: 3 } as const;
export type WaveName = keyof typeof WAVES;
export const TABLES = { basic: 0, buzz: 1, vowel: 2 } as const;
export const WARPS = { none: 0, sync: 1, bend: 2, mirror: 3, pwm: 4, quantize: 5, fmFromB: 6 } as const;
export const FILTERS = { off: 0, lowpass: 1, highpass: 2, bandpass: 3, notch: 4 } as const;
export const LFO_SHAPES = { sine: 0, triangle: 1, saw: 2, square: 3, sampleHold: 4 } as const;
export type PatchParams = Record<string, number>;
export type FxParams = Record<string, number>;
export type MasterParams = Record<string, number>;
export type MasterMeters = {
  inRms: number;
  outRms: number;
  outPeak: number;
  grLow: number;
  grMid: number;
  grHigh: number;
  grLimiter: number;
};

// ---------------------------------------------------------------------------
// Web Audio port of the sine engine.
//
// Every experiment's voice seam goes through `pluck` (a decaying sine), so a
// faithful `pluck` is what makes the sketches sound in the browser. The v2
// timbre calls (pluck2 / playADSR2 / bend) are cheap on top of it and are
// implemented too. The wavetable engine, insert-FX rack and mastering chain
// are native-only and stay no-ops here — callers already treat them as
// optional (runtime-gated) on iOS.
//
// Browsers gate audio behind a user gesture. We create the AudioContext
// lazily and resume it on the first pointer/key event on the page, so the
// first tap that plants a body or taps a step is also the tap that unlocks
// sound.
// ---------------------------------------------------------------------------

const WAVE_TYPES: OscillatorType[] = ['sine', 'triangle', 'sawtooth', 'square'];
const SILENCE = 0.001; // -60 dB — the native engine's "decayed" floor
const ATTACK = 0.002; // tiny fade-in so a pluck never clicks

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let unlockInstalled = false;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext ?? (window as any).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) {
    ctx = new AC({ latencyHint: 'interactive' }) as AudioContext;
    // Master: trim → soft limiter → out. The native engine soft-clips its sum;
    // a compressor with a hard knee plays the same role when seven inharmonic
    // partials (a snare) stack on a kick.
    master = ctx.createGain();
    master.gain.value = 0.7;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 4;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    master.connect(limiter);
    limiter.connect(ctx.destination);
    installUnlock();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// Resume the context on the first user gesture anywhere on the page (the
// autoplay policy), and again whenever the tab regains focus after the OS
// suspended it (iOS Safari does this on backgrounding).
function installUnlock() {
  if (unlockInstalled || typeof window === 'undefined') return;
  unlockInstalled = true;
  const resume = () => {
    if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
  };
  for (const ev of ['pointerdown', 'touchstart', 'keydown', 'click']) {
    window.addEventListener(ev, resume, { passive: true, capture: true });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') resume();
  });
}

/** Create + resume the context — call from a user gesture to warm it early. */
export function unlockAudio() {
  getContext();
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

// Build one voice: osc → [lowpass] → env gain → [pan] → master.
// Returns the env GainNode and a stop(at) that tears the chain down.
function voice(
  ac: AudioContext,
  frequency: number,
  wave: number,
  cutoff: number,
  pan: number
): { env: GainNode; osc: OscillatorNode; stop: (at: number) => void } {
  const osc = ac.createOscillator();
  osc.type = WAVE_TYPES[wave] ?? 'sine';
  osc.frequency.value = Math.max(1, frequency);
  const env = ac.createGain();
  env.gain.value = 0;

  let head: AudioNode = osc;
  if (cutoff > 0 && cutoff < ac.sampleRate / 2) {
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cutoff;
    lp.Q.value = 0.7;
    head.connect(lp);
    head = lp;
  }
  head.connect(env);

  let tail: AudioNode = env;
  if (pan !== 0 && typeof ac.createStereoPanner === 'function') {
    const p = ac.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    env.connect(p);
    tail = p;
  }
  tail.connect(master!);

  const stop = (at: number) => {
    osc.stop(at);
    osc.onended = () => {
      osc.disconnect();
      env.disconnect();
      if (tail !== env) tail.disconnect();
    };
  };
  return { env, osc, stop };
}

function firePluck(
  frequency: number,
  gain: number,
  decay: number,
  wave = 0,
  cutoff = 0,
  pan = 0
) {
  const ac = getContext();
  if (!ac) return;
  const g = clamp01(gain);
  if (g <= 0) return;
  const d = Math.max(0.01, decay);
  const t = ac.currentTime;
  const v = voice(ac, frequency, wave, cutoff, pan);
  v.env.gain.setValueAtTime(0, t);
  v.env.gain.linearRampToValueAtTime(g, t + ATTACK);
  // Exponential decay to -60 dB over `decay` seconds — the native pluck's
  // envelope shape (a plucked string's ring-down).
  v.env.gain.exponentialRampToValueAtTime(g * SILENCE, t + ATTACK + d);
  v.osc.start(t);
  v.stop(t + ATTACK + d + 0.02);
}

function fireADSR(
  frequency: number,
  gain: number,
  attack: number,
  decay: number,
  sustain: number,
  hold: number,
  release: number,
  wave = 0,
  cutoff = 0,
  pan = 0
) {
  const ac = getContext();
  if (!ac) return;
  const g = clamp01(gain);
  if (g <= 0) return;
  const a = Math.max(0.001, attack);
  const d = Math.max(0.001, decay);
  const s = clamp01(sustain);
  const h = Math.max(0, hold);
  const r = Math.max(0.005, release);
  const t = ac.currentTime;
  const v = voice(ac, frequency, wave, cutoff, pan);
  const env = v.env.gain;
  env.setValueAtTime(0, t);
  env.linearRampToValueAtTime(g, t + a);
  env.linearRampToValueAtTime(g * s, t + a + d);
  env.setValueAtTime(g * s, t + a + d + h);
  env.linearRampToValueAtTime(0, t + a + d + h + r);
  v.osc.start(t);
  v.stop(t + a + d + h + r + 0.02);
}

// One sustained, glide-able voice (the "bend" voice).
let bend: { osc: OscillatorNode; env: GainNode } | null = null;

class NoteSynthModule extends NativeModule {
  isAvailable(): boolean {
    if (typeof window === 'undefined') return false;
    return !!(window.AudioContext ?? (window as any).webkitAudioContext);
  }
  async pluck(frequency: number, gain: number, decay: number): Promise<void> {
    firePluck(frequency, gain, decay);
  }
  async playADSR(
    frequency: number,
    gain: number,
    attack: number,
    decay: number,
    sustain: number,
    hold: number,
    release: number
  ): Promise<void> {
    fireADSR(frequency, gain, attack, decay, sustain, hold, release);
  }
  async pluck2(
    frequency: number,
    gain: number,
    decay: number,
    wave: number,
    cutoff: number,
    pan: number
  ): Promise<void> {
    firePluck(frequency, gain, decay, wave, cutoff, pan);
  }
  async playADSR2(
    frequency: number,
    gain: number,
    attack: number,
    decay: number,
    sustain: number,
    hold: number,
    release: number,
    wave: number,
    cutoff: number,
    pan: number
  ): Promise<void> {
    fireADSR(frequency, gain, attack, decay, sustain, hold, release, wave, cutoff, pan);
  }

  // ---- wavetable engine / FX rack / mastering: native-only, no-ops here ----
  async loadTable(_slot: number, _frames: number, _data: number[]): Promise<boolean> {
    return false;
  }
  async setPatch(_slot: number, _params: Record<string, number>): Promise<void> {}
  async setPatchParam(_slot: number, _key: string, _value: number): Promise<void> {}
  async noteOn(_patch: number, _midi: number, _gain: number, _pan: number): Promise<number> {
    return -1;
  }
  async noteOff(_voice: number): Promise<void> {}
  async noteFire(
    _patch: number,
    _midi: number,
    _gain: number,
    _pan: number,
    _hold: number
  ): Promise<number> {
    return -1;
  }
  async releaseAll(): Promise<void> {}
  async setFxParam(_key: string, _value: number): Promise<void> {}
  async setFxPreset(_params: Record<string, number>): Promise<void> {}
  async setTremPattern(_steps: number[]): Promise<void> {}
  async setMasterParam(_key: string, _value: number): Promise<void> {}
  async setMasterPreset(_params: Record<string, number>): Promise<void> {}
  getMasterMeters(): MasterMeters {
    return { inRms: -90, outRms: -90, outPeak: -90, grLow: 0, grMid: 0, grHigh: 0, grLimiter: 0 };
  }
  resetMasterPeak(): void {}
  async setSynthFx(
    _reverbMix: number,
    _delayMix: number,
    _delayTime: number,
    _feedback: number
  ): Promise<void> {}

  // ---- bend voice ----
  async bendStart(frequency: number, gain: number): Promise<void> {
    const ac = getContext();
    if (!ac) return;
    await this.bendStop(0.02);
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = Math.max(1, frequency);
    const env = ac.createGain();
    env.gain.value = 0;
    osc.connect(env);
    env.connect(master!);
    const t = ac.currentTime;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(clamp01(gain), t + 0.01);
    osc.start(t);
    bend = { osc, env };
  }
  async bendSet(frequency: number): Promise<void> {
    if (!bend || !ctx) return;
    const t = ctx.currentTime;
    bend.osc.frequency.cancelScheduledValues(t);
    bend.osc.frequency.setTargetAtTime(Math.max(1, frequency), t, 0.015);
  }
  async bendStop(release: number): Promise<void> {
    if (!bend || !ctx) return;
    const { osc, env } = bend;
    bend = null;
    const t = ctx.currentTime;
    const r = Math.max(0.005, release);
    env.gain.cancelScheduledValues(t);
    env.gain.setValueAtTime(env.gain.value, t);
    env.gain.linearRampToValueAtTime(0, t + r);
    osc.stop(t + r + 0.02);
    osc.onended = () => {
      osc.disconnect();
      env.disconnect();
    };
  }
}

export default registerWebModule(NoteSynthModule, 'NoteSynthModule');
