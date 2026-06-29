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
  //
  // A voice is one of two kinds, set at trigger time:
  //   - pluck: instant attack then exponential `decayMul` falloff (`amp`).
  //   - adsr:  a linear-segment Attack→Decay→Sustain(hold)→Release envelope
  //            (`env` scaled by `peak`), advanced by a per-voice stage machine.
  private enum Stage: Int { case attack, decay, sustain, release }
  private struct Voice {
    var active: Bool = false
    var phase: Double = 0
    var phaseInc: Double = 0
    // pluck
    var amp: Double = 0
    var decayMul: Double = 1
    // adsr
    var isADSR: Bool = false
    var stage: Stage = .attack
    var env: Double = 0          // current envelope level, 0...1
    var peak: Double = 0         // gain the envelope is scaled by
    var sustain: Double = 0      // sustain level, 0...1
    var atkInc: Double = 0       // per-sample rise during attack
    var decInc: Double = 0       // per-sample fall during decay
    var relInc: Double = 0       // per-sample fall during release
    var holdSamples: Int = 0     // samples to hold sustain before release
  }
  private let voiceCount = 16
  private var voices = [Voice]()
  private var nextVoice = 0
  private let lock = NSLock()

  // A single sustained "bend" voice, separate from the pluck pool: gate it on,
  // slide its frequency continuously (no phase reset → no clicks, true legato),
  // then gate it off. Its amplitude ramps toward the target each sample so the
  // gate on/off is click-free.
  private var bendOn = false
  private var bendGain: Double = 0
  private var bendAmp: Double = 0
  private var bendPhase: Double = 0
  private var bendPhaseInc: Double = 0

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

    // Trigger a one-shot sine note shaped by an ADSR envelope. attack/decay/
    // release are in seconds; sustain is the held level (0...1); hold is how
    // long (seconds) sustain is held before the release begins. This is a
    // gate-on-then-gate-off pulse: A → D → S(held for `hold`) → R.
    AsyncFunction("playADSR") {
      (frequency: Double, gain: Double, attack: Double, decay: Double,
       sustain: Double, hold: Double, release: Double) in
      self.triggerADSR(
        frequency: frequency, gain: gain, attack: attack, decay: decay,
        sustain: sustain, hold: hold, release: release)
    }

    // Gate on the sustained bend voice at a frequency/gain.
    AsyncFunction("bendStart") { (frequency: Double, gain: Double) in
      self.startEngineIfNeeded()
      self.lock.lock()
      self.bendOn = true
      self.bendGain = max(0.0, min(1.0, gain))
      self.bendPhaseInc = 2.0 * Double.pi * frequency / self.sampleRate
      self.lock.unlock()
    }

    // Slide the bend voice to a new frequency (no phase reset → smooth glide).
    AsyncFunction("bendSet") { (frequency: Double) in
      self.lock.lock()
      self.bendPhaseInc = 2.0 * Double.pi * frequency / self.sampleRate
      self.lock.unlock()
    }

    // Gate off the bend voice; its amplitude ramps to zero in the render loop.
    AsyncFunction("bendStop") { (_: Double) in
      self.lock.lock()
      self.bendOn = false
      self.lock.unlock()
    }

    OnDestroy {
      self.engine.stop()
    }
  }

  private func startEngineIfNeeded() {
    if !engine.isRunning {
      try? AVAudioSession.sharedInstance().setActive(true)
      try? engine.start()
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
          if self.voices[i].isADSR {
            // Advance the linear ADSR stage machine one sample.
            switch self.voices[i].stage {
            case .attack:
              self.voices[i].env += self.voices[i].atkInc
              if self.voices[i].env >= 1.0 {
                self.voices[i].env = 1.0
                self.voices[i].stage = .decay
              }
            case .decay:
              self.voices[i].env -= self.voices[i].decInc
              if self.voices[i].env <= self.voices[i].sustain {
                self.voices[i].env = self.voices[i].sustain
                self.voices[i].stage = .sustain
              }
            case .sustain:
              if self.voices[i].holdSamples > 0 {
                self.voices[i].holdSamples -= 1
              } else {
                self.voices[i].stage = .release
              }
            case .release:
              self.voices[i].env -= self.voices[i].relInc
              if self.voices[i].env <= 0.0 {
                self.voices[i].env = 0.0
                self.voices[i].active = false
              }
            }
            mix += sin(self.voices[i].phase) * self.voices[i].env * self.voices[i].peak
          } else {
            mix += sin(self.voices[i].phase) * self.voices[i].amp
            self.voices[i].amp *= self.voices[i].decayMul
            if self.voices[i].amp < 0.0002 { self.voices[i].active = false }
          }
          self.voices[i].phase += self.voices[i].phaseInc
          if self.voices[i].phase >= twoPi { self.voices[i].phase -= twoPi }
        }
        // Sustained bend voice: ramp amp toward the gate target (~5ms) so on/off
        // is click-free, slide pitch via phaseInc with no phase reset.
        if self.bendOn || self.bendAmp > 0.00001 {
          let target = self.bendOn ? self.bendGain : 0.0
          self.bendAmp += (target - self.bendAmp) * 0.006
          mix += sin(self.bendPhase) * self.bendAmp
          self.bendPhase += self.bendPhaseInc
          if self.bendPhase >= twoPi { self.bendPhase -= twoPi }
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
    voices[idx].isADSR = false
    voices[idx].phase = 0
    voices[idx].phaseInc = inc
    voices[idx].amp = max(0.0, min(1.0, gain))
    voices[idx].decayMul = decayMul
    lock.unlock()
  }

  private func triggerADSR(
    frequency: Double, gain: Double, attack: Double, decay: Double,
    sustain: Double, hold: Double, release: Double
  ) {
    if !engine.isRunning {
      try? AVAudioSession.sharedInstance().setActive(true)
      try? engine.start()
    }

    let sus = max(0.0, min(1.0, sustain))
    // At least one sample per ramp so increments stay finite.
    let atkSamples = max(1.0, attack * sampleRate)
    let decSamples = max(1.0, decay * sampleRate)
    let relSamples = max(1.0, release * sampleRate)
    let inc = 2.0 * Double.pi * frequency / sampleRate

    lock.lock()
    let idx = nextVoice
    nextVoice = (nextVoice + 1) % voiceCount
    voices[idx].active = true
    voices[idx].isADSR = true
    voices[idx].stage = .attack
    voices[idx].phase = 0
    voices[idx].phaseInc = inc
    voices[idx].env = 0
    voices[idx].peak = max(0.0, min(1.0, gain))
    voices[idx].sustain = sus
    voices[idx].atkInc = 1.0 / atkSamples
    voices[idx].decInc = (1.0 - sus) / decSamples
    voices[idx].relInc = max(sus, 0.0001) / relSamples
    voices[idx].holdSamples = Int(max(0.0, hold) * sampleRate)
    lock.unlock()
  }
}
