import ExpoModulesCore
import CoreHaptics

// A small but real native seam: CoreHaptics gives continuous control over a
// haptic's intensity *and* sharpness, which the JS-only expo-haptics presets
// can't express. This is the kind of fine-grained capability you drop into
// Swift once, then drive from any JS sketch over-the-air.
public class FineHapticsModule: Module {
  private var engine: CHHapticEngine?

  public func definition() -> ModuleDefinition {
    Name("FineHaptics")

    // Whether this device can actually render CoreHaptics (iPhone 8+; not iPad/sim).
    Function("isSupported") { () -> Bool in
      return CHHapticEngine.capabilitiesForHardware().supportsHaptics
    }

    OnCreate {
      self.prepareEngine()
    }

    // Fire a single transient tap. intensity/sharpness are 0...1.
    // sharpness near 0 = soft/rounded thud, near 1 = crisp/tight click.
    AsyncFunction("transient") { (intensity: Double, sharpness: Double) in
      try self.play(intensity: intensity, sharpness: sharpness, duration: 0)
    }

    // Fire a sustained buzz for `duration` seconds at the given feel.
    AsyncFunction("continuous") { (intensity: Double, sharpness: Double, duration: Double) in
      try self.play(intensity: intensity, sharpness: sharpness, duration: duration)
    }
  }

  private func prepareEngine() {
    guard CHHapticEngine.capabilitiesForHardware().supportsHaptics else { return }
    engine = try? CHHapticEngine()
    // The engine can stop on its own (e.g. after backgrounding); restart on demand.
    engine?.resetHandler = { [weak self] in try? self?.engine?.start() }
    engine?.stoppedHandler = { _ in }
    try? engine?.start()
  }

  private func play(intensity: Double, sharpness: Double, duration: Double) throws {
    guard CHHapticEngine.capabilitiesForHardware().supportsHaptics else { return }
    if engine == nil { prepareEngine() }
    guard let engine else { return }
    try engine.start()

    let i = CHHapticEventParameter(parameterID: .hapticIntensity, value: Float(clamp(intensity)))
    let s = CHHapticEventParameter(parameterID: .hapticSharpness, value: Float(clamp(sharpness)))

    let event: CHHapticEvent
    if duration > 0 {
      event = CHHapticEvent(
        eventType: .hapticContinuous, parameters: [i, s],
        relativeTime: 0, duration: duration)
    } else {
      event = CHHapticEvent(eventType: .hapticTransient, parameters: [i, s], relativeTime: 0)
    }

    let pattern = try CHHapticPattern(events: [event], parameters: [])
    let player = try engine.makePlayer(with: pattern)
    try player.start(atTime: CHHapticTimeImmediate)
  }

  private func clamp(_ v: Double) -> Double { min(1, max(0, v)) }
}
