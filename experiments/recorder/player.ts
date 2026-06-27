import { useEffect, useReducer } from 'react';
import { NoteSynth } from '../../modules/note-synth';
import type { NoteEvent } from './recorder';

// Preview playback of a recording through the same NoteSynth sine pluck. One
// clip plays at a time; scheduling is plain setTimeout off the event times.

let playingId: string | null = null;
let timers: ReturnType<typeof setTimeout>[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function subscribePlayer(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function midiToFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

export function stopPlayback() {
  for (const t of timers) clearTimeout(t);
  timers = [];
  if (playingId !== null) {
    playingId = null;
    emit();
  }
}

export function playRecording(id: string, events: NoteEvent[]) {
  stopPlayback();
  if (events.length === 0) return;
  playingId = id;
  emit();
  for (const e of events) {
    timers.push(
      setTimeout(() => {
        const gain = Math.max(0, Math.min(1, e.velocity / 127));
        NoteSynth?.pluck(midiToFreq(e.note), gain, 0.6).catch(() => {});
      }, e.timeMs)
    );
  }
  // Mark playback finished a beat after the last note.
  const endMs = events[events.length - 1].timeMs + 700;
  timers.push(
    setTimeout(() => {
      timers = [];
      playingId = null;
      emit();
    }, endMs)
  );
}

export function usePlayingId(): string | null {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => subscribePlayer(force), []);
  return playingId;
}
