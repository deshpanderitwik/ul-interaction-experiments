import Foundation

// A mastering chain for the synth bus, Ozone-shaped, hand-rolled:
//
//   input gain → 5-band EQ (low shelf · 3 peaking · high shelf, RBJ biquads)
//   → 3-band multiband compressor (subtraction crossover: band2 = full −
//     low − high, so the idle split reconstructs EXACTLY) → per-band stereo
//     width (M/S; width.b1 → 0 = bass mono) → exciter (high-band tanh blend)
//   → lookahead brickwall limiter (instant-down / smooth-up gain envelope
//     applied to a delayed signal, so peaks are caught before they exit)
//   → hard ceiling.
//
// All parameters are flat {key: value} doubles; meters (short-term RMS in/out,
// true peak out, per-band + limiter gain reduction) are read back by JS at UI
// rate for display. Bypassed entirely when master.on = 0.
final class MasterChain {
  private let sr: Double

  // MARK: - Parameters

  var on = 0.0
  var inGainDb = 0.0
  // EQ
  var eqLowGain = 0.0
  var eqLowFreq = 90.0
  var eqP1Gain = 0.0
  var eqP1Freq = 250.0
  var eqP1Q = 1.0
  var eqP2Gain = 0.0
  var eqP2Freq = 1200.0
  var eqP2Q = 1.0
  var eqP3Gain = 0.0
  var eqP3Freq = 4500.0
  var eqP3Q = 1.0
  var eqHighGain = 0.0
  var eqHighFreq = 9000.0
  // multiband comp
  var compOn = 0.0
  var xover1 = 140.0
  var xover2 = 2600.0
  var thresh = [-18.0, -20.0, -22.0] // dB per band
  var ratio = [2.5, 2.0, 2.5]
  var attackMs = [18.0, 8.0, 3.0]
  var releaseMs = [180.0, 120.0, 80.0]
  var makeup = [0.0, 0.0, 0.0] // dB
  // width
  var width = [1.0, 1.0, 1.0] // 0 mono … 1 as-is … 2 wide
  // exciter
  var excOn = 0.0
  var excDrive = 0.3
  var excMix = 0.2
  // limiter
  var limOn = 1.0
  var limGainDb = 0.0
  var limCeilingDb = -0.5
  var limReleaseMs = 120.0

  // MARK: - State

  private struct Biquad {
    var b0 = 1.0, b1 = 0.0, b2 = 0.0, a1 = 0.0, a2 = 0.0
    var z1L = 0.0, z2L = 0.0, z1R = 0.0, z2R = 0.0
    mutating func run(_ l: inout Double, _ r: inout Double) {
      let outL = b0 * l + z1L
      z1L = b1 * l - a1 * outL + z2L
      z2L = b2 * l - a2 * outL
      l = outL
      let outR = b0 * r + z1R
      z1R = b1 * r - a1 * outR + z2R
      z2R = b2 * r - a2 * outR
      r = outR
    }
  }

  private var eqBands = [Biquad](repeating: Biquad(), count: 5)
  private var eqDirty = true
  // crossover one-poles (subtraction method → perfect reconstruction)
  private var loL = 0.0, loR = 0.0
  private var hiL = 0.0, hiR = 0.0
  // compressor envelopes (per band, linear peak)
  private var compEnv = [0.0, 0.0, 0.0]
  // exciter highpass state
  private var exL = 0.0, exR = 0.0
  // limiter: lookahead delay + gain envelope
  private let lookahead: Int
  private var dlL: [Double]
  private var dlR: [Double]
  private var dlW = 0
  private var limEnv = 1.0
  // meters
  private var mInSq = 0.0
  private var mOutSq = 0.0
  private var mPeak = 0.0
  private var mGr = [0.0, 0.0, 0.0] // dB, smoothed
  private var mGrLim = 0.0

  init(sampleRate: Double) {
    sr = sampleRate
    lookahead = max(32, Int(sampleRate * 0.0025)) // ~2.5 ms
    dlL = [Double](repeating: 0, count: lookahead)
    dlR = [Double](repeating: 0, count: lookahead)
  }

  // MARK: - Parameters

  func setParam(_ key: String, _ v: Double) {
    switch key {
    case "master.on": on = v
    case "master.gain": inGainDb = v
    case "eq.lowGain": eqLowGain = v; eqDirty = true
    case "eq.lowFreq": eqLowFreq = v; eqDirty = true
    case "eq.p1Gain": eqP1Gain = v; eqDirty = true
    case "eq.p1Freq": eqP1Freq = v; eqDirty = true
    case "eq.p1Q": eqP1Q = v; eqDirty = true
    case "eq.p2Gain": eqP2Gain = v; eqDirty = true
    case "eq.p2Freq": eqP2Freq = v; eqDirty = true
    case "eq.p2Q": eqP2Q = v; eqDirty = true
    case "eq.p3Gain": eqP3Gain = v; eqDirty = true
    case "eq.p3Freq": eqP3Freq = v; eqDirty = true
    case "eq.p3Q": eqP3Q = v; eqDirty = true
    case "eq.highGain": eqHighGain = v; eqDirty = true
    case "eq.highFreq": eqHighFreq = v; eqDirty = true
    case "comp.on": compOn = v
    case "comp.xover1": xover1 = v
    case "comp.xover2": xover2 = v
    case "comp.b1.thresh": thresh[0] = v
    case "comp.b2.thresh": thresh[1] = v
    case "comp.b3.thresh": thresh[2] = v
    case "comp.b1.ratio": ratio[0] = v
    case "comp.b2.ratio": ratio[1] = v
    case "comp.b3.ratio": ratio[2] = v
    case "comp.b1.attack": attackMs[0] = v
    case "comp.b2.attack": attackMs[1] = v
    case "comp.b3.attack": attackMs[2] = v
    case "comp.b1.release": releaseMs[0] = v
    case "comp.b2.release": releaseMs[1] = v
    case "comp.b3.release": releaseMs[2] = v
    case "comp.b1.gain": makeup[0] = v
    case "comp.b2.gain": makeup[1] = v
    case "comp.b3.gain": makeup[2] = v
    case "width.b1": width[0] = v
    case "width.b2": width[1] = v
    case "width.b3": width[2] = v
    case "exciter.on": excOn = v
    case "exciter.drive": excDrive = v
    case "exciter.mix": excMix = v
    case "limiter.on": limOn = v
    case "limiter.gain": limGainDb = v
    case "limiter.ceiling": limCeilingDb = v
    case "limiter.release": limReleaseMs = v
    default: break
    }
  }

  func meters() -> [String: Double] {
    return [
      "inRms": mInSq > 1e-12 ? 10.0 * log10(mInSq) : -90.0,
      "outRms": mOutSq > 1e-12 ? 10.0 * log10(mOutSq) : -90.0,
      "outPeak": mPeak > 1e-9 ? 20.0 * log10(mPeak) : -90.0,
      "grLow": mGr[0],
      "grMid": mGr[1],
      "grHigh": mGr[2],
      "grLimiter": mGrLim,
    ]
  }

  func resetPeak() {
    mPeak = 0
  }

  // MARK: - EQ coefficients (RBJ cookbook)

  private func peaking(_ f: Double, _ q: Double, _ dB: Double) -> Biquad {
    var bi = Biquad()
    let A = pow(10.0, dB / 40.0)
    let w = 2.0 * Double.pi * max(20.0, min(sr * 0.45, f)) / sr
    let alpha = sin(w) / (2.0 * max(0.2, q))
    let cw = cos(w)
    let a0 = 1.0 + alpha / A
    bi.b0 = (1.0 + alpha * A) / a0
    bi.b1 = (-2.0 * cw) / a0
    bi.b2 = (1.0 - alpha * A) / a0
    bi.a1 = (-2.0 * cw) / a0
    bi.a2 = (1.0 - alpha / A) / a0
    return bi
  }

  private func shelf(_ f: Double, _ dB: Double, high: Bool) -> Biquad {
    var bi = Biquad()
    let A = pow(10.0, dB / 40.0)
    let w = 2.0 * Double.pi * max(20.0, min(sr * 0.45, f)) / sr
    let cw = cos(w)
    let sw = sin(w)
    let S = 0.9
    let alpha = sw / 2.0 * sqrt((A + 1.0 / A) * (1.0 / S - 1.0) + 2.0)
    let twoRootAalpha = 2.0 * sqrt(A) * alpha
    if high {
      let a0 = (A + 1.0) - (A - 1.0) * cw + twoRootAalpha
      bi.b0 = (A * ((A + 1.0) + (A - 1.0) * cw + twoRootAalpha)) / a0
      bi.b1 = (-2.0 * A * ((A - 1.0) + (A + 1.0) * cw)) / a0
      bi.b2 = (A * ((A + 1.0) + (A - 1.0) * cw - twoRootAalpha)) / a0
      bi.a1 = (2.0 * ((A - 1.0) - (A + 1.0) * cw)) / a0
      bi.a2 = ((A + 1.0) - (A - 1.0) * cw - twoRootAalpha) / a0
    } else {
      let a0 = (A + 1.0) + (A - 1.0) * cw + twoRootAalpha
      bi.b0 = (A * ((A + 1.0) - (A - 1.0) * cw + twoRootAalpha)) / a0
      bi.b1 = (2.0 * A * ((A - 1.0) - (A + 1.0) * cw)) / a0
      bi.b2 = (A * ((A + 1.0) - (A - 1.0) * cw - twoRootAalpha)) / a0
      bi.a1 = (-2.0 * ((A - 1.0) + (A + 1.0) * cw)) / a0
      bi.a2 = ((A + 1.0) - (A - 1.0) * cw - twoRootAalpha) / a0
    }
    return bi
  }

  private func rebuildEq() {
    // preserve filter state across coefficient changes
    for i in 0..<5 {
      var fresh: Biquad
      switch i {
      case 0: fresh = shelf(eqLowFreq, eqLowGain, high: false)
      case 1: fresh = peaking(eqP1Freq, eqP1Q, eqP1Gain)
      case 2: fresh = peaking(eqP2Freq, eqP2Q, eqP2Gain)
      case 3: fresh = peaking(eqP3Freq, eqP3Q, eqP3Gain)
      default: fresh = shelf(eqHighFreq, eqHighGain, high: true)
      }
      fresh.z1L = eqBands[i].z1L
      fresh.z2L = eqBands[i].z2L
      fresh.z1R = eqBands[i].z1R
      fresh.z2R = eqBands[i].z2R
      eqBands[i] = fresh
    }
    eqDirty = false
  }

  @inline(__always) private func onePoleAlpha(_ cutoff: Double) -> Double {
    return 1.0 - exp(-2.0 * Double.pi * max(20.0, min(sr * 0.45, cutoff)) / sr)
  }

  // MARK: - Process one stereo sample

  func process(_ l: inout Double, _ r: inout Double) {
    if on < 0.5 { return }
    if eqDirty { rebuildEq() }

    let inGain = pow(10.0, inGainDb / 20.0)
    l *= inGain
    r *= inGain
    let rmsAlpha = onePoleAlpha(2.5) // ~400 ms window feel
    mInSq += rmsAlpha * ((l * l + r * r) * 0.5 - mInSq)

    // EQ
    for i in 0..<5 {
      eqBands[i].run(&l, &r)
    }

    // 3-band split (subtraction method: exact reconstruction when idle)
    let a1 = onePoleAlpha(xover1)
    let a2 = onePoleAlpha(xover2)
    loL += a1 * (l - loL)
    loR += a1 * (r - loR)
    hiL += a2 * (l - hiL)
    hiR += a2 * (r - hiR)
    var bandL = [loL, hiL - loL, l - hiL]
    var bandR = [loR, hiR - loR, r - hiR]

    // per-band compression
    if compOn > 0.5 {
      for b in 0..<3 {
        let e = max(abs(bandL[b]), abs(bandR[b]))
        let coef = e > compEnv[b]
          ? 1.0 - exp(-1.0 / (max(0.1, attackMs[b]) * 0.001 * sr))
          : 1.0 - exp(-1.0 / (max(1.0, releaseMs[b]) * 0.001 * sr))
        compEnv[b] += coef * (e - compEnv[b])
        var grDb = 0.0
        if compEnv[b] > 1e-6 {
          let eDb = 20.0 * log10(compEnv[b])
          if eDb > thresh[b] {
            grDb = (eDb - thresh[b]) * (1.0 - 1.0 / max(1.01, ratio[b]))
          }
        }
        let g = pow(10.0, (makeup[b] - grDb) / 20.0)
        bandL[b] *= g
        bandR[b] *= g
        mGr[b] += 0.001 * (grDb - mGr[b])
      }
    }

    // per-band width (M/S)
    for b in 0..<3 {
      let w = max(0.0, min(2.0, width[b]))
      if w != 1.0 {
        let m = (bandL[b] + bandR[b]) * 0.5
        let s = (bandL[b] - bandR[b]) * 0.5 * w
        bandL[b] = m + s
        bandR[b] = m - s
      }
    }

    l = bandL[0] + bandL[1] + bandL[2]
    r = bandR[0] + bandR[1] + bandR[2]

    // exciter: saturate the >~3 kHz component, blend back
    if excOn > 0.5 {
      let ax = onePoleAlpha(3000)
      exL += ax * (l - exL)
      exR += ax * (r - exR)
      let hL = l - exL
      let hR = r - exR
      let d = 1.0 + excDrive * 6.0
      l += (tanh(hL * d) - hL) * excMix
      r += (tanh(hR * d) - hR) * excMix
    }

    // limiter: lookahead — the gain needed by the incoming sample is applied
    // (instant-down) to the delayed signal, so the envelope is already low
    // when the peak exits the delay line; release rises smoothly.
    if limOn > 0.5 {
      let g = pow(10.0, limGainDb / 20.0)
      l *= g
      r *= g
      let ceiling = pow(10.0, min(0.0, limCeilingDb) / 20.0)
      let peakIn = max(abs(l), abs(r))
      let target = peakIn > ceiling ? ceiling / peakIn : 1.0
      let rel = 1.0 - exp(-1.0 / (max(10.0, limReleaseMs) * 0.001 * sr))
      if target < limEnv {
        limEnv = target
      } else {
        limEnv += rel * (min(1.0, target) - limEnv)
      }
      let outL = dlL[dlW] * limEnv
      let outR = dlR[dlW] * limEnv
      dlL[dlW] = l
      dlR[dlW] = r
      dlW = (dlW + 1) % lookahead
      l = max(-ceiling, min(ceiling, outL))
      r = max(-ceiling, min(ceiling, outR))
      mGrLim += 0.001 * ((limEnv < 1.0 ? -20.0 * log10(limEnv) : 0.0) - mGrLim)
    }

    mOutSq += rmsAlpha * ((l * l + r * r) * 0.5 - mOutSq)
    let p = max(abs(l), abs(r))
    if p > mPeak { mPeak = p }
  }
}
