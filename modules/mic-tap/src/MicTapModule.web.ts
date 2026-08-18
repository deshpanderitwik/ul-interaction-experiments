// No mic tap on web — callers guard against null exactly as they do on a
// native build that predates the module.
export type MicFrame = { peaks: number[]; rms: number; sampleRate: number };

export default null;
