import { registerWebModule, NativeModule } from 'expo';

/** Oscillator shapes for the v2 voices, by native index. */
export const WAVES = { sine: 0, triangle: 1, saw: 2, square: 3 } as const;
export type WaveName = keyof typeof WAVES;

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
}

export default registerWebModule(NoteSynthModule, 'NoteSynthModule');
