import { useEffect, useReducer } from 'react';

// Global tempo (BPM), shared across experiments and shown in the settings sheet.
// In-memory like the scale store.

export const TEMPO_MIN = 60;
export const TEMPO_MAX = 200;

let current = 120;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function getTempo(): number {
  return current;
}

export function setTempo(bpm: number) {
  current = Math.max(TEMPO_MIN, Math.min(TEMPO_MAX, Math.round(bpm)));
  emit();
}

export function subscribeTempo(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useTempo(): number {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => subscribeTempo(force), []);
  return current;
}
