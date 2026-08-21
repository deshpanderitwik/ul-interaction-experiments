import { registerWebModule, NativeModule } from 'expo';

/** Oscillator shapes for the v2 voices, by native index. */
export const WAVES = { sine: 0, triangle: 1, saw: 2, square: 3 } as const;
export type WaveName = keyof typeof WAVES;
export const TABLES = { basic: 0, buzz: 1, vowel: 2 } as const;
export const WARPS = { none: 0, sync: 1, bend: 2, mirror: 3, pwm: 4, quantize: 5, fmFromB: 6 } as const;
export const FILTERS = { off: 0, lowpass: 1, highpass: 2, bandpass: 3, notch: 4 } as const;
export const LFO_SHAPES = { sine: 0, triangle: 1, saw: 2, square: 3, sampleHold: 4 } as const;
export type PatchParams = Record<string, number>;

// No synth on web — no-ops so sketches can run in the browser during
// development without crashing.
class NoteSynthModule extends NativeModule {
  isAvailable(): boolean {
    return false;
  }
  async pluck(_frequency: number, _gain: number, _decay: number): Promise<void> {}
  async playADSR(
    _frequency: number,
    _gain: number,
    _attack: number,
    _decay: number,
    _sustain: number,
    _hold: number,
    _release: number
  ): Promise<void> {}
  async pluck2(
    _frequency: number,
    _gain: number,
    _decay: number,
    _wave: number,
    _cutoff: number,
    _pan: number
  ): Promise<void> {}
  async playADSR2(
    _frequency: number,
    _gain: number,
    _attack: number,
    _decay: number,
    _sustain: number,
    _hold: number,
    _release: number,
    _wave: number,
    _cutoff: number,
    _pan: number
  ): Promise<void> {}
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
  async setSynthFx(
    _reverbMix: number,
    _delayMix: number,
    _delayTime: number,
    _feedback: number
  ): Promise<void> {}
}

export default registerWebModule(NoteSynthModule, 'NoteSynthModule');
