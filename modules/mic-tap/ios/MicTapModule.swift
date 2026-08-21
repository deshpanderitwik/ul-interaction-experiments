import ExpoModulesCore
import AVFoundation

// The microphone seam, grown into a small sample engine. Three jobs:
//
// 1. LISTEN — an AVAudioEngine input tap streams the room into JS as
//    ready-to-draw waveform frames (peak bins + RMS). Raw PCM stays native.
// 2. CAPTURE — while listening, `recordStart`/`recordStop` keep the tap's PCM
//    in a named in-memory sample (capped), so a take can be replayed, not just
//    visualized. `saveWav` persists one to Documents.
// 3. PLAY — a pool of player voices (AVAudioPlayerNode → varispeed → lowpass
//    EQ → main mix) plays captured samples pitched (rate), gained, panned, and
//    optionally looped; the whole sample mix runs through a shared delay →
//    reverb tail (global wet/dry, off by default). Playback works without the
//    mic running.
//
// The session runs .playAndRecord (+defaultToSpeaker, mixWithOthers) while the
// mic is on and hands back to .playback on stop so the synth stays loud.
public class MicTapModule: Module {
  private let engine = AVAudioEngine()
  private var running = false // mic tap installed and capturing
  private var graphBuilt = false
  // Seconds of audio per emitted waveform column.
  private let binSeconds = 0.016

  // Capture: PCM appended by the tap while `recording`, then stored by id.
  private var recording = false
  private var recBuf: [Float] = []
  private var recRate: Double = 48000
  private let recCapSeconds = 60.0
  private var samples: [Int: (data: [Float], rate: Double)] = [:]
  private var nextSampleId = 1

  // Playback: a fixed pool of player chains. `chainRate` tracks the sample
  // rate each chain is currently connected at (reconnect only on change).
  private let voiceCount = 8
  private var players: [AVAudioPlayerNode] = []
  private var speeds: [AVAudioUnitVarispeed] = []
  private var eqs: [AVAudioUnitEQ] = []
  private var busyVoice: [Bool] = []
  private var chainRate: [Double] = []
  private let delay = AVAudioUnitDelay()
  private let reverb = AVAudioUnitReverb()
  private let lock = NSLock()

  // Granular engine (GrainEngine.swift): grain clouds over captured samples,
  // rendered by a dedicated source node into the same FX tail.
  private var grainEngine: GrainEngine?
  private var grainNode: AVAudioSourceNode?
  private let grainRate: Double = 48000
  // Ceiling guard on the grain bus (mirrors the synth bus's mastering limiter).
  private var grainLimiter: MiniLimiter?

  public func definition() -> ModuleDefinition {
    Name("MicTap")

    Events("onAudio", "onVoiceEnd")

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

    // Stop capturing (idempotent). Frames already delivered stay with JS.
    AsyncFunction("stop") {
      DispatchQueue.main.async {
        self.end()
      }
    }

    // Begin keeping the tap's PCM (mic must be running). Any in-progress
    // recording is discarded. Recording is capped at ~60s.
    AsyncFunction("recordStart") { () -> Bool in
      guard self.running else { return false }
      self.lock.lock()
      self.recBuf.removeAll(keepingCapacity: true)
      self.recording = true
      self.lock.unlock()
      return true
    }

    // Stop keeping PCM and store the take. Returns {id, duration, sampleRate},
    // or id -1 if nothing was recorded.
    AsyncFunction("recordStop") { () -> [String: Any] in
      self.lock.lock()
      self.recording = false
      let data = self.recBuf
      let rate = self.recRate
      self.recBuf = []
      self.lock.unlock()
      guard data.count > 0, rate > 0 else {
        return ["id": -1, "duration": 0.0, "sampleRate": rate]
      }
      let id = self.nextSampleId
      self.nextSampleId += 1
      self.samples[id] = (data: data, rate: rate)
      return ["id": id, "duration": Double(data.count) / rate, "sampleRate": rate]
    }

    // Drop a stored sample.
    AsyncFunction("discard") { (id: Int) in
      self.samples.removeValue(forKey: id)
    }

    // Play a stored sample on a free voice. rate re-pitches (0.25–4, 1 = as
    // recorded); gain 0..1; pan -1..1; cutoff Hz (<= 0 bypasses the lowpass);
    // loop repeats until stopVoice; start/end are 0..1 fractions of the
    // sample. Returns the voice handle, or -1 if none was free.
    AsyncFunction("play") {
      (id: Int, rate: Double, gain: Double, pan: Double, cutoff: Double,
       loop: Bool, startFrac: Double, endFrac: Double) -> Int in
      return self.playSample(
        id: id, rate: rate, gain: gain, pan: pan, cutoff: cutoff,
        loop: loop, startFrac: startFrac, endFrac: endFrac)
    }

    // Retune a sounding voice (any argument < -900 leaves that field as-is).
    AsyncFunction("setVoice") { (voice: Int, rate: Double, gain: Double, pan: Double, cutoff: Double) in
      guard voice >= 0 && voice < self.voiceCount else { return }
      if rate > -900 { self.speeds[voice].rate = Float(max(0.25, min(4.0, rate))) }
      if gain > -900 { self.players[voice].volume = Float(max(0.0, min(1.0, gain))) }
      if pan > -900 { self.players[voice].pan = Float(max(-1.0, min(1.0, pan))) }
      if cutoff > -900 { self.setCutoff(voice: voice, cutoff: cutoff) }
    }

    // Stop a voice (frees it for reuse).
    AsyncFunction("stopVoice") { (voice: Int) in
      guard voice >= 0 && voice < self.voiceCount else { return }
      self.players[voice].stop()
      self.lock.lock()
      self.busyVoice[voice] = false
      self.lock.unlock()
    }

    // Global sample-bus FX. Mixes are 0–100 (wet %); delayTime seconds;
    // feedback 0–100. Both default to fully dry.
    AsyncFunction("setFx") { (reverbMix: Double, delayMix: Double, delayTime: Double, feedback: Double) in
      self.reverb.wetDryMix = Float(max(0.0, min(100.0, reverbMix)))
      self.delay.wetDryMix = Float(max(0.0, min(100.0, delayMix)))
      if delayTime >= 0 { self.delay.delayTime = TimeInterval(min(2.0, delayTime)) }
      if feedback >= 0 { self.delay.feedback = Float(min(95.0, feedback)) }
    }

    // ---- granulator (GrainEngine.swift) ----

    // Set one grain-patch parameter (4 slots). Keys: position, spray, scan,
    // size (ms), sizeJitter, density (grains/s), timeJitter, pitch (semis),
    // pitchJitter, reverse (probability), attack, release (window fractions),
    // panSpray, gainJitter, quantize (1 = snap grain pitch to the scale),
    // amp.a/d/s/r (cloud envelope).
    AsyncFunction("setGrainParam") { (slot: Int, key: String, value: Double) in
      self.lock.lock()
      self.grainEngine?.setParam(slot, key, value)
      self.lock.unlock()
    }

    // Set many grain-patch parameters at once.
    AsyncFunction("setGrainPatch") { (slot: Int, params: [String: Double]) in
      self.lock.lock()
      for (k, v) in params { self.grainEngine?.setParam(slot, k, v) }
      self.lock.unlock()
    }

    // Scale for quantized grains: semitone pitch classes (e.g. [0,2,3,5,7,8,10]).
    // Empty = chromatic.
    AsyncFunction("setGrainScale") { (pitchClasses: [Double]) in
      self.lock.lock()
      self.grainEngine?.setScale(pitchClasses)
      self.lock.unlock()
    }

    // Gate a grain cloud on over a captured sample: semis transposes every
    // grain (0 = as recorded). Returns a voice handle, or -1.
    AsyncFunction("grainOn") { (patch: Int, sample: Int, semis: Double, gain: Double, pan: Double) -> Int in
      return self.startGrainVoice(patch: patch, sample: sample, semis: semis, gain: gain, pan: pan, hold: -1)
    }

    // One-shot cloud: gate on, hold `hold` seconds, then auto-release.
    AsyncFunction("grainFire") { (patch: Int, sample: Int, semis: Double, gain: Double, pan: Double, hold: Double) -> Int in
      return self.startGrainVoice(patch: patch, sample: sample, semis: semis, gain: gain, pan: pan, hold: max(0, hold))
    }

    // Release a cloud (enters its envelope release).
    AsyncFunction("grainOff") { (voice: Int) in
      self.lock.lock()
      self.grainEngine?.noteOff(voice)
      self.lock.unlock()
    }

    // Live per-cloud control — scrubbing: position 0..1 moves the read head
    // under the finger. Pass -999 for any field to leave it as-is.
    AsyncFunction("grainSet") { (voice: Int, position: Double, gain: Double, pan: Double, semis: Double) in
      self.lock.lock()
      self.grainEngine?.set(voice, position: position, gain: gain, pan: pan, semis: semis)
      self.lock.unlock()
    }

    // All clouds → release (soft panic).
    AsyncFunction("grainReleaseAll") {
      self.lock.lock()
      self.grainEngine?.releaseAll()
      self.lock.unlock()
    }

    // Grain-bus ceiling guard (a lookahead limiter matching the synth bus's
    // mastering limiter): gain/ceiling in dB, release ms. Pass -999 to leave
    // a field as-is.
    AsyncFunction("setSampleLimiter") { (onOff: Double, gain: Double, ceiling: Double, release: Double) in
      self.lock.lock()
      if let lim = self.grainLimiter {
        if onOff > -900 { lim.on = onOff }
        if gain > -900 { lim.gainDb = gain }
        if ceiling > -900 { lim.ceilingDb = ceiling }
        if release > -900 { lim.releaseMs = release }
      }
      self.lock.unlock()
    }

    // Write a stored sample to Documents as a WAV; returns the file path.
    AsyncFunction("saveWav") { (id: Int) -> String in
      guard let s = self.samples[id],
        let fmt = AVAudioFormat(standardFormatWithSampleRate: s.rate, channels: 1),
        let buf = self.pcmBuffer(from: s.data, format: fmt)
      else {
        throw NSError(
          domain: "MicTap", code: 2,
          userInfo: [NSLocalizedDescriptionKey: "Unknown sample id"])
      }
      let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
      let url = dir.appendingPathComponent("sample-\(id).wav")
      let file = try AVAudioFile(forWriting: url, settings: fmt.settings)
      try file.write(from: buf)
      return url.path
    }

    OnCreate {
      self.buildGraph()
    }

    OnDestroy {
      self.engine.stop()
    }
  }

  private func requestMicPermission(_ completion: @escaping (Bool) -> Void) {
    if #available(iOS 17.0, *) {
      AVAudioApplication.requestRecordPermission(completionHandler: completion)
    } else {
      AVAudioSession.sharedInstance().requestRecordPermission(completion)
    }
  }

  // Attach and wire the playback pool + FX tail once. Never touches inputNode
  // (that happens only in begin()), so playback alone doesn't claim the mic.
  private func buildGraph() {
    guard !graphBuilt else { return }
    graphBuilt = true
    let mono = AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 1)
    for _ in 0..<voiceCount {
      let p = AVAudioPlayerNode()
      let v = AVAudioUnitVarispeed()
      let eq = AVAudioUnitEQ(numberOfBands: 1)
      let band = eq.bands[0]
      band.filterType = .lowPass
      band.frequency = 20000
      band.bypass = true
      engine.attach(p)
      engine.attach(v)
      engine.attach(eq)
      engine.connect(p, to: v, format: mono)
      engine.connect(v, to: eq, format: mono)
      engine.connect(eq, to: engine.mainMixerNode, format: mono)
      players.append(p)
      speeds.append(v)
      eqs.append(eq)
      busyVoice.append(false)
      chainRate.append(48000)
    }
    engine.attach(delay)
    engine.attach(reverb)
    delay.wetDryMix = 0
    delay.delayTime = 0.3
    delay.feedback = 30
    reverb.loadFactoryPreset(.mediumHall)
    reverb.wetDryMix = 0
    // Re-patch the output so every sample voice runs through delay → reverb.
    engine.connect(engine.mainMixerNode, to: delay, format: nil)
    engine.connect(delay, to: reverb, format: nil)
    engine.connect(reverb, to: engine.outputNode, format: nil)

    // Granulator: its own stereo source node into the main mix (and so
    // through the same delay → reverb tail).
    let ge = GrainEngine(sampleRate: grainRate)
    grainEngine = ge
    grainLimiter = MiniLimiter(sampleRate: grainRate)
    if let stereo = AVAudioFormat(standardFormatWithSampleRate: grainRate, channels: 2) {
      let node = AVAudioSourceNode(format: stereo) { [weak self] _, _, frameCount, ablPtr -> OSStatus in
        guard let self = self, let engine = self.grainEngine else { return noErr }
        let abl = UnsafeMutableAudioBufferListPointer(ablPtr)
        let frames = Int(frameCount)
        self.lock.lock()
        for frame in 0..<frames {
          var (l, r) = engine.processSample()
          self.grainLimiter?.process(&l, &r)
          let sL = Float(max(-1.0, min(1.0, l)))
          let sR = Float(max(-1.0, min(1.0, r)))
          for (ci, buffer) in abl.enumerated() {
            guard let data = buffer.mData else { continue }
            data.assumingMemoryBound(to: Float.self)[frame] = ci == 0 ? sL : sR
          }
        }
        self.lock.unlock()
        return noErr
      }
      engine.attach(node)
      engine.connect(node, to: engine.mainMixerNode, format: stereo)
      grainNode = node
    }
  }

  private func startGrainVoice(
    patch: Int, sample: Int, semis: Double, gain: Double, pan: Double, hold: Double
  ) -> Int {
    guard let s = samples[sample], let ge = grainEngine else { return -1 }
    do {
      try ensurePlaybackRunning()
    } catch {
      return -1
    }
    lock.lock()
    let voice = ge.noteOn(
      patch: patch, data: s.data, srcRate: s.rate, semis: semis,
      gain: gain, pan: pan, hold: hold)
    lock.unlock()
    return voice
  }

  private func setCutoff(voice: Int, cutoff: Double) {
    let band = eqs[voice].bands[0]
    if cutoff > 0 && cutoff < 20000 {
      band.frequency = Float(cutoff)
      band.bypass = false
    } else {
      band.bypass = true
    }
  }

  private func ensurePlaybackRunning() throws {
    if !engine.isRunning {
      try? AVAudioSession.sharedInstance().setActive(true)
      try engine.start()
    }
  }

  private func pcmBuffer(from data: [Float], format: AVAudioFormat) -> AVAudioPCMBuffer? {
    guard data.count > 0,
      let buf = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(data.count))
    else { return nil }
    buf.frameLength = AVAudioFrameCount(data.count)
    if let ch = buf.floatChannelData?[0] {
      data.withUnsafeBufferPointer { src in
        ch.update(from: src.baseAddress!, count: data.count)
      }
    }
    return buf
  }

  private func playSample(
    id: Int, rate: Double, gain: Double, pan: Double, cutoff: Double,
    loop: Bool, startFrac: Double, endFrac: Double
  ) -> Int {
    guard let s = self.samples[id] else { return -1 }

    // Claim a free voice.
    lock.lock()
    var voice = -1
    for i in 0..<voiceCount where !busyVoice[i] {
      voice = i
      busyVoice[i] = true
      break
    }
    lock.unlock()
    guard voice >= 0 else { return -1 }

    // Slice the requested window.
    let n = s.data.count
    let a = max(0, min(n - 1, Int(Double(n) * max(0.0, min(1.0, startFrac)))))
    let bEnd = max(a + 1, min(n, Int(Double(n) * (endFrac <= 0 ? 1.0 : max(0.0, min(1.0, endFrac))))))
    let slice = Array(s.data[a..<bEnd])

    guard let fmt = AVAudioFormat(standardFormatWithSampleRate: s.rate, channels: 1),
      let buf = pcmBuffer(from: slice, format: fmt)
    else {
      lock.lock()
      busyVoice[voice] = false
      lock.unlock()
      return -1
    }

    // The player chain must be connected at the sample's rate; reconnect only
    // when it changes (the main mixer converts to hardware rate downstream).
    players[voice].stop()
    if chainRate[voice] != s.rate {
      engine.disconnectNodeOutput(players[voice])
      engine.disconnectNodeOutput(speeds[voice])
      engine.disconnectNodeOutput(eqs[voice])
      engine.connect(players[voice], to: speeds[voice], format: fmt)
      engine.connect(speeds[voice], to: eqs[voice], format: fmt)
      engine.connect(eqs[voice], to: engine.mainMixerNode, format: fmt)
      chainRate[voice] = s.rate
    }

    speeds[voice].rate = Float(max(0.25, min(4.0, rate)))
    players[voice].volume = Float(max(0.0, min(1.0, gain)))
    players[voice].pan = Float(max(-1.0, min(1.0, pan)))
    setCutoff(voice: voice, cutoff: cutoff)

    do {
      try ensurePlaybackRunning()
    } catch {
      lock.lock()
      busyVoice[voice] = false
      lock.unlock()
      return -1
    }

    let v = voice
    if loop {
      players[voice].scheduleBuffer(buf, at: nil, options: [.loops], completionHandler: nil)
    } else {
      players[voice].scheduleBuffer(
        buf, at: nil, options: [], completionCallbackType: .dataPlayedBack
      ) { [weak self] _ in
        guard let self = self else { return }
        self.lock.lock()
        self.busyVoice[v] = false
        self.lock.unlock()
        self.sendEvent("onVoiceEnd", ["voice": v])
      }
    }
    players[voice].play()
    return voice
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
    recRate = format.sampleRate

    input.removeTap(onBus: 0)
    input.installTap(onBus: 0, bufferSize: 2048, format: format) { [weak self] buffer, _ in
      guard let self = self, self.running else { return }
      guard let data = buffer.floatChannelData?[0] else { return }
      let n = Int(buffer.frameLength)
      if n == 0 { return }

      // Keep PCM while recording (bounded by the cap).
      self.lock.lock()
      if self.recording {
        let cap = Int(self.recCapSeconds * format.sampleRate)
        let room = cap - self.recBuf.count
        if room > 0 {
          let take = min(room, n)
          self.recBuf.append(contentsOf: UnsafeBufferPointer(start: data, count: take))
        }
      }
      self.lock.unlock()

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
    let wasRunning = running
    if wasRunning {
      engine.inputNode.removeTap(onBus: 0)
    }
    running = false
    lock.lock()
    recording = false
    lock.unlock()
    // Keep the engine alive if any sample voice or grain cloud is still
    // sounding; otherwise stop it and hand the session back to playback-only
    // so the synth stays on the loud speaker route with the mic released.
    lock.lock()
    let anyVoice = busyVoice.contains(true) || (grainEngine?.anyActive ?? false)
    lock.unlock()
    if !anyVoice {
      engine.stop()
    }
    let session = AVAudioSession.sharedInstance()
    try? session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
    try? session.setActive(true)
  }
}
