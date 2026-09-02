import type { Experiment } from './registry';

// The web allowlist — the pipeline's gate.
//
// Experiments are built for the phone and vetted for the browser one at a
// time. A route key is either an experiment id ("time") or an
// experiment/variation pair ("time/eight-step"). Only listed routes appear on
// the web home menu; every route still resolves by URL so an unlisted sketch
// can be opened directly to check it. When one holds up on desktop and mobile
// web, add its key here.
export const WEB_READY: ReadonlySet<string> = new Set<string>([
  // Every route below loaded in headless Chromium (390×844 touch context and
  // a 1440×900 desktop context), mounted its screen with no console or page
  // errors, survived a tap / double-tap / drag / long-press pass, and — for
  // the sounding sketches — fired synth voices through the Web Audio port.
  // Feel and sound against the native engine still want a human pass; pull a
  // key out of this list to hide a sketch from the web menu while it's fixed.
  'time',
  'time/eight-step',
  'time/sixteen-step',
  'time/clock-3d',
  'time/circle-expansion',
  'time/overlapping-rings',
  'time/overlapping-rings-2',
  'time/overlapping-rings-3',
  'time/overlapping-rings-4',
  'combinations',
  'combinations/ring-joining',
  'drums',
  'drums/subdivisions',
  'drums/kit',
  'drums/lanes',
  'drums/beat-map',
  'drums/beat-map-vertical',
  'drums/static-balls',
  'drums/bounce',
  'drums/height-rhythms',
  'drums/analysis',
  'drums/zoom-lanes',
  'bodies',
  'bodies/paths',
  'bodies/emitters',
  'bodies/slingshot',
  'bodies/slingshot-receivers',
  'bodies/extended',
  'bodies/radial-drop',
  'bodies/bent-paths',
  'bodies/path-explorations',
  'fence',
  'fence/time',
  'fence/waves',
  'fence/raindrops',
  'fence/toolbox',
  'fence/combine',
  'fence/disintegrate',
  'duet',
  'note-radial',
  'note-radial/non-radial',
  'note-burst',
  'tempo-slide',
  'notesketch',
  'tap-color',
  'tap-color/gradient',
  'tap-color/gradient-drift',
  'tap-color/strobe',
  'tap-color/drift-strobe',
  'adsr',
  'channels',
  'channels/one',
]);

// Native-only sketches (hardware the browser build doesn't expose):
//   'sampler' — mic-tap native module (no web engine)

export function isWebReady(experimentId: string, variationId?: string): boolean {
  return WEB_READY.has(variationId ? `${experimentId}/${variationId}` : experimentId);
}

/**
 * The registry filtered to web-ready routes. An experiment survives if its
 * base route or any of its variations is listed; only listed variations are
 * kept under it.
 */
export function webExperiments(all: Experiment[]): Experiment[] {
  const out: Experiment[] = [];
  for (const e of all) {
    const base = isWebReady(e.id);
    const variations = (e.variations ?? []).filter((v) => isWebReady(e.id, v.id));
    if (!base && variations.length === 0) continue;
    out.push({ ...e, variations: variations.length ? variations : undefined });
  }
  return out;
}
