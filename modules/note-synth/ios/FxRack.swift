import Foundation

// A Soundtoys-flavored effects rack, hand-rolled DSP, processing the synth's
// stereo mix per-sample. Fixed chain order (each unit bypassable, each with
// its own wet/dry where it makes sense):
//
//   saturator (Decapitator) → filter (FilterFreak) → phaser (PhaseMistress)
//   → chorus/flanger → tremolo/auto-pan (Tremolator/PanMan) → micro-shift
//   (MicroShift) → granular pitch echo (Crystallizer) → analog echo (EchoBoy)
//
// All parameters are flat {key: value} doubles set from JS (same idiom as
// synth patches), so sweeps stream over the bridge as plain numbers. The rack
// self-bypasses (zero cost) when every unit is off.
final class FxRack {
  private let sr: Double

  // MARK: - Parameters (flat, JS-settable)

  // Saturator: style 0 tape / 1 tube (even harmonics) / 2 fuzz.
  var satOn = 0.0
  var satDrive = 0.5
  var satStyle = 0.0
  var satTone = 0.5 // 0 dark … 1 bright (tilt around ~1.2 kHz)
  var satMix = 1.0
  // Filter: type 0 LP / 1 HP / 2 BP, with own LFO + envelope follower.
  var filtOn = 0.0
  var filtType = 0.0
  var filtCutoff = 1200.0
  var filtRes = 0.3
  var filtLfoHz = 0.5
  var filtLfoAmt = 0.0 // ±octaves of sweep (×3)
  var filtEnvAmt = 0.0 // envelope → cutoff (×5 octaves)
  var filtMix = 1.0
  // Phaser: 2–8 allpass stages.
  var phOn = 0.0
  var phRate = 0.4
  var phDepth = 0.7
  var phCenter = 800.0
  var phFb = 0.3
  var phStages = 6.0
  var phMix = 0.5
  // Chorus/flanger: short modulated delay (flange = small delay + feedback).
  var chOn = 0.0
  var chRate = 0.8
  var chDepth = 0.5
  var chDelayMs = 12.0
  var chFb = 0.0
  var chSpread = 1.0 // stereo LFO phase offset
  var chMix = 0.5
  // Tremolator: shape 0 sine / 1 square / 2 saw; pan 1 = auto-pan mode.
  // An optional step pattern (setPattern) replaces the LFO with a gate
  // sequencer advancing one step per cycle of `trRate`.
  var trOn = 0.0
  var trRate = 4.0
  var trDepth = 0.8
  var trShape = 0.0
  var trPan = 0.0
  // MicroShift: dual detune widener (L up, R down).
  var msOn = 0.0
  var msCents = 12.0
  var msMix = 0.5
  // Crystallizer: granular pitch echo (pitch in semitones, reverse tape-style).
  var cyOn = 0.0
  var cyPitch = 12.0
  var cySizeMs = 350.0
  var cyFb = 0.4
  var cyReverse = 0.0
  var cyMix = 0.4
  // EchoBoy: stereo analog-style echo — tone + saturation + wow in the loop.
  var ecOn = 0.0
  var ecTimeMs = 380.0
  var ecOffsetMs = 0.0
  var ecFb = 0.35
  var ecPing = 0.0
  var ecToneLo = 120.0 // highpass in the loop
  var ecToneHi = 4500.0 // lowpass in the loop
  var ecWow = 0.15
  var ecSat = 0.3
  var ecMix = 0.35

  private var anyOn = false
  private var tremPattern: [Double] = []

  // MARK: - State

  // filter
  private var fIc1L = 0.0, fIc2L = 0.0, fIc1R = 0.0, fIc2R = 0.0
  private var fLfoP = 0.0
  private var fEnv = 0.0
  // saturator tone tilt
  private var stLpL = 0.0, stLpR = 0.0
  // phaser
  private var apXL = [Double](repeating: 0, count: 8)
  private var apYL = [Double](repeating: 0, count: 8)
  private var apXR = [Double](repeating: 0, count: 8)
  private var apYR = [Double](repeating: 0, count: 8)
  private var phLfoP = 0.0
  private var phLastL = 0.0, phLastR = 0.0
  // chorus
  private var chBufL: [Double]
  private var chBufR: [Double]
  private var chW = 0
  private var chLfoP = 0.0
  private let chLen: Int
  // tremolo
  private var trPhase = 0.0
  private var trStep = 0
  private var trGainL = 1.0
  private var trGainR = 1.0
  // micro-shift
  private var msBufL: [Double]
  private var msBufR: [Double]
  private var msW = 0
  private var msP_L = 0.0
  private var msP_R = 0.0
  private let msLen: Int
  // crystallizer
  private var cyBufL: [Double]
  private var cyBufR: [Double]
  private var cyW = 0
  private var cyP = 0.0
  private let cyLen: Int
  // echo
  private var ecBufL: [Double]
  private var ecBufR: [Double]
  private var ecW = 0
  private var ecLfoP = 0.0
  private var ecLpL = 0.0, ecLpR = 0.0
  private var ecHpL = 0.0, ecHpR = 0.0
  private let ecLen: Int

  init(sampleRate: Double) {
    sr = sampleRate
    chLen = Int(sampleRate * 0.06) + 4
    chBufL = [Double](repeating: 0, count: chLen)
    chBufR = [Double](repeating: 0, count: chLen)
    msLen = Int(sampleRate * 0.05) + 4
    msBufL = [Double](repeating: 0, count: msLen)
    msBufR = [Double](repeating: 0, count: msLen)
    cyLen = Int(sampleRate * 1.5) + 4
    cyBufL = [Double](repeating: 0, count: cyLen)
    cyBufR = [Double](repeating: 0, count: cyLen)
    ecLen = Int(sampleRate * 2.0) + 4
    ecBufL = [Double](repeating: 0, count: ecLen)
    ecBufR = [Double](repeating: 0, count: ecLen)
  }

  // MARK: - Parameter routing

  func setParam(_ key: String, _ v: Double) {
    switch key {
    case "sat.on": satOn = v
    case "sat.drive": satDrive = v
    case "sat.style": satStyle = v
    case "sat.tone": satTone = v
    case "sat.mix": satMix = v
    case "filt.on": filtOn = v
    case "filt.type": filtType = v
    case "filt.cutoff": filtCutoff = v
    case "filt.res": filtRes = v
    case "filt.lfoHz": filtLfoHz = v
    case "filt.lfoAmt": filtLfoAmt = v
    case "filt.envAmt": filtEnvAmt = v
    case "filt.mix": filtMix = v
    case "phaser.on": phOn = v
    case "phaser.rate": phRate = v
    case "phaser.depth": phDepth = v
    case "phaser.center": phCenter = v
    case "phaser.fb": phFb = v
    case "phaser.stages": phStages = v
    case "phaser.mix": phMix = v
    case "chorus.on": chOn = v
    case "chorus.rate": chRate = v
    case "chorus.depth": chDepth = v
    case "chorus.delay": chDelayMs = v
    case "chorus.fb": chFb = v
    case "chorus.spread": chSpread = v
    case "chorus.mix": chMix = v
    case "trem.on": trOn = v
    case "trem.rate": trRate = v
    case "trem.depth": trDepth = v
    case "trem.shape": trShape = v
    case "trem.pan": trPan = v
    case "micro.on": msOn = v
    case "micro.cents": msCents = v
    case "micro.mix": msMix = v
    case "cryst.on": cyOn = v
    case "cryst.pitch": cyPitch = v
    case "cryst.size": cySizeMs = v
    case "cryst.fb": cyFb = v
    case "cryst.reverse": cyReverse = v
    case "cryst.mix": cyMix = v
    case "echo.on": ecOn = v
    case "echo.time": ecTimeMs = v
    case "echo.offset": ecOffsetMs = v
    case "echo.fb": ecFb = v
    case "echo.pingpong": ecPing = v
    case "echo.toneLo": ecToneLo = v
    case "echo.toneHi": ecToneHi = v
    case "echo.wow": ecWow = v
    case "echo.sat": ecSat = v
    case "echo.mix": ecMix = v
    default: break
    }
    anyOn =
      satOn > 0.5 || filtOn > 0.5 || phOn > 0.5 || chOn > 0.5 || trOn > 0.5
      || msOn > 0.5 || cyOn > 0.5 || ecOn > 0.5
  }

  func setPattern(_ steps: [Double]) {
    tremPattern = steps.map { max(0.0, min(1.0, $0)) }
    trStep = 0
  }

  // MARK: - Helpers

  @inline(__always) private func readFrac(_ buf: [Double], _ w: Int, _ delay: Double, _ len: Int) -> Double {
    var d = delay
    if d < 1 { d = 1 }
    if d > Double(len - 2) { d = Double(len - 2) }
    let pos = Double(w) - d
    let wrapped = pos - floor(pos / Double(len)) * Double(len)
    let i0 = Int(wrapped) % len
    let i1 = (i0 + 1) % len
    let f = wrapped - floor(wrapped)
    return buf[i0] + (buf[i1] - buf[i0]) * f
  }

  @inline(__always) private func onePoleAlpha(_ cutoff: Double) -> Double {
    return 1.0 - exp(-2.0 * Double.pi * max(10.0, min(sr * 0.45, cutoff)) / sr)
  }

  // MARK: - Process one stereo sample through the chain

  func process(_ l: inout Double, _ r: inout Double) {
    if !anyOn { return }
    let twoPi = 2.0 * Double.pi

    // ---- saturator ----
    if satOn > 0.5 {
      let g = 1.0 + satDrive * 20.0
      let makeup = 1.0 / (1.0 + satDrive * 1.6)
      var wl: Double
      var wr: Double
      if satStyle < 0.5 { // tape
        wl = tanh(l * g)
        wr = tanh(r * g)
      } else if satStyle < 1.5 { // tube: asymmetric bias → even harmonics
        let bias = 0.28 * satDrive
        wl = tanh(l * g + bias) - tanh(bias)
        wr = tanh(r * g + bias) - tanh(bias)
      } else { // fuzz
        wl = max(-1.0, min(1.0, l * g * 1.5))
        wr = max(-1.0, min(1.0, r * g * 1.5))
      }
      // tone tilt around ~1.2 kHz
      let a = onePoleAlpha(1200)
      stLpL += a * (wl - stLpL)
      stLpR += a * (wr - stLpR)
      let tl = satTone
      wl = (stLpL * (1.0 - tl) + (wl - stLpL) * tl) * 2.0 * makeup
      wr = (stLpR * (1.0 - tl) + (wr - stLpR) * tl) * 2.0 * makeup
      l += (wl - l) * satMix
      r += (wr - r) * satMix
    }

    // ---- filter ----
    if filtOn > 0.5 {
      fLfoP += filtLfoHz / sr
      fLfoP -= floor(fLfoP)
      let lfo = sin(fLfoP * twoPi)
      let inAbs = (abs(l) + abs(r)) * 0.5
      let coef = inAbs > fEnv ? onePoleAlpha(30) : onePoleAlpha(3)
      fEnv += coef * (inAbs - fEnv)
      var cutoff = filtCutoff * pow(2.0, filtLfoAmt * lfo * 3.0 + filtEnvAmt * fEnv * 5.0)
      cutoff = max(30.0, min(sr * 0.45, cutoff))
      let g = tan(Double.pi * cutoff / sr)
      let k = 2.0 - 1.9 * max(0.0, min(1.0, filtRes))
      let a1 = 1.0 / (1.0 + g * (g + k))
      let a2 = g * a1
      let a3 = g * a2
      let v3L = l - fIc2L
      let v1L = a1 * fIc1L + a2 * v3L
      let v2L = fIc2L + a2 * fIc1L + a3 * v3L
      fIc1L = 2.0 * v1L - fIc1L
      fIc2L = 2.0 * v2L - fIc2L
      let v3R = r - fIc2R
      let v1R = a1 * fIc1R + a2 * v3R
      let v2R = fIc2R + a2 * fIc1R + a3 * v3R
      fIc1R = 2.0 * v1R - fIc1R
      fIc2R = 2.0 * v2R - fIc2R
      var wl: Double
      var wr: Double
      if filtType < 0.5 {
        wl = v2L
        wr = v2R
      } else if filtType < 1.5 {
        wl = l - k * v1L - v2L
        wr = r - k * v1R - v2R
      } else {
        wl = v1L
        wr = v1R
      }
      l += (wl - l) * filtMix
      r += (wr - r) * filtMix
    }

    // ---- phaser ----
    if phOn > 0.5 {
      phLfoP += phRate / sr
      phLfoP -= floor(phLfoP)
      let stages = max(2, min(8, Int(phStages)))
      let fL = phCenter * pow(2.0, phDepth * sin(phLfoP * twoPi) * 2.0)
      let fR = phCenter * pow(2.0, phDepth * sin((phLfoP + 0.25) * twoPi) * 2.0)
      let tL = tan(Double.pi * max(60.0, min(sr * 0.4, fL)) / sr)
      let tR = tan(Double.pi * max(60.0, min(sr * 0.4, fR)) / sr)
      let aL = (tL - 1.0) / (tL + 1.0)
      let aR = (tR - 1.0) / (tR + 1.0)
      var xl = l + phLastL * phFb
      var xr = r + phLastR * phFb
      for s in 0..<stages {
        let yl = aL * xl + apXL[s] - aL * apYL[s]
        apXL[s] = xl
        apYL[s] = yl
        xl = yl
        let yr = aR * xr + apXR[s] - aR * apYR[s]
        apXR[s] = xr
        apYR[s] = yr
        xr = yr
      }
      phLastL = xl
      phLastR = xr
      l += (xl - l) * phMix
      r += (xr - r) * phMix
    }

    // ---- chorus / flanger ----
    if chOn > 0.5 {
      chLfoP += chRate / sr
      chLfoP -= floor(chLfoP)
      let base = max(1.5, min(50.0, chDelayMs)) * sr / 1000.0
      let depth = chDepth * base * 0.45
      let dL = base + depth * sin(chLfoP * twoPi)
      let dR = base + depth * sin((chLfoP + 0.25 * chSpread) * twoPi)
      let wl = readFrac(chBufL, chW, dL, chLen)
      let wr = readFrac(chBufR, chW, dR, chLen)
      chBufL[chW] = l + wl * chFb
      chBufR[chW] = r + wr * chFb
      chW = (chW + 1) % chLen
      l += (wl - l) * chMix
      r += (wr - r) * chMix
    }

    // ---- tremolo / auto-pan ----
    if trOn > 0.5 {
      trPhase += trRate / sr
      var targetL = 1.0
      var targetR = 1.0
      if !tremPattern.isEmpty {
        if trPhase >= 1.0 {
          trPhase -= floor(trPhase)
          trStep = (trStep + 1) % tremPattern.count
        }
        let level = 1.0 - trDepth * (1.0 - tremPattern[trStep])
        targetL = level
        targetR = level
      } else {
        let t = trPhase - floor(trPhase)
        var v: Double
        if trShape < 0.5 {
          v = 0.5 + 0.5 * sin(t * twoPi)
        } else if trShape < 1.5 {
          v = t < 0.5 ? 1.0 : 0.0
        } else {
          v = 1.0 - t
        }
        if trPan > 0.5 {
          let p = 2.0 * v - 1.0
          targetL = 1.0 - trDepth * max(0.0, p)
          targetR = 1.0 - trDepth * max(0.0, -p)
        } else {
          let level = 1.0 - trDepth * (1.0 - v)
          targetL = level
          targetR = level
        }
      }
      // slew to avoid clicks on square edges / pattern steps
      trGainL += (targetL - trGainL) * 0.008
      trGainR += (targetR - trGainR) * 0.008
      l *= trGainL
      r *= trGainR
    }

    // ---- micro-shift ----
    if msOn > 0.5 {
      msBufL[msW] = l
      msBufR[msW] = r
      let win = Double(msLen - 4)
      let up = pow(2.0, msCents / 1200.0)
      let dn = pow(2.0, -msCents / 1200.0)
      msP_L += (1.0 - up) / win
      msP_L -= floor(msP_L)
      msP_R += (1.0 - dn) / win
      msP_R -= floor(msP_R)
      let p2L = msP_L + 0.5 - floor(msP_L + 0.5)
      let p2R = msP_R + 0.5 - floor(msP_R + 0.5)
      let g1L = sin(Double.pi * msP_L)
      let g2L = sin(Double.pi * p2L)
      let g1R = sin(Double.pi * msP_R)
      let g2R = sin(Double.pi * p2R)
      let wl = readFrac(msBufL, msW, msP_L * win, msLen) * g1L
        + readFrac(msBufL, msW, p2L * win, msLen) * g2L
      let wr = readFrac(msBufR, msW, msP_R * win, msLen) * g1R
        + readFrac(msBufR, msW, p2R * win, msLen) * g2R
      msW = (msW + 1) % msLen
      l += (wl - l) * msMix
      r += (wr - r) * msMix
    }

    // ---- crystallizer ----
    if cyOn > 0.5 {
      let win = max(50.0, min(1400.0, cySizeMs)) * sr / 1000.0
      let ratio = pow(2.0, cyPitch / 12.0)
      let eff = cyReverse > 0.5 ? -ratio : ratio
      cyP += (1.0 - eff) / win
      cyP -= floor(cyP)
      let p2 = cyP + 0.5 - floor(cyP + 0.5)
      let g1 = sin(Double.pi * cyP)
      let g2 = sin(Double.pi * p2)
      let wl = readFrac(cyBufL, cyW, cyP * win, cyLen) * g1
        + readFrac(cyBufL, cyW, p2 * win, cyLen) * g2
      let wr = readFrac(cyBufR, cyW, cyP * win, cyLen) * g1
        + readFrac(cyBufR, cyW, p2 * win, cyLen) * g2
      cyBufL[cyW] = l + wl * cyFb
      cyBufR[cyW] = r + wr * cyFb
      cyW = (cyW + 1) % cyLen
      l += (wl - l) * cyMix
      r += (wr - r) * cyMix
    }

    // ---- echo ----
    if ecOn > 0.5 {
      ecLfoP += 0.6 / sr
      ecLfoP -= floor(ecLfoP)
      let wow = ecWow * (sin(ecLfoP * twoPi) * 2.2 + sin(ecLfoP * twoPi * 11.0) * 0.4)
      let dL = max(5.0, ecTimeMs + wow) * sr / 1000.0
      let dR = max(5.0, ecTimeMs + ecOffsetMs + wow) * sr / 1000.0
      var fbL = readFrac(ecBufL, ecW, dL, ecLen)
      var fbR = readFrac(ecBufR, ecW, dR, ecLen)
      // loop tone: highpass then lowpass one-poles
      let aHi = onePoleAlpha(ecToneHi)
      let aLo = onePoleAlpha(ecToneLo)
      ecLpL += aHi * (fbL - ecLpL)
      ecLpR += aHi * (fbR - ecLpR)
      ecHpL += aLo * (ecLpL - ecHpL)
      ecHpR += aLo * (ecLpR - ecHpR)
      var tL = ecLpL - ecHpL
      var tR = ecLpR - ecHpR
      // loop saturation
      if ecSat > 0 {
        let g = 1.0 + ecSat * 2.5
        tL = tanh(tL * g) / g * (1.0 + ecSat)
        tR = tanh(tR * g) / g * (1.0 + ecSat)
      }
      if ecPing > 0.5 {
        ecBufL[ecW] = l + r * 0.5 + tR * ecFb
        ecBufR[ecW] = tL * ecFb
      } else {
        ecBufL[ecW] = l + tL * ecFb
        ecBufR[ecW] = r + tR * ecFb
      }
      ecW = (ecW + 1) % ecLen
      fbL = tL
      fbR = tR
      l += (fbL - l) * ecMix
      r += (fbR - r) * ecMix
    }
  }
}
