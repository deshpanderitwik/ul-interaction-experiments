import { registerWebModule, NativeModule } from 'expo';

// No haptics on web — these are no-ops so sketches can run in the browser
// during development without crashing.
class FineHapticsModule extends NativeModule {
  isSupported(): boolean {
    return false;
  }
  async transient(_intensity: number, _sharpness: number): Promise<void> {}
  async continuous(_intensity: number, _sharpness: number, _duration: number): Promise<void> {}
}

export default registerWebModule(FineHapticsModule, 'FineHapticsModule');
