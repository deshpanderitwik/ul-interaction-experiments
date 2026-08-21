import Foundation

// A granular engine over captured samples — the infrastructure for a
// best-in-class granulator; the instrument UI lives in JS.
//
// Model: a VOICE is a playable grain cloud — a gate (or one-shot) with its own
// ADSR, a semitone transpose, and a live position — reading one captured
// sample through a GRAIN PATCH (grains/sec density, size + jitter, position
// spray, pitch + pitch spray, per-grain reverse probability, window shape,
// stereo pan spray, gain jitter, and scan: position drift in ×realtime, so 0
// freezes a texture and ±slow smears time independent of pitch). Up to 6
// voices share a pool of 64 concurrent grains.
//
// The distinctive move: per-grain pitch quantization. When a patch sets
// quantize, every grain's total pitch offset (transpose + spray) snaps to the
// nearest member of a JS-supplied scale (semitone pitch classes) — grain
// clouds that stay inside the app's shared harmonic world.
final class GrainEngine {
  static let PATCH_SLOTS = 4
  static let VOICES = 6
  static let MAX_GRAINS = 64

  private let sr: Double

  struct Patch {
    var position: Double = 0.5 // 0..1 center of the read head
    var spray: Double = 0.05 // 0..1 of the buffer, position randomness
    var scan: Double = 0 // ×realtime drift of position (0 = frozen)
    var sizeMs: Double = 90
    var sizeJitter: Double = 0.2 // 0..1
    var density: Double = 25 // grains per second
    var timeJitter: Double = 0.5 // 0..1 of the grain interval
    var pitch: Double = 0 // semitones
    var pitchJitter: Double = 0 // ± semitones of spray
    var reverseProb: Double = 0 // 0..1 per grain
    var attack: Double = 0.35 // window attack fraction (0..0.5)
    var release: Double = 0.35 // window release fraction (0..0.5)
    var panSpray: Double = 0.6 // 0..1
    var gainJitter: Double = 0.2 // 0..1
    var quantize: Double = 0 // 1 = snap grain pitch to the scale
    var ampA: Double = 0.01 // cloud envelope (seconds / levels)
    var ampD: Double = 0.1
    var ampS: Double = 1.0
    var ampR: Double = 0.25
  }

  private struct Grain {
    var active = false
    var voice = 0
    var data: [Float] = []
    var len = 0
    var pos: Double = 0 // read index into data (source frames)
    var inc: Double = 0 // source frames per output frame (signed)
    var elapsed = 0
    var total = 0
    var attackF = 1
    var releaseF = 1
    var gL: Double = 0
    var gR: Double = 0
  }

  private struct Voice {
    var active = false
    var gate = false
    var patch = 0
    var data: [Float] = []
    var len = 0
    var srcRate: Double = 48000
    var semis: Double = 0
    var gain: Double = 1
    var pan: Double = 0
    var pos: Double = 0.5 // live read-head position 0..1
    var countdown = 0 // output frames until the next grain spawns
    var env: Double = 0
    var envStage = 0 // 0 attack 1 decay 2 sustain 3 release
    var holdSamples = -1
    var rng: UInt32 = 1
  }

  private var patches = [Patch](repeating: Patch(), count: PATCH_SLOTS)
  private var voices = [Voice](repeating: Voice(), count: VOICES)
  private var grains = [Grain](repeating: Grain(), count: MAX_GRAINS)
  private var scale: [Double] = [] // allowed pitch classes (0..11), empty = chromatic
  private var spawnSeed: UInt32 = 22222

  init(sampleRate: Double) {
    sr = sampleRate
  }

  // MARK: - Parameters

  func setParam(_ slot: Int, _ key: String, _ v: Double) {
    guard slot >= 0, slot < Self.PATCH_SLOTS else { return }
    var p = patches[slot]
    switch key {
    case "position": p.position = v
    case "spray": p.spray = v
    case "scan": p.scan = v
    case "size": p.sizeMs = v
    case "sizeJitter": p.sizeJitter = v
    case "density": p.density = v
    case "timeJitter": p.timeJitter = v
    case "pitch": p.pitch = v
    case "pitchJitter": p.pitchJitter = v
    case "reverse": p.reverseProb = v
    case "attack": p.attack = v
    case "release": p.release = v
    case "panSpray": p.panSpray = v
    case "gainJitter": p.gainJitter = v
    case "quantize": p.quantize = v
    case "amp.a": p.ampA = v
    case "amp.d": p.ampD = v
    case "amp.s": p.ampS = v
    case "amp.r": p.ampR = v
    default: break
    }
    patches[slot] = p
  }

  func setScale(_ pitchClasses: [Double]) {
    scale = pitchClasses.map { $0 - 12.0 * floor($0 / 12.0) }.sorted()
  }

  // MARK: - Voices

  func noteOn(
    patch: Int, data: [Float], srcRate: Double, semis: Double,
    gain: Double, pan: Double, hold: Double
  ) -> Int {
    guard patch >= 0, patch < Self.PATCH_SLOTS, data.count > 64, srcRate > 0 else { return -1 }
    var idx = -1
    for i in 0..<Self.VOICES where !voices[i].active {
      idx = i
      break
    }
    if idx < 0 { return -1 }
    var v = Voice()
    v.active = true
    v.gate = true
    v.patch = patch
    v.data = data
    v.len = data.count
    v.srcRate = srcRate
    v.semis = semis
    v.gain = max(0, min(1, gain))
    v.pan = max(-1, min(1, pan))
    v.pos = max(0, min(1, patches[patch].position))
    v.countdown = 0
    v.env = 0
    v.envStage = 0
    v.holdSamples = hold >= 0 ? Int(hold * sr) : -1
    spawnSeed = spawnSeed &* 1664525 &+ 1013904223
    v.rng = spawnSeed | 1
    voices[idx] = v
    return idx
  }

  func noteOff(_ voice: Int) {
    guard voice >= 0, voice < Self.VOICES else { return }
    voices[voice].gate = false
  }

  // Live per-voice control (scrub!): -999 leaves a field as-is.
  func set(_ voice: Int, position: Double, gain: Double, pan: Double, semis: Double) {
    guard voice >= 0, voice < Self.VOICES, voices[voice].active else { return }
    if position > -900 { voices[voice].pos = max(0, min(1, position)) }
    if gain > -900 { voices[voice].gain = max(0, min(1, gain)) }
    if pan > -900 { voices[voice].pan = max(-1, min(1, pan)) }
    if semis > -900 { voices[voice].semis = semis }
  }

  func releaseAll() {
    for i in 0..<Self.VOICES {
      voices[i].gate = false
      voices[i].holdSamples = 0
    }
  }

  var anyActive: Bool {
    for v in voices where v.active { return true }
    return false
  }

  // MARK: - Render

  @inline(__always) private func rand(_ state: inout UInt32) -> Double {
    state = state ^ (state << 13)
    state = state ^ (state >> 17)
    state = state ^ (state << 5)
    return Double(state % 100000) / 100000.0
  }

  // Snap a semitone offset to the nearest scale member (octave-aware).
  private func snap(_ semis: Double) -> Double {
    guard !scale.isEmpty else { return semis }
    let oct = floor(semis / 12.0)
    var best = semis
    var bd = 1e9
    for o in -1...1 {
      for pc in scale {
        let cand = (oct + Double(o)) * 12.0 + pc
        let d = abs(cand - semis)
        if d < bd {
          bd = d
          best = cand
        }
      }
    }
    return best
  }

  private func spawnGrain(voiceIdx: Int) {
    let p = patches[voices[voiceIdx].patch]
    var gi = -1
    for i in 0..<Self.MAX_GRAINS where !grains[i].active {
      gi = i
      break
    }
    if gi < 0 { return }

    var rng = voices[voiceIdx].rng
    let sizeMs = max(3.0, min(2000.0, p.sizeMs * (1.0 + p.sizeJitter * (rand(&rng) - 0.5))))
    let total = max(32, Int(sizeMs * sr / 1000.0))
    var semis = voices[voiceIdx].semis + p.pitch
    if p.pitchJitter > 0 {
      semis += p.pitchJitter * (rand(&rng) * 2.0 - 1.0)
    }
    if p.quantize > 0.5 { semis = snap(semis) }
    var inc = pow(2.0, semis / 12.0) * voices[voiceIdx].srcRate / sr
    if rand(&rng) < p.reverseProb { inc = -inc }

    let len = voices[voiceIdx].len
    var startFrac = voices[voiceIdx].pos + p.spray * (rand(&rng) * 2.0 - 1.0)
    startFrac -= floor(startFrac)

    let panBase = voices[voiceIdx].pan
    let pan = max(-1.0, min(1.0, panBase + p.panSpray * (rand(&rng) * 2.0 - 1.0)))
    let g = (1.0 - p.gainJitter * rand(&rng))
    voices[voiceIdx].rng = rng

    var grain = Grain()
    grain.active = true
    grain.voice = voiceIdx
    grain.data = voices[voiceIdx].data
    grain.len = len
    grain.pos = startFrac * Double(len)
    grain.inc = inc
    grain.elapsed = 0
    grain.total = total
    grain.attackF = max(1, Int(Double(total) * max(0.01, min(0.5, p.attack))))
    grain.releaseF = max(1, Int(Double(total) * max(0.01, min(0.5, p.release))))
    grain.gL = g * (pan <= 0 ? 1.0 : 1.0 - pan)
    grain.gR = g * (pan >= 0 ? 1.0 : 1.0 + pan)
    grains[gi] = grain
  }

  // Advance voices + render all grains into one stereo frame. Call per sample
  // with the engine's lock held.
  func processSample() -> (Double, Double) {
    // voices: cloud envelopes, scan drift, grain scheduling
    for i in 0..<Self.VOICES where voices[i].active {
      let p = patches[voices[i].patch]
      if voices[i].holdSamples >= 0 {
        if voices[i].holdSamples == 0 { voices[i].gate = false }
        voices[i].holdSamples -= 1
      }
      // ADSR
      if !voices[i].gate && voices[i].envStage != 3 { voices[i].envStage = 3 }
      switch voices[i].envStage {
      case 0:
        voices[i].env += 1.0 / max(1.0, p.ampA * sr)
        if voices[i].env >= 1 {
          voices[i].env = 1
          voices[i].envStage = 1
        }
      case 1:
        voices[i].env -= (1.0 - p.ampS) / max(1.0, p.ampD * sr)
        if voices[i].env <= p.ampS {
          voices[i].env = p.ampS
          voices[i].envStage = 2
        }
      case 2:
        break
      default:
        voices[i].env -= max(p.ampS, 0.0001) / max(1.0, p.ampR * sr)
        if voices[i].env <= 0 {
          voices[i].env = 0
          voices[i].active = false
          continue
        }
      }
      // scan: drift the read head in ×realtime (independent of grain pitch)
      if p.scan != 0 && voices[i].len > 0 {
        let frac = p.scan * (voices[i].srcRate / sr) / Double(voices[i].len)
        voices[i].pos += frac
        voices[i].pos -= floor(voices[i].pos)
      }
      // scheduling
      voices[i].countdown -= 1
      if voices[i].countdown <= 0 {
        spawnGrain(voiceIdx: i)
        let interval = sr / max(0.5, min(300.0, p.density))
        var rng = voices[i].rng
        let jit = 1.0 + p.timeJitter * (rand(&rng) - 0.5)
        voices[i].rng = rng
        voices[i].countdown = max(8, Int(interval * jit))
      }
    }

    // grains
    var l = 0.0
    var r = 0.0
    for i in 0..<Self.MAX_GRAINS where grains[i].active {
      let vIdx = grains[i].voice
      if !voices[vIdx].active {
        grains[i].active = false
        grains[i].data = []
        continue
      }
      // window: smoothstep attack / release, flat middle
      let n = grains[i].elapsed
      let remain = grains[i].total - n
      var e: Double
      if n < grains[i].attackF {
        let u = Double(n) / Double(grains[i].attackF)
        e = u * u * (3.0 - 2.0 * u)
      } else if remain < grains[i].releaseF {
        let u = Double(remain) / Double(grains[i].releaseF)
        e = u * u * (3.0 - 2.0 * u)
      } else {
        e = 1.0
      }
      // wrapped linear-interp read
      let len = grains[i].len
      var pos = grains[i].pos
      pos -= floor(pos / Double(len)) * Double(len)
      let i0 = Int(pos) % len
      let i1 = (i0 + 1) % len
      let f = pos - floor(pos)
      let s = Double(grains[i].data[i0]) + (Double(grains[i].data[i1]) - Double(grains[i].data[i0])) * f
      let amp = e * voices[vIdx].env * voices[vIdx].gain
      l += s * amp * grains[i].gL
      r += s * amp * grains[i].gR

      grains[i].pos = pos + grains[i].inc
      grains[i].elapsed += 1
      if grains[i].elapsed >= grains[i].total {
        grains[i].active = false
        grains[i].data = [] // drop the sample reference promptly
      }
    }
    return (l, r)
  }
}
