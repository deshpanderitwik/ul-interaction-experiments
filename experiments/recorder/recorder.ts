// A tiny global MIDI recorder. Any experiment's note path calls recordNote()
// when it triggers a pluck; while armed, we capture {pitch, velocity, time}.
// Independent of audio output, so it captures events even on builds where
// NoteSynth is silent. UI subscribes via subscribe() for the record indicator.

export type NoteEvent = { note: number; velocity: number; timeMs: number };

let recording = false;
let startedAt = 0;
let events: NoteEvent[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function isRecording(): boolean {
  return recording;
}

export function eventCount(): number {
  return events.length;
}

export function startRecording() {
  events = [];
  startedAt = Date.now();
  recording = true;
  emit();
}

export function stopRecording(): NoteEvent[] {
  recording = false;
  emit();
  return events.slice();
}

// Called from each experiment's pluck. freq in Hz, gain 0..1 → velocity.
export function recordNote(freq: number, gain: number) {
  if (!recording) return;
  const note = Math.round(69 + 12 * Math.log2(freq / 440));
  if (note < 0 || note > 127) return;
  const velocity = Math.max(1, Math.min(127, Math.round(gain * 127)));
  events.push({ note, velocity, timeMs: Date.now() - startedAt });
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
