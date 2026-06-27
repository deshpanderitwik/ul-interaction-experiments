import type { NoteEvent } from './recorder';

// Encode recorded note events into a Standard MIDI File (Type 0), pure JS.
// Real-time positions are preserved (no quantize); tempo just sets the DAW grid.

const BPM = 120;
const PPQ = 480; // ticks per quarter note
const GATE_MS = 300; // note length (plucks have no explicit note-off)

export function encodeSMF(
  events: NoteEvent[],
  opts?: { bpm?: number; ppq?: number; gateMs?: number }
): Uint8Array {
  const bpm = opts?.bpm ?? BPM;
  const ppq = opts?.ppq ?? PPQ;
  const gate = opts?.gateMs ?? GATE_MS;
  const ticksPerMs = (ppq * bpm) / 60000;

  type Ev = { tick: number; status: number; note: number; vel: number; order: number };
  const evs: Ev[] = [];
  for (const e of events) {
    const onTick = Math.max(0, Math.round(e.timeMs * ticksPerMs));
    const offTick = Math.max(onTick + 1, Math.round((e.timeMs + gate) * ticksPerMs));
    evs.push({ tick: onTick, status: 0x90, note: e.note, vel: e.velocity, order: 1 });
    evs.push({ tick: offTick, status: 0x80, note: e.note, vel: 0, order: 0 });
  }
  // Sort by tick; at equal ticks, note-offs (order 0) before note-ons (order 1).
  evs.sort((a, b) => a.tick - b.tick || a.order - b.order);

  const track: number[] = [];

  // Tempo meta event (delta 0): FF 51 03 tttttt (microseconds per quarter).
  const mpq = Math.round(60000000 / bpm);
  pushVLQ(track, 0);
  track.push(0xff, 0x51, 0x03, (mpq >> 16) & 0xff, (mpq >> 8) & 0xff, mpq & 0xff);

  let prevTick = 0;
  for (const ev of evs) {
    pushVLQ(track, ev.tick - prevTick);
    prevTick = ev.tick;
    track.push(ev.status, ev.note & 0x7f, ev.vel & 0x7f);
  }

  // End of track.
  pushVLQ(track, 0);
  track.push(0xff, 0x2f, 0x00);

  const header = [
    0x4d, 0x54, 0x68, 0x64, // "MThd"
    0x00, 0x00, 0x00, 0x06, // header length 6
    0x00, 0x00, // format 0
    0x00, 0x01, // 1 track
    (ppq >> 8) & 0xff, ppq & 0xff, // division (ticks per quarter)
  ];
  const len = track.length;
  const trackHeader = [
    0x4d, 0x54, 0x72, 0x6b, // "MTrk"
    (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff,
  ];

  return Uint8Array.from([...header, ...trackHeader, ...track]);
}

// MIDI variable-length quantity.
function pushVLQ(arr: number[], value: number) {
  let buffer = value & 0x7f;
  while ((value >>= 7) > 0) {
    buffer = (buffer << 8) | ((value & 0x7f) | 0x80);
  }
  for (;;) {
    arr.push(buffer & 0xff);
    if (buffer & 0x80) buffer >>= 8;
    else break;
  }
}

// Base64-encode bytes (no Buffer/btoa in RN).
export function toBase64(bytes: Uint8Array): string {
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[b2 & 63] : '=';
  }
  return out;
}
