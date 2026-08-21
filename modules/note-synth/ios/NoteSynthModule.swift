import ExpoModulesCore
import AVFoundation

// The synth seam, grown into a small wavetable engine (Serum's skeleton):
//
// - WAVETABLES — 8 table slots, each up to 16 frames of 2048 samples. Three
//   built-ins (basic-shapes morph, harmonic buzz, vowel-ish formants) are
//   synthesized spectrally at startup; JS can upload its own tables (a drawn
//   gesture can BE a timbre). Every table is mip-mapped at load: 10 band-limited
//   levels via FFT so high notes read fewer harmonics — no aliasing.
// - VOICES — up to 10 wavetable voices, each: two wavetable oscillators (per-osc
//   frame position, unison 1–7 with detune/stereo spread, semitone offset, warp
//   modes incl. sync/bend/mirror/PWM/quantize/FM-from-B), a sine sub, a noise
//   source, a TPT state-variable filter (LP/HP/BP/notch) with keytracking, amp
//   ADSR + assignable ADSR (cutoff/position/pitch), two LFOs (pitch/cutoff/
//   position/amp/pan), glide, and a tanh drive.
// - PATCHES — 8 patch slots set from JS as flat {key: value} dictionaries.
//   Sounding voices read their patch live, so setPatchParam is a macro knob:
//   sweeps and morphs stream over the bridge as plain numbers.
// - FX — the whole synth runs through a shared delay → reverb tail (dry by
//   default, wet/dry from JS).
//
// The legacy API (pluck / playADSR / pluck2 / playADSR2 / bend*) is preserved
// untouched on its own voice pool, so every existing sketch keeps sounding
// exactly as it did.
public class NoteSynthModule: Module {
  private let engine = AVAudioEngine()
  private var sourceNode: AVAudioSourceNode?
  private var sampleRate: Double = 44100
  private let delayFx = AVAudioUnitDelay()
  private let reverbFx = AVAudioUnitReverb()
  // Soundtoys-flavored insert rack (FxRack.swift), processing the stereo mix
  // pre-master-clip. Self-bypasses when every unit is off.
  private var fxRack: FxRack?

  // MARK: - Legacy voice pool (unchanged behavior)

  private enum Stage: Int { case attack, decay, sustain, release }
  private struct Voice {
    var active: Bool = false
    var phase: Double = 0
    var phaseInc: Double = 0
    var amp: Double = 0
    var decayMul: Double = 1
    var isADSR: Bool = false
    var stage: Stage = .attack
    var env: Double = 0
    var peak: Double = 0
    var sustain: Double = 0
    var atkInc: Double = 0
    var decInc: Double = 0
    var relInc: Double = 0
    var holdSamples: Int = 0
    var wave: Int = 0
    var lpAlpha: Double = 1
    var lpState: Double = 0
    var gL: Double = 1
    var gR: Double = 1
  }
  private let voiceCount = 16
  private var voices = [Voice]()
  private var nextVoice = 0
  private let lock = NSLock()

  private var bendOn = false
  private var bendGain: Double = 0
  private var bendAmp: Double = 0
  private var bendPhase: Double = 0
  private var bendPhaseInc: Double = 0

  // MARK: - Wavetable engine data

  private static let WT_SIZE = 2048
  private static let WT_MIPS = 10
  private static let MAX_FRAMES = 16
  private static let TABLE_SLOTS = 8
  private static let PATCH_SLOTS = 8
  private static let WT_VOICES = 10
  private static let MAX_UNISON = 7
  private static let CTRL = 32 // samples per control-rate tick

  // A loaded table: mip-mapped frames, flattened [mip][frame][sample].
  private final class WTTable {
    let frames: Int
    let data: [Float]
    init(frames: Int, data: [Float]) {
      self.frames = frames
      self.data = data
    }
  }

  private struct OscParams {
    var on: Double = 0
    var table: Double = 0
    var pos: Double = 0 // 0..1 across the table's frames
    var unison: Double = 1
    var detune: Double = 12 // cents, spread across the unison stack
    var spread: Double = 0.6 // stereo width of the stack, 0..1
    var level: Double = 0.7
    var semi: Double = 0 // semitone offset
    var warp: Int = 0 // 0 none 1 sync 2 bend 3 mirror 4 pwm 5 quantize 6 fmFromB
    var warpAmt: Double = 0
    var phaseRand: Double = 1 // 0 = phase-locked copies, 1 = randomized
  }
  private struct WTPatch {
    var oscA = OscParams(on: 1)
    var oscB = OscParams()
    var subLevel: Double = 0
    var noiseLevel: Double = 0
    var ampA: Double = 0.005
    var ampD: Double = 0.2
    var ampS: Double = 0.0
    var ampR: Double = 0.15
    var e2A: Double = 0.005
    var e2D: Double = 0.2
    var e2S: Double = 0.0
    var e2R: Double = 0.15
    var e2ToCutoff: Double = 0 // Hz added at env peak
    var e2ToPos: Double = 0 // table-position added at env peak
    var e2ToPitch: Double = 0 // semitones at env peak
    var lfo1Shape: Int = 0 // 0 sine 1 tri 2 saw 3 square 4 s&h
    var lfo1Hz: Double = 5
    var lfo1ToPitch: Double = 0
    var lfo1ToCutoff: Double = 0
    var lfo1ToPos: Double = 0
    var lfo1ToAmp: Double = 0
    var lfo1ToPan: Double = 0
    var lfo2Shape: Int = 0
    var lfo2Hz: Double = 0.5
    var lfo2ToPitch: Double = 0
    var lfo2ToCutoff: Double = 0
    var lfo2ToPos: Double = 0
    var lfo2ToAmp: Double = 0
    var lfo2ToPan: Double = 0
    var filterType: Int = 0 // 0 off 1 LP 2 HP 3 BP 4 notch
    var cutoff: Double = 8000
    var res: Double = 0.2 // 0..1
    var keytrack: Double = 0 // 0..1: cutoff follows note
    var drive: Double = 0
    var glide: Double = 0 // seconds per octave-ish slew
  }

  private struct WTVoice {
    var active = false
    var gate = false
    var patch = 0
    var age = 0
    var gain: Double = 1
    var pan: Double = 0
    // pitch / glide (semitone domain)
    var semiCur: Double = 60
    var semiTarget: Double = 60
    // oscillator phases: [osc0 copies 0..6, osc1 copies 0..6], 0..1 domain
    var phases = [Double](repeating: 0, count: 14)
    var ratios = [Double](repeating: 1, count: 14) // unison detune ratios
    var subPhase: Double = 0
    var rng: UInt32 = 1
    var sh1: Double = 0 // sample & hold LFO memories
    var sh2: Double = 0
    var lfo1P: Double = 0
    var lfo2P: Double = 0
    // envelopes
    var env1Stage = Stage.attack
    var env1: Double = 0
    var env2Stage = Stage.attack
    var env2: Double = 0
    var holdSamples = -1 // >= 0: auto-release countdown (noteFire)
    // filter state (stereo TPT SVF)
    var ic1L: Double = 0
    var ic2L: Double = 0
    var ic1R: Double = 0
    var ic2R: Double = 0
    // control-rate cached values
    var cIncA: Double = 0
    var cIncB: Double = 0
    var cMipA = 0
    var cMipB = 0
    var cPosA: Double = 0
    var cPosB: Double = 0
    var cG: Double = 0 // filter coefficients
    var cK: Double = 1
    var cAmpMod: Double = 1
    var cPanMod: Double = 0
  }

  private var tables = [WTTable?](repeating: nil, count: TABLE_SLOTS)
  private var patches = [WTPatch](repeating: WTPatch(), count: PATCH_SLOTS)
  private var wtVoices = [WTVoice](repeating: WTVoice(), count: WT_VOICES)
  private var wtAge = 0
  private var ctrlCountdown = 0
  private var lastSemiPerPatch = [Double](repeating: 60, count: PATCH_SLOTS)

  // MARK: - Module definition

  public func definition() -> ModuleDefinition {
    Name("NoteSynth")

    OnCreate {
      self.configure()
    }

    Function("isAvailable") { () -> Bool in
      return self.sourceNode != nil
    }

    // ---- legacy API (unchanged) ----

    AsyncFunction("pluck") { (frequency: Double, gain: Double, decay: Double) in
      self.trigger(frequency: frequency, gain: gain, decay: decay)
    }

    AsyncFunction("playADSR") {
      (frequency: Double, gain: Double, attack: Double, decay: Double,
       sustain: Double, hold: Double, release: Double) in
      self.triggerADSR(
        frequency: frequency, gain: gain, attack: attack, decay: decay,
        sustain: sustain, hold: hold, release: release)
    }

    AsyncFunction("pluck2") {
      (frequency: Double, gain: Double, decay: Double, wave: Int, cutoff: Double, pan: Double) in
      self.trigger(
        frequency: frequency, gain: gain, decay: decay,
        wave: wave, cutoff: cutoff, pan: pan)
    }

    AsyncFunction("playADSR2") {
      (frequency: Double, gain: Double, attack: Double, decay: Double,
       sustain: Double, hold: Double, release: Double,
       wave: Int, cutoff: Double, pan: Double) in
      self.triggerADSR(
        frequency: frequency, gain: gain, attack: attack, decay: decay,
        sustain: sustain, hold: hold, release: release,
        wave: wave, cutoff: cutoff, pan: pan)
    }

    AsyncFunction("bendStart") { (frequency: Double, gain: Double) in
      self.startEngineIfNeeded()
      self.lock.lock()
      self.bendOn = true
      self.bendGain = max(0.0, min(1.0, gain))
      self.bendPhaseInc = 2.0 * Double.pi * frequency / self.sampleRate
      self.lock.unlock()
    }

    AsyncFunction("bendSet") { (frequency: Double) in
      self.lock.lock()
      self.bendPhaseInc = 2.0 * Double.pi * frequency / self.sampleRate
      self.lock.unlock()
    }

    AsyncFunction("bendStop") { (_: Double) in
      self.lock.lock()
      self.bendOn = false
      self.lock.unlock()
    }

    // ---- wavetable engine ----

    // Upload a wavetable: `data` is frames × 2048 samples, frame-major, each
    // frame one cycle in -1..1. Mip levels are built here (FFT band-limiting),
    // so this is the only expensive moment. Slots 0–2 hold the built-ins and
    // may be overwritten.
    AsyncFunction("loadTable") { (slot: Int, frames: Int, data: [Double]) -> Bool in
      guard slot >= 0, slot < Self.TABLE_SLOTS,
        frames >= 1, frames <= Self.MAX_FRAMES,
        data.count == frames * Self.WT_SIZE
      else { return false }
      let table = Self.buildTable(frames: frames, raw: data.map { Float($0) })
      self.lock.lock()
      self.tables[slot] = table
      self.lock.unlock()
      return true
    }

    // Set a patch slot from a flat {key: value} dictionary; missing keys keep
    // defaults. Sounding voices read the patch live.
    AsyncFunction("setPatch") { (slot: Int, params: [String: Double]) in
      guard slot >= 0, slot < Self.PATCH_SLOTS else { return }
      var p = WTPatch()
      Self.apply(params: params, to: &p)
      self.lock.lock()
      self.patches[slot] = p
      self.lock.unlock()
    }

    // Live-tweak one parameter of a patch (a macro knob: affects sounding
    // voices at control rate).
    AsyncFunction("setPatchParam") { (slot: Int, key: String, value: Double) in
      guard slot >= 0, slot < Self.PATCH_SLOTS else { return }
      self.lock.lock()
      var p = self.patches[slot]
      Self.apply(params: [key: value], to: &p)
      self.patches[slot] = p
      self.lock.unlock()
    }

    // Gate a wavetable note on. Returns a voice handle for noteOff, or -1.
    AsyncFunction("noteOn") { (patch: Int, midi: Double, gain: Double, pan: Double) -> Int in
      return self.wtNoteOn(patch: patch, midi: midi, gain: gain, pan: pan, hold: -1)
    }

    // Release a gated note (enters its amp release).
    AsyncFunction("noteOff") { (voice: Int) in
      guard voice >= 0, voice < Self.WT_VOICES else { return }
      self.lock.lock()
      self.wtVoices[voice].gate = false
      self.lock.unlock()
    }

    // One-shot: gate on, hold `hold` seconds at sustain, then auto-release.
    AsyncFunction("noteFire") { (patch: Int, midi: Double, gain: Double, pan: Double, hold: Double) -> Int in
      return self.wtNoteOn(patch: patch, midi: midi, gain: gain, pan: pan, hold: max(0, hold))
    }

    // All wavetable voices → release (soft panic).
    AsyncFunction("releaseAll") {
      self.lock.lock()
      for i in 0..<Self.WT_VOICES {
        self.wtVoices[i].gate = false
        self.wtVoices[i].holdSamples = 0
      }
      self.lock.unlock()
    }

    // ---- insert FX rack (Soundtoys-flavored; see FxRack.swift) ----

    // Set one rack parameter (e.g. "echo.time", "sat.drive"). Flat keys:
    // sat.on/drive/style/tone/mix · filt.on/type/cutoff/res/lfoHz/lfoAmt/
    // envAmt/mix · phaser.on/rate/depth/center/fb/stages/mix · chorus.on/rate/
    // depth/delay/fb/spread/mix · trem.on/rate/depth/shape/pan · micro.on/
    // cents/mix · cryst.on/pitch/size/fb/reverse/mix · echo.on/time/offset/fb/
    // pingpong/toneLo/toneHi/wow/sat/mix.
    AsyncFunction("setFxParam") { (key: String, value: Double) in
      self.lock.lock()
      self.fxRack?.setParam(key, value)
      self.lock.unlock()
    }

    // Set many rack parameters at once (a preset).
    AsyncFunction("setFxPreset") { (params: [String: Double]) in
      self.lock.lock()
      for (k, v) in params { self.fxRack?.setParam(k, v) }
      self.lock.unlock()
    }

    // Tremolator step pattern (0..1 levels, one step per trem.rate cycle).
    // An empty array returns the tremolo to its LFO.
    AsyncFunction("setTremPattern") { (steps: [Double]) in
      self.lock.lock()
      self.fxRack?.setPattern(steps)
      self.lock.unlock()
    }

    // Shared synth FX tail: mixes are wet % (0–100, default dry); delayTime
    // seconds (max 2); feedback 0–95. Negative leaves a field as-is.
    AsyncFunction("setSynthFx") { (reverbMix: Double, delayMix: Double, delayTime: Double, feedback: Double) in
      if reverbMix >= 0 { self.reverbFx.wetDryMix = Float(min(100.0, reverbMix)) }
      if delayMix >= 0 { self.delayFx.wetDryMix = Float(min(100.0, delayMix)) }
      if delayTime >= 0 { self.delayFx.delayTime = TimeInterval(min(2.0, delayTime)) }
      if feedback >= 0 { self.delayFx.feedback = Float(min(95.0, feedback)) }
    }

    OnDestroy {
      self.engine.stop()
    }
  }

  // MARK: - Patch parsing

  private static func apply(params: [String: Double], to p: inout WTPatch) {
    for (k, v) in params {
      switch k {
      case "oscA.on": p.oscA.on = v
      case "oscA.table": p.oscA.table = v
      case "oscA.pos": p.oscA.pos = v
      case "oscA.unison": p.oscA.unison = v
      case "oscA.detune": p.oscA.detune = v
      case "oscA.spread": p.oscA.spread = v
      case "oscA.level": p.oscA.level = v
      case "oscA.semi": p.oscA.semi = v
      case "oscA.warp": p.oscA.warp = Int(v)
      case "oscA.warpAmt": p.oscA.warpAmt = v
      case "oscA.phaseRand": p.oscA.phaseRand = v
      case "oscB.on": p.oscB.on = v
      case "oscB.table": p.oscB.table = v
      case "oscB.pos": p.oscB.pos = v
      case "oscB.unison": p.oscB.unison = v
      case "oscB.detune": p.oscB.detune = v
      case "oscB.spread": p.oscB.spread = v
      case "oscB.level": p.oscB.level = v
      case "oscB.semi": p.oscB.semi = v
      case "oscB.warp": p.oscB.warp = Int(v)
      case "oscB.warpAmt": p.oscB.warpAmt = v
      case "oscB.phaseRand": p.oscB.phaseRand = v
      case "sub.level": p.subLevel = v
      case "noise.level": p.noiseLevel = v
      case "amp.a": p.ampA = v
      case "amp.d": p.ampD = v
      case "amp.s": p.ampS = v
      case "amp.r": p.ampR = v
      case "env2.a": p.e2A = v
      case "env2.d": p.e2D = v
      case "env2.s": p.e2S = v
      case "env2.r": p.e2R = v
      case "env2.toCutoff": p.e2ToCutoff = v
      case "env2.toPos": p.e2ToPos = v
      case "env2.toPitch": p.e2ToPitch = v
      case "lfo1.shape": p.lfo1Shape = Int(v)
      case "lfo1.hz": p.lfo1Hz = v
      case "lfo1.toPitch": p.lfo1ToPitch = v
      case "lfo1.toCutoff": p.lfo1ToCutoff = v
      case "lfo1.toPos": p.lfo1ToPos = v
      case "lfo1.toAmp": p.lfo1ToAmp = v
      case "lfo1.toPan": p.lfo1ToPan = v
      case "lfo2.shape": p.lfo2Shape = Int(v)
      case "lfo2.hz": p.lfo2Hz = v
      case "lfo2.toPitch": p.lfo2ToPitch = v
      case "lfo2.toCutoff": p.lfo2ToCutoff = v
      case "lfo2.toPos": p.lfo2ToPos = v
      case "lfo2.toAmp": p.lfo2ToAmp = v
      case "lfo2.toPan": p.lfo2ToPan = v
      case "filter.type": p.filterType = Int(v)
      case "filter.cutoff": p.cutoff = v
      case "filter.res": p.res = v
      case "filter.keytrack": p.keytrack = v
      case "drive": p.drive = v
      case "glide": p.glide = v
      default: break
      }
    }
  }

  // MARK: - Table building (FFT band-limited mips)

  // Iterative radix-2 complex FFT, in-place. inverse=true includes 1/n.
  private static func fft(_ re: inout [Double], _ im: inout [Double], inverse: Bool) {
    let n = re.count
    var j = 0
    for i in 0..<n {
      if i < j {
        re.swapAt(i, j)
        im.swapAt(i, j)
      }
      var m = n >> 1
      while m >= 1 && j >= m {
        j -= m
        m >>= 1
      }
      j += m
    }
    var len = 2
    while len <= n {
      let ang = (inverse ? 2.0 : -2.0) * Double.pi / Double(len)
      let wr = cos(ang)
      let wi = sin(ang)
      var i = 0
      while i < n {
        var cwr = 1.0
        var cwi = 0.0
        for k in 0..<(len >> 1) {
          let ur = re[i + k]
          let ui = im[i + k]
          let vr = re[i + k + (len >> 1)] * cwr - im[i + k + (len >> 1)] * cwi
          let vi = re[i + k + (len >> 1)] * cwi + im[i + k + (len >> 1)] * cwr
          re[i + k] = ur + vr
          im[i + k] = ui + vi
          re[i + k + (len >> 1)] = ur - vr
          im[i + k + (len >> 1)] = ui - vi
          let nwr = cwr * wr - cwi * wi
          cwi = cwr * wi + cwi * wr
          cwr = nwr
        }
        i += len
      }
      len <<= 1
    }
    if inverse {
      for i in 0..<n {
        re[i] /= Double(n)
        im[i] /= Double(n)
      }
    }
  }

  // Build a mip-mapped table from raw frames: forward FFT each frame once,
  // then for each mip level keep harmonics below the level's limit and IFFT.
  private static func buildTable(frames: Int, raw: [Float]) -> WTTable {
    let n = WT_SIZE
    var out = [Float](repeating: 0, count: WT_MIPS * frames * n)
    for f in 0..<frames {
      var re = [Double](repeating: 0, count: n)
      var im = [Double](repeating: 0, count: n)
      for i in 0..<n { re[i] = Double(raw[f * n + i]) }
      fft(&re, &im, inverse: false)
      for mip in 0..<WT_MIPS {
        let limit = max(1, (n / 4) >> mip) // level 0 keeps up to 512 harmonics
        var mre = [Double](repeating: 0, count: n)
        var mim = [Double](repeating: 0, count: n)
        for h in 0...limit where h < n / 2 {
          mre[h] = re[h]
          mim[h] = im[h]
          if h > 0 {
            mre[n - h] = re[n - h]
            mim[n - h] = im[n - h]
          }
        }
        fft(&mre, &mim, inverse: true)
        let base = (mip * frames + f) * n
        for i in 0..<n { out[base + i] = Float(mre[i]) }
      }
    }
    return WTTable(frames: frames, data: out)
  }

  // Spectrally-defined built-in tables: harmonic amplitude recipes → frames.
  private static func spectralFrame(_ amps: [Double]) -> [Float] {
    let n = WT_SIZE
    var re = [Double](repeating: 0, count: n)
    var im = [Double](repeating: 0, count: n)
    for (h, a) in amps.enumerated() where h > 0 && a != 0 && h < n / 2 {
      // sine phase: put amplitude in the imaginary part (odd symmetry)
      im[h] = -a * Double(n) / 2
      im[n - h] = a * Double(n) / 2
    }
    fft(&re, &im, inverse: true)
    var mx = 0.0
    for i in 0..<n { mx = max(mx, abs(re[i])) }
    let g = mx > 0 ? 0.95 / mx : 1
    return (0..<n).map { Float(re[$0] * g) }
  }

  private static func builtinTables() -> [(Int, [Float])] {
    var out: [(Int, [Float])] = []
    // Slot 0 "basic": sine → triangle → saw → square-ish morph, 8 frames.
    var basic = [Float]()
    for f in 0..<8 {
      let t = Double(f) / 7.0
      var amps = [Double](repeating: 0, count: 64)
      for h in 1..<64 {
        let sine = h == 1 ? 1.0 : 0.0
        let tri = h % 2 == 1 ? (h % 4 == 1 ? 1.0 : -1.0) / Double(h * h) : 0.0
        let saw = 1.0 / Double(h)
        let sq = h % 2 == 1 ? 1.0 / Double(h) : 0.0
        // piecewise morph across the four shapes
        let seg = t * 3
        let v: Double
        if seg < 1 {
          v = sine + (tri - sine) * seg
        } else if seg < 2 {
          v = tri + (saw - tri) * (seg - 1)
        } else {
          v = saw + (sq - saw) * (seg - 2)
        }
        amps[h] = v
      }
      basic.append(contentsOf: spectralFrame(amps))
    }
    out.append((8, basic))
    // Slot 1 "buzz": harmonic stacks thickening across frames.
    var buzz = [Float]()
    for f in 0..<8 {
      let t = Double(f) / 7.0
      var amps = [Double](repeating: 0, count: 128)
      let count = 2 + Int(t * 40)
      for h in 1...count where h < 128 {
        amps[h] = pow(1.0 - Double(h) / Double(count + 1), 0.5 + 2.0 * (1 - t))
      }
      buzz.append(contentsOf: spectralFrame(amps))
    }
    out.append((8, buzz))
    // Slot 2 "vowel": formant bumps gliding (a-e-i-o feel), 4 frames.
    let formants: [[Double]] = [[6, 11], [4, 17], [3, 23], [5, 8]]
    var vowel = [Float]()
    for f in 0..<4 {
      var amps = [Double](repeating: 0, count: 64)
      amps[1] = 0.6
      for center in formants[f] {
        for h in 1..<64 {
          let d = Double(h) - center
          amps[h] += exp(-d * d / 6.0)
        }
      }
      vowel.append(contentsOf: spectralFrame(amps))
    }
    out.append((4, vowel))
    return out
  }

  // MARK: - Wavetable voice control

  private func wtNoteOn(patch: Int, midi: Double, gain: Double, pan: Double, hold: Double) -> Int {
    guard patch >= 0, patch < Self.PATCH_SLOTS else { return -1 }
    startEngineIfNeeded()
    lock.lock()
    // Free voice, else steal the oldest.
    var idx = -1
    for i in 0..<Self.WT_VOICES where !wtVoices[i].active {
      idx = i
      break
    }
    if idx < 0 {
      var oldest = 0
      for i in 1..<Self.WT_VOICES where wtVoices[i].age < wtVoices[oldest].age {
        oldest = i
      }
      idx = oldest
    }
    let p = patches[patch]
    var v = WTVoice()
    v.active = true
    v.gate = true
    v.patch = patch
    wtAge += 1
    v.age = wtAge
    v.gain = max(0, min(1, gain))
    v.pan = max(-1, min(1, pan))
    v.semiTarget = midi
    v.semiCur = p.glide > 0.001 ? lastSemiPerPatch[patch] : midi
    lastSemiPerPatch[patch] = midi
    v.rng = UInt32(truncatingIfNeeded: (wtAge &* 2654435761) | 1)
    // unison ratios + randomized start phases per osc copy
    for osc in 0..<2 {
      let op = osc == 0 ? p.oscA : p.oscB
      let u = max(1, min(Self.MAX_UNISON, Int(op.unison)))
      for c in 0..<Self.MAX_UNISON {
        let k = osc * Self.MAX_UNISON + c
        if c < u {
          let off = u == 1 ? 0.0 : (2.0 * Double(c) / Double(u - 1) - 1.0)
          v.ratios[k] = pow(2.0, op.detune * off / 1200.0)
          v.rng = v.rng ^ (v.rng << 13)
          v.rng = v.rng ^ (v.rng >> 17)
          v.rng = v.rng ^ (v.rng << 5)
          let r = Double(v.rng % 10000) / 10000.0
          v.phases[k] = r * op.phaseRand
        } else {
          v.ratios[k] = 1
          v.phases[k] = 0
        }
      }
    }
    v.holdSamples = hold >= 0 ? Int(hold * sampleRate) : -1
    wtVoices[idx] = v
    lock.unlock()
    return idx
  }

  // Linear ADSR advance (per sample), gate-aware.
  private static func advanceEnv(
    stage: inout Stage, level: inout Double, gate: Bool,
    aInc: Double, dInc: Double, s: Double, rInc: Double
  ) -> Bool {
    if !gate && stage != .release { stage = .release }
    switch stage {
    case .attack:
      level += aInc
      if level >= 1 {
        level = 1
        stage = .decay
      }
    case .decay:
      level -= dInc
      if level <= s {
        level = s
        stage = .sustain
      }
    case .sustain:
      break
    case .release:
      level -= rInc
      if level <= 0 {
        level = 0
        return false
      }
    }
    return true
  }

  private static func lfoValue(shape: Int, phase: Double, sh: inout Double, rng: inout UInt32) -> Double {
    let t = phase - floor(phase)
    switch shape {
    case 1: return 4.0 * abs(t - 0.5) - 1.0 // triangle
    case 2: return 2.0 * t - 1.0 // saw
    case 3: return t < 0.5 ? 1.0 : -1.0 // square
    case 4: // sample & hold: re-roll at each cycle start
      if t < 0.02 {
        rng = rng ^ (rng << 13)
        rng = rng ^ (rng >> 17)
        rng = rng ^ (rng << 5)
        sh = Double(rng % 20000) / 10000.0 - 1.0
      }
      return sh
    default: return sin(t * 2.0 * Double.pi)
    }
  }

  // Phase warp: t in 0..1 → shaped t.
  private static func warp(_ t: Double, mode: Int, amt: Double) -> Double {
    switch mode {
    case 1: // sync
      let m = 1.0 + 7.0 * amt
      let s = t * m
      return s - floor(s)
    case 2: // bend
      let k = pow(3.0, amt * 2.0 - 1.0)
      return pow(t, k)
    case 3: // mirror
      return 1.0 - abs(1.0 - 2.0 * t)
    case 4: // pwm / skew
      let p = 0.5 - 0.45 * amt
      return t < p ? 0.5 * t / p : 0.5 + 0.5 * (t - p) / (1.0 - p)
    case 5: // quantize
      let q = 2.0 + (1.0 - amt) * 62.0
      return floor(t * q) / q
    default:
      return t
    }
  }

  // MARK: - Engine graph

  private func startEngineIfNeeded() {
    if !engine.isRunning {
      try? AVAudioSession.sharedInstance().setActive(true)
      try? engine.start()
    }
  }

  private func configure() {
    voices = Array(repeating: Voice(), count: voiceCount)
    for (i, t) in Self.builtinTables().enumerated() {
      tables[i] = Self.buildTable(frames: t.0, raw: t.1)
    }

    let session = AVAudioSession.sharedInstance()
    try? session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
    try? session.setActive(true)
    if session.sampleRate > 0 { sampleRate = session.sampleRate }
    fxRack = FxRack(sampleRate: sampleRate)

    guard let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 2) else {
      return
    }

    let node = AVAudioSourceNode(format: format) { [weak self] _, _, frameCount, ablPtr -> OSStatus in
      guard let self = self else { return noErr }
      let abl = UnsafeMutableAudioBufferListPointer(ablPtr)
      let frames = Int(frameCount)
      self.lock.lock()
      self.render(frames: frames, abl: abl)
      self.lock.unlock()
      return noErr
    }

    engine.attach(node)
    engine.attach(delayFx)
    engine.attach(reverbFx)
    delayFx.wetDryMix = 0
    delayFx.delayTime = 0.3
    delayFx.feedback = 30
    reverbFx.loadFactoryPreset(.mediumHall)
    reverbFx.wetDryMix = 0
    engine.connect(node, to: delayFx, format: format)
    engine.connect(delayFx, to: reverbFx, format: format)
    engine.connect(reverbFx, to: engine.mainMixerNode, format: format)
    sourceNode = node
    engine.prepare()
    try? engine.start()
  }

  // MARK: - Render

  private func render(frames: Int, abl: UnsafeMutableAudioBufferListPointer) {
    let twoPi = 2.0 * Double.pi
    for frame in 0..<frames {
      var mixL = 0.0
      var mixR = 0.0

      // ---- legacy pool (identical to the pre-wavetable engine) ----
      for i in 0..<voiceCount where voices[i].active {
        var env = 0.0
        if voices[i].isADSR {
          switch voices[i].stage {
          case .attack:
            voices[i].env += voices[i].atkInc
            if voices[i].env >= 1.0 {
              voices[i].env = 1.0
              voices[i].stage = .decay
            }
          case .decay:
            voices[i].env -= voices[i].decInc
            if voices[i].env <= voices[i].sustain {
              voices[i].env = voices[i].sustain
              voices[i].stage = .sustain
            }
          case .sustain:
            if voices[i].holdSamples > 0 {
              voices[i].holdSamples -= 1
            } else {
              voices[i].stage = .release
            }
          case .release:
            voices[i].env -= voices[i].relInc
            if voices[i].env <= 0.0 {
              voices[i].env = 0.0
              voices[i].active = false
            }
          }
          env = voices[i].env * voices[i].peak
        } else {
          env = voices[i].amp
          voices[i].amp *= voices[i].decayMul
          if voices[i].amp < 0.0002 { voices[i].active = false }
        }
        var s: Double
        switch voices[i].wave {
        case 1:
          let t = voices[i].phase / twoPi
          s = t < 0.25 ? 4.0 * t : (t < 0.75 ? 2.0 - 4.0 * t : 4.0 * t - 4.0)
        case 2:
          s = 2.0 * (voices[i].phase / twoPi) - 1.0
        case 3:
          s = voices[i].phase < Double.pi ? 1.0 : -1.0
        default:
          s = sin(voices[i].phase)
        }
        var out = s * env
        if voices[i].lpAlpha < 1.0 {
          voices[i].lpState += voices[i].lpAlpha * (out - voices[i].lpState)
          out = voices[i].lpState
        }
        mixL += out * voices[i].gL
        mixR += out * voices[i].gR
        voices[i].phase += voices[i].phaseInc
        if voices[i].phase >= twoPi { voices[i].phase -= twoPi }
      }

      if bendOn || bendAmp > 0.00001 {
        let target = bendOn ? bendGain : 0.0
        bendAmp += (target - bendAmp) * 0.006
        let b = sin(bendPhase) * bendAmp
        mixL += b
        mixR += b
        bendPhase += bendPhaseInc
        if bendPhase >= twoPi { bendPhase -= twoPi }
      }

      // ---- wavetable voices ----
      if ctrlCountdown <= 0 {
        ctrlCountdown = Self.CTRL
        updateControlRate()
      }
      ctrlCountdown -= 1

      for i in 0..<Self.WT_VOICES where wtVoices[i].active {
        let p = patches[wtVoices[i].patch]
        // envelopes (per sample, click-free)
        let aInc = 1.0 / max(1.0, p.ampA * sampleRate)
        let dInc = (1.0 - p.ampS) / max(1.0, p.ampD * sampleRate)
        let rInc = max(p.ampS, 0.0001) / max(1.0, p.ampR * sampleRate)
        if wtVoices[i].holdSamples >= 0 {
          if wtVoices[i].holdSamples == 0 {
            wtVoices[i].gate = false
          }
          wtVoices[i].holdSamples -= 1
        }
        let alive = Self.advanceEnv(
          stage: &wtVoices[i].env1Stage, level: &wtVoices[i].env1,
          gate: wtVoices[i].gate, aInc: aInc, dInc: dInc, s: p.ampS, rInc: rInc)
        if !alive {
          wtVoices[i].active = false
          continue
        }
        let a2 = 1.0 / max(1.0, p.e2A * sampleRate)
        let d2 = (1.0 - p.e2S) / max(1.0, p.e2D * sampleRate)
        let r2 = max(p.e2S, 0.0001) / max(1.0, p.e2R * sampleRate)
        _ = Self.advanceEnv(
          stage: &wtVoices[i].env2Stage, level: &wtVoices[i].env2,
          gate: wtVoices[i].gate, aInc: a2, dInc: d2, s: p.e2S, rInc: r2)

        // osc B first (it can FM osc A)
        var bSample = 0.0
        var vL = 0.0
        var vR = 0.0
        for osc in (0..<2).reversed() {
          let op = osc == 0 ? p.oscA : p.oscB
          if op.on < 0.5 || op.level <= 0 { continue }
          guard let table = tables[max(0, min(Self.TABLE_SLOTS - 1, Int(op.table)))] else { continue }
          let inc = osc == 0 ? wtVoices[i].cIncA : wtVoices[i].cIncB
          let mip = osc == 0 ? wtVoices[i].cMipA : wtVoices[i].cMipB
          let posF = osc == 0 ? wtVoices[i].cPosA : wtVoices[i].cPosB
          let u = max(1, min(Self.MAX_UNISON, Int(op.unison)))
          let frameA = Int(posF)
          let frameB = min(table.frames - 1, frameA + 1)
          let frac = posF - Double(frameA)
          let baseA = (mip * table.frames + frameA) * Self.WT_SIZE
          let baseB = (mip * table.frames + frameB) * Self.WT_SIZE
          var sumL = 0.0
          var sumR = 0.0
          let fm = osc == 0 && p.oscA.warp == 6 ? bSample * p.oscA.warpAmt * 0.5 : 0.0
          for c in 0..<u {
            let k = osc * Self.MAX_UNISON + c
            var t = wtVoices[i].phases[k] + fm
            t -= floor(t)
            if op.warp >= 1 && op.warp <= 5 {
              t = Self.warp(t, mode: op.warp, amt: op.warpAmt)
            }
            let x = t * Double(Self.WT_SIZE)
            let i0 = Int(x) & (Self.WT_SIZE - 1)
            let i1 = (i0 + 1) & (Self.WT_SIZE - 1)
            let xf = x - floor(x)
            let sA = Double(table.data[baseA + i0]) + (Double(table.data[baseA + i1]) - Double(table.data[baseA + i0])) * xf
            let sB = Double(table.data[baseB + i0]) + (Double(table.data[baseB + i1]) - Double(table.data[baseB + i0])) * xf
            let s = sA + (sB - sA) * frac
            // spread copies across the stereo field
            let panPos = u == 1 ? 0.0 : (2.0 * Double(c) / Double(u - 1) - 1.0) * op.spread
            sumL += s * (panPos <= 0 ? 1.0 : 1.0 - panPos)
            sumR += s * (panPos >= 0 ? 1.0 : 1.0 + panPos)
            wtVoices[i].phases[k] += inc * wtVoices[i].ratios[k]
            wtVoices[i].phases[k] -= floor(wtVoices[i].phases[k])
          }
          let norm = op.level / Double(u)
          if osc == 1 { bSample = (sumL + sumR) * 0.5 * norm }
          vL += sumL * norm
          vR += sumR * norm
        }

        // sub (sine, one octave down) + noise
        if p.subLevel > 0 {
          let s = sin(wtVoices[i].subPhase * twoPi) * p.subLevel
          vL += s
          vR += s
          wtVoices[i].subPhase += wtVoices[i].cIncA * 0.5
          wtVoices[i].subPhase -= floor(wtVoices[i].subPhase)
        }
        if p.noiseLevel > 0 {
          wtVoices[i].rng = wtVoices[i].rng ^ (wtVoices[i].rng << 13)
          wtVoices[i].rng = wtVoices[i].rng ^ (wtVoices[i].rng >> 17)
          wtVoices[i].rng = wtVoices[i].rng ^ (wtVoices[i].rng << 5)
          let nz = (Double(wtVoices[i].rng % 20000) / 10000.0 - 1.0) * p.noiseLevel
          vL += nz
          vR += nz
        }

        // filter (stereo TPT SVF)
        if p.filterType > 0 {
          let g = wtVoices[i].cG
          let k = wtVoices[i].cK
          let a1 = 1.0 / (1.0 + g * (g + k))
          let a2 = g * a1
          let a3 = g * a2
          let v3L = vL - wtVoices[i].ic2L
          let v1L = a1 * wtVoices[i].ic1L + a2 * v3L
          let v2L = wtVoices[i].ic2L + a2 * wtVoices[i].ic1L + a3 * v3L
          wtVoices[i].ic1L = 2.0 * v1L - wtVoices[i].ic1L
          wtVoices[i].ic2L = 2.0 * v2L - wtVoices[i].ic2L
          let v3R = vR - wtVoices[i].ic2R
          let v1R = a1 * wtVoices[i].ic1R + a2 * v3R
          let v2R = wtVoices[i].ic2R + a2 * wtVoices[i].ic1R + a3 * v3R
          wtVoices[i].ic1R = 2.0 * v1R - wtVoices[i].ic1R
          wtVoices[i].ic2R = 2.0 * v2R - wtVoices[i].ic2R
          switch p.filterType {
          case 2:
            vL = vL - k * v1L - v2L
            vR = vR - k * v1R - v2R
          case 3:
            vL = v1L
            vR = v1R
          case 4:
            vL = vL - k * v1L
            vR = vR - k * v1R
          default:
            vL = v2L
            vR = v2R
          }
        }

        // drive, amp, pan
        if p.drive > 0 {
          let d = 1.0 + p.drive * 8.0
          let mk = 1.0 / (1.0 + p.drive * 1.5)
          vL = tanh(vL * d) * mk
          vR = tanh(vR * d) * mk
        }
        let amp = wtVoices[i].env1 * wtVoices[i].gain * wtVoices[i].cAmpMod
        let pan = max(-1.0, min(1.0, wtVoices[i].pan + wtVoices[i].cPanMod))
        mixL += vL * amp * (pan <= 0 ? 1.0 : 1.0 - pan)
        mixR += vR * amp * (pan >= 0 ? 1.0 : 1.0 + pan)
      }

      // Insert rack (Soundtoys chain) before the master soft-clip.
      fxRack?.process(&mixL, &mixR)

      let sampleL = Float(tanh(mixL))
      let sampleR = Float(tanh(mixR))
      for (ci, buffer) in abl.enumerated() {
        guard let data = buffer.mData else { continue }
        data.assumingMemoryBound(to: Float.self)[frame] = ci == 0 ? sampleL : sampleR
      }
    }
  }

  // Control-rate update (~every 32 samples): glide, LFOs, pitch/pos/cutoff
  // modulation, mip selection, filter coefficients.
  private func updateControlRate() {
    let dt = Double(Self.CTRL) / sampleRate
    for i in 0..<Self.WT_VOICES where wtVoices[i].active {
      let p = patches[wtVoices[i].patch]
      // glide in semitone space
      if p.glide > 0.001 {
        let step = 12.0 * dt / p.glide
        let d = wtVoices[i].semiTarget - wtVoices[i].semiCur
        if abs(d) <= step {
          wtVoices[i].semiCur = wtVoices[i].semiTarget
        } else {
          wtVoices[i].semiCur += d > 0 ? step : -step
        }
      } else {
        wtVoices[i].semiCur = wtVoices[i].semiTarget
      }
      // LFOs
      wtVoices[i].lfo1P += p.lfo1Hz * dt
      wtVoices[i].lfo2P += p.lfo2Hz * dt
      let l1 = Self.lfoValue(
        shape: p.lfo1Shape, phase: wtVoices[i].lfo1P, sh: &wtVoices[i].sh1, rng: &wtVoices[i].rng)
      let l2 = Self.lfoValue(
        shape: p.lfo2Shape, phase: wtVoices[i].lfo2P, sh: &wtVoices[i].sh2, rng: &wtVoices[i].rng)
      let e2 = wtVoices[i].env2
      // pitch (semitones)
      let semis =
        wtVoices[i].semiCur + p.e2ToPitch * e2 + p.lfo1ToPitch * l1 + p.lfo2ToPitch * l2
      let fA = 440.0 * pow(2.0, (semis + p.oscA.semi - 69.0) / 12.0)
      let fB = 440.0 * pow(2.0, (semis + p.oscB.semi - 69.0) / 12.0)
      wtVoices[i].cIncA = fA / sampleRate
      wtVoices[i].cIncB = fB / sampleRate
      // mip: keep harmonics below nyquist (level 0 holds up to 512)
      wtVoices[i].cMipA = Self.mipFor(freq: fA, sampleRate: sampleRate)
      wtVoices[i].cMipB = Self.mipFor(freq: fB, sampleRate: sampleRate)
      // table position (0..frames-1 float), modulated
      let posMod = p.e2ToPos * e2 + p.lfo1ToPos * l1 + p.lfo2ToPos * l2
      if let tA = tables[max(0, min(Self.TABLE_SLOTS - 1, Int(p.oscA.table)))] {
        let pos = max(0.0, min(1.0, p.oscA.pos + posMod))
        wtVoices[i].cPosA = pos * Double(max(0, tA.frames - 1))
      }
      if let tB = tables[max(0, min(Self.TABLE_SLOTS - 1, Int(p.oscB.table)))] {
        let pos = max(0.0, min(1.0, p.oscB.pos + posMod))
        wtVoices[i].cPosB = pos * Double(max(0, tB.frames - 1))
      }
      // filter coefficients
      if p.filterType > 0 {
        var cutoff = p.cutoff * pow(2.0, (wtVoices[i].semiCur - 60.0) / 12.0 * p.keytrack)
        cutoff += p.e2ToCutoff * e2 + p.lfo1ToCutoff * l1 + p.lfo2ToCutoff * l2
        cutoff = max(20.0, min(sampleRate * 0.45, cutoff))
        wtVoices[i].cG = tan(Double.pi * cutoff / sampleRate)
        let res = max(0.0, min(1.0, p.res))
        wtVoices[i].cK = 2.0 - 1.9 * res
      }
      // amp / pan modulation
      wtVoices[i].cAmpMod = max(0.0, 1.0 + p.lfo1ToAmp * l1 + p.lfo2ToAmp * l2)
      wtVoices[i].cPanMod = p.lfo1ToPan * l1 + p.lfo2ToPan * l2
    }
  }

  private static func mipFor(freq: Double, sampleRate: Double) -> Int {
    // level L keeps up to 512 >> L harmonics; aliasing-free needs
    // harmonics <= sampleRate / (2 * freq).
    guard freq > 0 else { return 0 }
    let allowed = sampleRate / (2.0 * freq)
    var level = 0
    while level < WT_MIPS - 1 && Double(512 >> level) > allowed {
      level += 1
    }
    return level
  }

  // MARK: - Legacy helpers (unchanged)

  private func lpAlpha(for cutoff: Double) -> Double {
    guard cutoff > 0, cutoff < sampleRate * 0.45 else { return 1 }
    return 1.0 - exp(-2.0 * Double.pi * cutoff / sampleRate)
  }
  private func panGains(_ pan: Double) -> (Double, Double) {
    let p = max(-1.0, min(1.0, pan))
    return (p <= 0 ? 1.0 : 1.0 - p, p >= 0 ? 1.0 : 1.0 + p)
  }

  private func trigger(
    frequency: Double, gain: Double, decay: Double,
    wave: Int = 0, cutoff: Double = 0, pan: Double = 0
  ) {
    startEngineIfNeeded()
    let safeDecay = max(0.05, decay)
    let decayMul = pow(0.001, 1.0 / (safeDecay * sampleRate))
    let inc = 2.0 * Double.pi * frequency / sampleRate
    let alpha = lpAlpha(for: cutoff)
    let (gL, gR) = panGains(pan)

    lock.lock()
    let idx = nextVoice
    nextVoice = (nextVoice + 1) % voiceCount
    voices[idx].active = true
    voices[idx].isADSR = false
    voices[idx].phase = 0
    voices[idx].phaseInc = inc
    voices[idx].amp = max(0.0, min(1.0, gain))
    voices[idx].decayMul = decayMul
    voices[idx].wave = max(0, min(3, wave))
    voices[idx].lpAlpha = alpha
    voices[idx].lpState = 0
    voices[idx].gL = gL
    voices[idx].gR = gR
    lock.unlock()
  }

  private func triggerADSR(
    frequency: Double, gain: Double, attack: Double, decay: Double,
    sustain: Double, hold: Double, release: Double,
    wave: Int = 0, cutoff: Double = 0, pan: Double = 0
  ) {
    startEngineIfNeeded()
    let sus = max(0.0, min(1.0, sustain))
    let atkSamples = max(1.0, attack * sampleRate)
    let decSamples = max(1.0, decay * sampleRate)
    let relSamples = max(1.0, release * sampleRate)
    let inc = 2.0 * Double.pi * frequency / sampleRate
    let alpha = lpAlpha(for: cutoff)
    let (gL, gR) = panGains(pan)

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
    voices[idx].wave = max(0, min(3, wave))
    voices[idx].lpAlpha = alpha
    voices[idx].lpState = 0
    voices[idx].gL = gL
    voices[idx].gR = gR
    lock.unlock()
  }
}
