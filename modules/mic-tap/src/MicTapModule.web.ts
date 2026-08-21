// No mic tap / sample engine on web — callers guard against null exactly as
// they do on a native build that predates the module.
export type MicFrame = { peaks: number[]; rms: number; sampleRate: number };
export type Sample = { id: number; duration: number; sampleRate: number };
export type GrainParams = Record<string, number>;

export default null;
