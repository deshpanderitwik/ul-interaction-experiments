import { NativeModule, requireOptionalNativeModule } from 'expo';

// One tap buffer's worth of mic audio, pre-digested for drawing: `peaks` is a
// run of waveform columns (max |sample| per ~16ms bin, 0..1, oldest first) and
// `rms` is the buffer's overall level (0..1-ish).
export type MicFrame = { peaks: number[]; rms: number; sampleRate: number };

// A captured take, stored natively by id (PCM never crosses the bridge).
export type Sample = { id: number; duration: number; sampleRate: number };

/**
 * Granulator patch parameters (4 slots; requires runtime >= 1.4.0), flat keys:
 * - position (0..1 read-head center) / spray (0..1 position randomness) /
 *   scan (×realtime drift: 0 freezes a texture, 1 natural, negative reverse)
 * - size (grain ms) / sizeJitter (0..1) / density (grains/s) / timeJitter (0..1)
 * - pitch (semitones) / pitchJitter (± semis of spray) / reverse (per-grain
 *   probability) / quantize (1 = snap each grain's pitch to setGrainScale)
 * - attack / release (grain window fractions, 0..0.5) / panSpray / gainJitter
 * - amp.a/d/s/r (the cloud's envelope, seconds / levels)
 */
export type GrainParams = Record<string, number>;

type MicTapEvents = {
  onAudio: (frame: MicFrame) => void;
  /** A non-looping voice finished on its own (stopVoice does not emit this). */
  onVoiceEnd: (e: { voice: number }) => void;
};

// The shape of the native mic tap + sample engine, as seen from JS. Each
// method maps 1:1 to a Function/AsyncFunction in MicTapModule.swift. The
// capture/playback surface requires a binary with runtime >= 1.3.0 — on older
// builds the whole module is null.
declare class MicTapModule extends NativeModule<MicTapEvents> {
  /** True while the mic tap is installed and capturing. */
  isRunning(): boolean;
  /**
   * Ask for mic permission (first use) and start capturing. Resolves true once
   * audio is flowing, false if the user denied microphone access.
   */
  start(): Promise<boolean>;
  /** Stop capturing (idempotent). Frames already delivered stay with JS. */
  stop(): Promise<void>;
  /** Begin keeping the tap's PCM (mic must be running; capped ~60s). */
  recordStart(): Promise<boolean>;
  /** Stop keeping PCM; stores the take. id is -1 if nothing was recorded. */
  recordStop(): Promise<Sample>;
  /** Drop a stored sample. */
  discard(id: number): Promise<void>;
  /**
   * Play a stored sample on a free voice. rate re-pitches (0.25–4, 1 = as
   * recorded); gain 0..1; pan -1..1; cutoff Hz (<= 0 bypasses the lowpass);
   * loop repeats until stopVoice; startFrac/endFrac select a 0..1 window
   * (endFrac <= 0 means "to the end"). Resolves the voice handle, -1 if none
   * was free.
   */
  play(
    id: number,
    rate: number,
    gain: number,
    pan: number,
    cutoff: number,
    loop: boolean,
    startFrac: number,
    endFrac: number
  ): Promise<number>;
  /** Retune a sounding voice; pass -999 for any field to leave it as-is. */
  setVoice(voice: number, rate: number, gain: number, pan: number, cutoff: number): Promise<void>;
  /** Stop a voice and free it for reuse. */
  stopVoice(voice: number): Promise<void>;
  /**
   * Global sample-bus FX: reverbMix/delayMix are wet % (0–100, both default
   * 0 = dry); delayTime seconds (max 2); feedback 0–95. Negative delayTime or
   * feedback leaves that field as-is.
   */
  setFx(reverbMix: number, delayMix: number, delayTime: number, feedback: number): Promise<void>;
  /** Write a stored sample to Documents as WAV; resolves the file path. */
  saveWav(id: number): Promise<string>;

  // ---- granulator ----

  /** Set one grain-patch parameter (see GrainParams for keys). */
  setGrainParam(slot: number, key: string, value: number): Promise<void>;
  /** Set many grain-patch parameters at once. */
  setGrainPatch(slot: number, params: GrainParams): Promise<void>;
  /**
   * Scale for quantized grains: semitone pitch classes (e.g. [0,2,3,5,7,8,10]
   * for minor). Empty array = chromatic.
   */
  setGrainScale(pitchClasses: number[]): Promise<void>;
  /**
   * Gate a grain cloud on over a captured sample; semis transposes every grain
   * (0 = as recorded). Resolves a voice handle for grainOff/grainSet, or -1.
   */
  grainOn(patch: number, sample: number, semis: number, gain: number, pan: number): Promise<number>;
  /** One-shot cloud: gate on, hold `hold` seconds, then auto-release. */
  grainFire(
    patch: number,
    sample: number,
    semis: number,
    gain: number,
    pan: number,
    hold: number
  ): Promise<number>;
  /** Release a cloud (enters its envelope release). */
  grainOff(voice: number): Promise<void>;
  /**
   * Live per-cloud control — scrubbing: position 0..1 moves the read head
   * under the finger. Pass -999 for any field to leave it as-is.
   */
  grainSet(voice: number, position: number, gain: number, pan: number, semis: number): Promise<void>;
  /** All clouds → release (soft panic). */
  grainReleaseAll(): Promise<void>;
  /**
   * Grain-bus ceiling guard (lookahead limiter matching the synth's mastering
   * limiter): on 0/1; gain/ceiling in dB; release ms. Pass -999 to leave a
   * field as-is.
   */
  setSampleLimiter(on: number, gain: number, ceiling: number, release: number): Promise<void>;
}

// requireOptional → null (instead of throwing) on a build that lacks the native
// module, so JS degrades to a "needs the new build" notice rather than crashing.
export default requireOptionalNativeModule<MicTapModule>('MicTap');
