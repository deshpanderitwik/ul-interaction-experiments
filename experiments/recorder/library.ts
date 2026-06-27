import * as LegacyFS from 'expo-file-system/legacy';
import { useEffect, useReducer } from 'react';
import { Share } from 'react-native';
import type { NoteEvent } from './recorder';
import { encodeSMF, toBase64 } from './smf';

// Persistent library of MIDI recordings: each is a .mid file in the app's
// documents, tracked by a JSON index. Supports list / rename / delete / share
// (AirDrop). Survives app restarts (unlike the in-memory settings store).

export type Recording = {
  id: string;
  name: string;
  file: string; // filename within the recordings dir
  createdAt: number;
  durationMs: number;
  noteCount: number;
  experiment: string;
};

const DIR = `${LegacyFS.documentDirectory}recordings/`;
const INDEX = `${DIR}index.json`;

let cache: Recording[] | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function subscribeLibrary(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

async function ensureDir() {
  const info = await LegacyFS.getInfoAsync(DIR);
  if (!info.exists) await LegacyFS.makeDirectoryAsync(DIR, { intermediates: true });
}

async function persist() {
  await ensureDir();
  await LegacyFS.writeAsStringAsync(INDEX, JSON.stringify(cache ?? []));
}

export async function loadLibrary(): Promise<Recording[]> {
  if (cache) return cache;
  try {
    await ensureDir();
    const info = await LegacyFS.getInfoAsync(INDEX);
    cache = info.exists ? (JSON.parse(await LegacyFS.readAsStringAsync(INDEX)) as Recording[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

export function getCached(): Recording[] {
  return cache ?? [];
}

export async function addRecording(
  events: NoteEvent[],
  meta: { experiment: string }
): Promise<Recording> {
  await loadLibrary();
  const id = `${Date.now()}`;
  const file = `${id}.mid`;
  const bytes = encodeSMF(events);
  await ensureDir();
  await LegacyFS.writeAsStringAsync(`${DIR}${file}`, toBase64(bytes), {
    encoding: LegacyFS.EncodingType.Base64,
  });
  const rec: Recording = {
    id,
    name: defaultName(meta.experiment),
    file,
    createdAt: Date.now(),
    durationMs: events.length ? events[events.length - 1].timeMs : 0,
    noteCount: events.length,
    experiment: meta.experiment,
  };
  cache = [rec, ...(cache ?? [])];
  await persist();
  emit();
  return rec;
}

export async function renameRecording(id: string, name: string) {
  await loadLibrary();
  cache = (cache ?? []).map((r) => (r.id === id ? { ...r, name } : r));
  await persist();
  emit();
}

export async function deleteRecording(id: string) {
  await loadLibrary();
  const rec = (cache ?? []).find((r) => r.id === id);
  if (rec) {
    await LegacyFS.deleteAsync(`${DIR}${rec.file}`, { idempotent: true }).catch(() => {});
  }
  cache = (cache ?? []).filter((r) => r.id !== id);
  await persist();
  emit();
}

export async function shareRecording(rec: Recording) {
  await Share.share({ url: `${DIR}${rec.file}` });
}

function defaultName(experiment: string): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${experiment} ${hh}:${mm}`;
}

// Reactive view of the library for screens.
export function useLibrary(): Recording[] {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    let mounted = true;
    loadLibrary().then(() => {
      if (mounted) force();
    });
    const unsub = subscribeLibrary(force);
    return () => {
      mounted = false;
      unsub();
    };
  }, []);
  return getCached();
}
