import ExpoModulesCore
import AVFoundation

// A small but real native seam: synthesized audio. JS can't make sound here
// (no Web Audio, no bundled audio module), so the synthesis lives in Swift and
// any sketch drives it over-the-air. This is a minimal sine "pluck": a sine
// oscillator per voice with an exponential amplitude decay, summed in an
// AVAudioSourceNode render callback.
public class NoteSynthModule: Module {
  private let engine = AVAudioEngine()
  private var sourceNode: AVAudioSourceNode?
  private var sampleRate: Double = 44100

  // Round-robin voice pool so overlapping plucks (the arp moving fast, or a
  // chord) don't cut each other off — an earlier voice keeps decaying while a
  // new one starts.
  private struct Voice {
    var active: Bool = false
    var phase: Double = 0
    var phaseInc: Double = 0
    var amp: Double = 0
    var decayMul: Double = 1
  }
  private let voiceCount = 16
  private var voices = [Voice]()
  private var nextVoice = 0
  private let lock = NSLock()

  public func definition() -> ModuleDefinition {
    Name("NoteSynth")

    OnCreate {
      self.configure()
    }

    // True once the audio engine is up and rendering.
    Function("isAvailable") { () -> Bool in
      return self.sourceNode != nil
    }

    // Trigger a sine pluck. frequency: Hz; gain: 0...1; decay: seconds to ~-60dB.
    AsyncFunction("pluck") { (frequency: Double, gain: Double, decay: Double) in
      self.trigger(frequency: frequency, gain: gain, decay: decay)
    }

    OnDestroy {
      self.engine.stop()
    }
  }

  private func configure() {
    voices = Array(repeating: Voice(), count: voiceCount)

    let session = AVAudioSession.sharedInstance()
    // .playback so it sounds with the ringer off; .mixWithOthers so it doesn't
    // stop the user's music.
    try? session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
    try? session.setActive(true)
    if session.sampleRate > 0 { sampleRate = session.sampleRate }

    guard let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 2) else {
      return
    }

    let node = AVAudioSourceNode(format: format) { [weak self] _, _, frameCount, ablPtr -> OSStatus in
      guard let self = self else { return noErr }
      let abl = UnsafeMutableAudioBufferListPointer(ablPtr)
      let frames = Int(frameCount)
      let twoPi = 2.0 * Double.pi

      self.lock.lock()
      for frame in 0..<frames {
        var mix = 0.0
        for i in 0..<self.voiceCount where self.voices[i].active {
          mix += sin(self.voices[i].phase) * self.voices[i].amp
          self.voices[i].phase += self.voices[i].phaseInc
          if self.voices[i].phase >= twoPi { self.voices[i].phase -= twoPi }
          self.voices[i].amp *= self.voices[i].decayMul
          if self.voices[i].amp < 0.0002 { self.voices[i].active = false }
        }
        // tanh soft-clip keeps summed voices bounded without harsh clipping.
        let sample = Float(tanh(mix))
        for buffer in abl {
          guard let data = buffer.mData else { continue }
          data.assumingMemoryBound(to: Float.self)[frame] = sample
        }
      }
      self.lock.unlock()
      return noErr
    }

    engine.attach(node)
    engine.connect(node, to: engine.mainMixerNode, format: format)
    sourceNode = node
    engine.prepare()
    try? engine.start()
  }

  private func trigger(frequency: Double, gain: Double, decay: Double) {
    // The engine can stop on its own (interruption, backgrounding) — restart.
    if !engine.isRunning {
      try? AVAudioSession.sharedInstance().setActive(true)
      try? engine.start()
    }

    let safeDecay = max(0.05, decay)
    // Per-sample multiplier so amplitude falls ~60dB (×0.001) over `decay` sec.
    let decayMul = pow(0.001, 1.0 / (safeDecay * sampleRate))
    let inc = 2.0 * Double.pi * frequency / sampleRate

    lock.lock()
    let idx = nextVoice
    nextVoice = (nextVoice + 1) % voiceCount
    voices[idx].active = true
    voices[idx].phase = 0
    voices[idx].phaseInc = inc
    voices[idx].amp = max(0.0, min(1.0, gain))
    voices[idx].decayMul = decayMul
    lock.unlock()
  }
}
