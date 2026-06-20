import { NativeModule, requireNativeModule } from 'expo';

// The shape of the native module, as seen from JS. Each method maps 1:1 to a
// Function/AsyncFunction in FineHapticsModule.swift.
declare class FineHapticsModule extends NativeModule {
  /** True only on devices with a CoreHaptics-capable Taptic Engine. */
  isSupported(): boolean;
  /** A single tap. intensity & sharpness are 0..1. */
  transient(intensity: number, sharpness: number): Promise<void>;
  /** A sustained buzz for `duration` seconds. */
  continuous(intensity: number, sharpness: number, duration: number): Promise<void>;
}

export default requireNativeModule<FineHapticsModule>('FineHaptics');
