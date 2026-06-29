import { registerWebModule, NativeModule } from 'expo';

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
}

export default registerWebModule(NoteSynthModule, 'NoteSynthModule');
