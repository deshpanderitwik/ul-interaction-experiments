import ExpoModulesCore
import AVFoundation

// The microphone seam: an AVAudioEngine input tap that streams the room into JS
// as ready-to-draw waveform frames. Raw PCM stays native — each tap buffer is
// folded down to a handful of peak bins (one per ~16ms of audio, so the JS-side
// scroll rate is the same no matter what buffer size the OS grants) plus an RMS
// level, and shipped over the bridge as an "onAudio" event. Start asks for mic
// permission on first use; stop tears the tap down and hands the audio session
// back to playback so the synth experiments stay loud on the speaker.
public class MicTapModule: Module {
  private let engine = AVAudioEngine()
  private var running = false
  // Seconds of audio per emitted waveform column.
  private let binSeconds = 0.016

  public func definition() -> ModuleDefinition {
    Name("MicTap")

    Events("onAudio")

    // True while the tap is installed and the engine is capturing.
    Function("isRunning") { () -> Bool in
      return self.running
    }

    // Ask for mic permission (first time) and start capturing. Resolves true
    // once audio is flowing, false if the user denied the microphone.
    AsyncFunction("start") { (promise: Promise) in
      if self.running {
        promise.resolve(true)
        return
      }
      self.requestMicPermission { granted in
        DispatchQueue.main.async {
          guard granted else {
            promise.resolve(false)
            return
          }
          do {
            try self.begin()
            promise.resolve(true)
          } catch {
            promise.reject("ERR_MIC_TAP", error.localizedDescription)
          }
        }
      }
    }

    // Stop capturing (idempotent). The last emitted frames stay with JS, so a
    // paused waveform keeps whatever it was showing.
    AsyncFunction("stop") {
      DispatchQueue.main.async {
        self.end()
      }
    }

    OnDestroy {
      self.end()
    }
  }

  private func requestMicPermission(_ completion: @escaping (Bool) -> Void) {
    if #available(iOS 17.0, *) {
      AVAudioApplication.requestRecordPermission(completionHandler: completion)
    } else {
      AVAudioSession.sharedInstance().requestRecordPermission(completion)
    }
  }

  private func begin() throws {
    let session = AVAudioSession.sharedInstance()
    // .playAndRecord so the synth keeps sounding while the mic listens;
    // .defaultToSpeaker because that category otherwise routes output to the
    // earpiece; .mixWithOthers to keep the user's music alive.
    try session.setCategory(
      .playAndRecord, mode: .default, options: [.defaultToSpeaker, .mixWithOthers])
    try session.setActive(true)

    let input = engine.inputNode
    let format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0 else {
      throw NSError(
        domain: "MicTap", code: 1,
        userInfo: [NSLocalizedDescriptionKey: "No audio input available"])
    }

    input.removeTap(onBus: 0)
    input.installTap(onBus: 0, bufferSize: 2048, format: format) { [weak self] buffer, _ in
      guard let self = self, self.running else { return }
      guard let data = buffer.floatChannelData?[0] else { return }
      let n = Int(buffer.frameLength)
      if n == 0 { return }

      // One peak bin per ~binSeconds of audio, so column rate is constant even
      // though iOS grants whatever tap buffer size it likes.
      let bins = max(1, Int((Double(n) / format.sampleRate / self.binSeconds).rounded()))
      var peaks = [Double](repeating: 0, count: bins)
      var sumSq = 0.0
      for i in 0..<n {
        let v = Double(data[i])
        sumSq += v * v
        let b = min(bins - 1, i * bins / n)
        let a = abs(v)
        if a > peaks[b] { peaks[b] = a }
      }
      let rms = (sumSq / Double(n)).squareRoot()

      self.sendEvent(
        "onAudio",
        [
          "peaks": peaks,
          "rms": rms,
          "sampleRate": format.sampleRate,
        ])
    }

    engine.prepare()
    try engine.start()
    running = true
  }

  private func end() {
    guard running || engine.isRunning else { return }
    engine.inputNode.removeTap(onBus: 0)
    engine.stop()
    running = false
    // Hand the session back to playback-only so the synth experiments stay on
    // the loud speaker route with the mic released.
    let session = AVAudioSession.sharedInstance()
    try? session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
    try? session.setActive(true)
  }
}
