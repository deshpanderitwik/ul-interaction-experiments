import type { ComponentType } from 'react';

// The single source of truth for what experiments exist.
// Add an experiment = drop a folder in experiments/ and add one entry here.
// Both the Home menu and the dynamic routes read from this list, so they
// can never drift out of sync.

type Load = () => Promise<{ default: ComponentType<any> }>;

// A variation ("draft") builds off its parent experiment. Two flavors:
//   - preset: props passed to the parent's component (composable; combinations
//     are free — just set more fields). Preferred for a coherent family.
//   - load:   a fully custom component (escape hatch for a variation that's a
//     genuinely different idea, not just the parent with knobs).
// It lives at /experiments/<experimentId>/<variationId> and appears indented
// under the parent in the menu. When a variation feels dialed, fold it into
// the parent: make it the base default, delete the entry, note the why.
export type Variation = {
  id: string;
  title: string;
  blurb?: string;
  preset?: Record<string, unknown>;
  load?: Load;
  /** Opt this variation into the audio controls (scale + tempo + record). */
  audio?: boolean;
};

export type Experiment = {
  /** Stable id — used as the route param and React key, e.g. "tap-color". */
  id: string;
  /** Menu label. */
  title: string;
  /** One-line description shown on the menu card. */
  blurb?: string;
  /** Optional accent color for the menu card. */
  accent?: string;
  /** Musical experiments — show the global scale + tempo controls in settings. */
  audio?: boolean;
  /** Lazy import of the experiment's screen (default export). */
  load: Load;
  /** Optional sub-experiments shown indented under this one. */
  variations?: Variation[];
};

export const experiments: Experiment[] = [
  {
    id: 'time',
    title: 'Time',
    blurb: 'Explorations of looping a chunk of time. First: a clock that counts up to a set number of bars, snaps back to 0, and counts up again — a sweeping hand, a ring of beat dots that fill as it goes, and drag ↕ to set the loop length.',
    accent: '#a0b4ff',
    audio: true,
    load: () => import('./time'),
    variations: [
      {
        id: 'eight-step',
        title: 'Eight Step',
        blurb: 'The loop clock locked to 8 bars, so the ring becomes eight big steps (one per bar). Same carry-forward clock, but the stops are large and button-like — the first hint that these steps want to be tapped.',
        load: () => import('./time/eight-step'),
      },
      {
        id: 'sixteen-step',
        title: 'Sixteen Step',
        blurb: 'One bar of sixteenths wrapped onto the ring — sixteen stops, each sized by its metric weight: downbeat biggest, then beat 3, then beats 2 & 4, then the 8th “ands,” then the weak 16ths smallest. The metric skeleton, made visible.',
        load: () => import('./time/sixteen-step'),
      },
      {
        id: 'clock-3d',
        title: '3D Clock',
        blurb: 'Three concentric clocks looping at different lengths (1, 2, 4 bars). Tap to tilt the “camera”: the rings flatten and separate into a stack seen from the side; tap again to lie flat, top-down. The same loops read as nested rings or a depth stack.',
        load: () => import('./time/clock-3d'),
      },
      {
        id: 'circle-expansion',
        title: 'Circle Expansion',
        blurb: 'The loop as a ring or a timeline. Tap and the circle of beat-dots unrolls into a straight line — a true length-preserving unroll (each point rides a flattening arc), not a slide — and tap again to roll it back. A playhead travels the shape either way.',
        load: () => import('./time/circle-expansion'),
      },
      {
        id: 'overlapping-rings',
        title: 'Overlapping Rings',
        blurb: 'A stack of same-size loop rings. Top-down they overlap into one — swipe either direction to cycle which ring is showing. Tap to tilt the camera and see the whole stack at once, the current ring held in front; tap again to drop back to top-down. Back-swipe navigation is off so both swipe directions cycle.',
        load: () => import('./time/overlapping-rings'),
      },
      {
        id: 'overlapping-rings-2',
        title: 'Overlapping Rings II',
        blurb: 'Each ring is a layer: tap a slot to activate a point, and every layer’s points composite, in colour, over the top-down view; when the hand touches a hit it pops, ripples, and sounds a soft note (one scale pitch per layer). Slide down to tilt into the isometric stack, slide up to return; swipe left/right to change the layer, tap a ring in the stack to land on it. Long-press a slot to set how many rotations it skips.',
        audio: true,
        load: () => import('./time/overlapping-rings-2'),
      },
      {
        id: 'overlapping-rings-3',
        title: 'Overlapping Rings III',
        blurb: 'Overlapping Rings II reworked around a live resolution: the pattern lives on a fixed 32-slot grid, and dragging up/down on the circumference changes how many subdivisions you see and edit (4→32) without losing your dots. Pinch to zoom into a region and drag its interior to pan around; double-tap tilts into the isometric stack; tap a coloured circle at the bottom to switch layers; long-press sets a slot’s rotation skip.',
        audio: true,
        load: () => import('./time/overlapping-rings-3'),
      },
      {
        id: 'overlapping-rings-4',
        title: 'Overlapping Rings IV',
        blurb: 'Overlapping Rings III with the pinch-zoom removed and the isometric camera back on a swipe instead of a double-tap. Fixed at 32 subdivisions with bigger rings and dots. Tap out a tempo on the centre target and the clock re-aligns to it; swipe up/down to tilt into the isometric stack (down) and back (up); tap a coloured circle at the bottom to switch layers; long-press sets a slot’s rotation skip.',
        audio: true,
        load: () => import('./time/overlapping-rings-4'),
      },
    ],
  },
  {
    id: 'combinations',
    title: 'Combinations',
    blurb: 'Several experiments playing at once on one shared clock. First up: Path Explorations + drum Subdivisions, phase-locked — flip between them with the bottom nav.',
    accent: '#ffd166',
    audio: true,
    load: () => import('./combinations'),
  },
  {
    id: 'drums',
    title: 'Drums',
    blurb: 'An eight-step kick sequencer stacked vertically: tap a step to place a kick; the playhead falls down the column, looping the bar. Hello world for drums.',
    accent: '#ff6b6b',
    audio: true,
    load: () => import('./drums'),
    variations: [
      {
        id: 'subdivisions',
        title: 'Subdivisions',
        blurb: 'Each step can ratchet: tap to toggle, then press-drag a step up for fewer subdivisions or down for more (2, 3, 4… sub-hits in its slot — a drum roll). The bar splits into cells that light as they fire.',
        load: () => import('./drums/subdivisions'),
      },
      {
        id: 'kit',
        title: 'Kit',
        blurb: 'A 3-lane × 8-step grid — kick, snare, hi-hat. Snare and hats are noise approximated from stacked inharmonic sine plucks. Tap cells to build a beat; the playhead sweeps the bar.',
        load: () => import('./drums/kit'),
      },
      {
        id: 'lanes',
        title: 'Three Lanes',
        blurb: 'The vertical kick sequencer widened to three parallel lanes (kick, snare, hi-hat) and lengthened to 16 steps. Tap cells in any lane to add or remove beats; the playhead falls down all three together.',
        load: () => import('./drums/lanes'),
      },
      {
        id: 'beat-map',
        title: 'Beat Map',
        blurb: 'A pure visual (no sound): every place a hit can land in a 2-bar loop — bar, 1/4, 1/8, 1/16 and the triplet grid — laid out as the territory we’re modeling, with tick height showing metric strength and a sweeping playhead.',
        audio: false,
        load: () => import('./drums/beat-map'),
      },
      {
        id: 'beat-map-vertical',
        title: 'Vertical Beat Map',
        blurb: 'The Beat Map rotated: time flows top-to-bottom and the subdivision levels are columns; a horizontal playhead descends the 2-bar loop. Same territory, vertical orientation.',
        audio: false,
        load: () => import('./drums/beat-map-vertical'),
      },
      {
        id: 'static-balls',
        title: 'Static Rhythm With Balls',
        blurb: 'Two balls keep a fixed groove: a kick ball bounces on every beat (4/4) and a snare ball bounces half as often, landing on the downbeats (1 & 3). The rhythm is the physics — two clock-locked bounces that never drift.',
        load: () => import('./drums/static-balls'),
      },
      {
        id: 'bounce',
        title: 'Bounce',
        blurb: 'A ball falling under gravity: every time it hits the ground it thumps a kick (louder on harder impacts), doing the natural accelerating dribble until it settles. Tap anywhere to drop it from that spot.',
        load: () => import('./drums/bounce'),
      },
      {
        id: 'height-rhythms',
        title: 'Height Rhythms',
        blurb: 'Three bouncing balls — kick, snare, hi-hat — each apex picks a slot off a rhythm ladder on the left (straight, off-beat, and dotted/syncopated rungs). Tap a label to bring a voice in; drag its column to set how high it bounces. A bar meter below loops a 4-bar phrase: tap a bar to select it, then move a sound to write a variation just for that bar. Everything stays grid-locked to the shared beat.',
        load: () => import('./drums/height-rhythms'),
      },
      {
        id: 'analysis',
        title: 'Analysis',
        blurb: 'Reverse-engineering a real sequenced drum part: a transcribed deadmau5-style electro-house drop groove (four-on-the-floor kick, backbeat clap, off-beat open hats, 16th closed-hat interplay, ghost snares, a bar-4 fill) played back and drawn as a vertical piano-roll — time flows down 4 bars, brightness is velocity. The reference we work backwards from to design the interactions that build it.',
        load: () => import('./drums/analysis'),
      },
      {
        id: 'zoom-lanes',
        title: 'Zoom Lanes',
        blurb: 'A six-piece kit (kick, snare, tom, clap, hat, open hat — all modified sines) as six vertical lanes looping in parallel. Tap a lane and the same vertical lane just gets bigger (16 tall cells) over a scrim for easy editing; tap the scrim to zoom back out.',
        load: () => import('./drums/zoom-lanes'),
      },
    ],
  },
  {
    id: 'bodies',
    title: 'Bodies',
    blurb: 'Plant sounding bodies in a scene: double-tap to add, tap to play/pause, drag to arrange, hold to tune. The atom of composition.',
    accent: '#54f2b0',
    audio: true,
    load: () => import('./bodies'),
    variations: [
      {
        id: 'paths',
        title: 'Paths',
        blurb: 'Trace a stroke across the pitch grid and a runner travels down it, plucking an arp as it goes. Draw many.',
        load: () => import('./bodies/paths'),
      },
      {
        id: 'emitters',
        title: 'Emitters & Receivers',
        blurb: 'Long-press an emitter that pulses waves; double-tap a receiver that sounds when a wave reaches it. Rhythm from distance.',
        load: () => import('./bodies/emitters'),
      },
      {
        id: 'slingshot',
        title: 'Slingshot',
        blurb: 'Drag back and release to fling a body across the grid; it ricochets off the edges, ringing notes as it passes, then fades.',
        load: () => import('./bodies/slingshot'),
      },
      {
        id: 'slingshot-receivers',
        title: 'Slingshot & Receivers',
        blurb: 'Long-press to place silent receivers, then sling a body that bounces around making no sound of its own — it only rings a note when it strikes a receiver.',
        load: () => import('./bodies/slingshot-receivers'),
      },
      {
        id: 'extended',
        title: 'Extended Grid',
        blurb: 'Bodies on the full C0–C5 grid; press and drag the note-label column to scroll the visible window up and down.',
        load: () => import('./bodies/extended'),
      },
      {
        id: 'radial-drop',
        title: 'Radial Drop',
        blurb: 'Extended Grid, but you long-press to drop a body: a radial of subdivisions blooms around your finger — tap one to place it already tuned to that pulse.',
        load: () => import('./bodies/radial-drop'),
      },
      {
        id: 'bent-paths',
        title: 'Bent Paths',
        blurb: 'Radial Drop, but press-drag a path’s length to pluck it like a string: it bows to your finger and the body rides the bend, then snaps back with a twang on release.',
        load: () => import('./bodies/bent-paths'),
      },
      {
        id: 'path-explorations',
        title: 'Path Explorations',
        blurb: 'Bent Paths, plus interior waypoints you can make “dynamic” (each cycle they wander to a neighboring note) or hand a laid sub-sequence of notes to step through — so the body improvises variations around the path.',
        load: () => import('./bodies/path-explorations'),
      },
    ],
  },
  {
    id: 'fence',
    title: 'Fence',
    blurb: 'A study in shaders — drag to move a glow across a live UV field.',
    accent: '#9b8cff',
    load: () => import('./fence'),
    variations: [
      {
        id: 'time',
        title: 'Rung 1 · Time',
        blurb: 'A gradient sphere whose colors flow over time — the clock uniform.',
        load: () => import('./fence/time'),
      },
      {
        id: 'waves',
        title: 'Waves',
        blurb: 'A full-screen gradient that undulates like fluid (domain-warped flow).',
        load: () => import('./fence/waves'),
      },
      {
        id: 'raindrops',
        title: 'Raindrops',
        blurb: 'The Waves substrate, but touch-and-hold drops raindrop ripples that plink up the scale.',
        audio: true,
        load: () => import('./fence/raindrops'),
      },
      {
        id: 'toolbox',
        title: 'Rung 2 · Toolbox',
        blurb: 'Shaping functions: the screen tints by f(x) with its curve plotted; chips swap the tool.',
        load: () => import('./fence/toolbox'),
      },
      {
        id: 'combine',
        title: 'Rung 2 · Combine',
        blurb: 'Chain shaping functions: hold to add a tool from a radial; double-tap to tune or delete.',
        load: () => import('./fence/combine'),
      },
      {
        id: 'disintegrate',
        title: 'Disintegrating Circle',
        blurb: 'A solid white disc; hold and that spot shatters into particles that flutter around your finger, release to reform.',
        load: () => import('./fence/disintegrate'),
      },
    ],
  },
  {
    id: 'duet',
    title: 'Duet',
    blurb: 'Two cells you toggle on/off: a legato sine root and a pulsing square fifth that shimmer and ripple.',
    accent: '#54f2e0',
    audio: true,
    load: () => import('./duet'),
  },
  {
    id: 'note-radial',
    title: 'Note Radial',
    blurb: 'Build chords from a radial of scale notes; chain them into an auto-playing progression.',
    accent: '#7af0d4',
    audio: true,
    load: () => import('./note-radial'),
    variations: [
      {
        id: 'non-radial',
        title: 'Non Radial',
        blurb: 'Tap warm cells to toggle scale notes on/off — no radial picker.',
        preset: { mode: 'tap' },
      },
    ],
  },
  {
    id: 'note-burst',
    title: 'Note Burst',
    blurb: 'Tap to burst notes from the F minor scale with a shower of dots.',
    accent: '#8ecbff',
    audio: true,
    load: () => import('./note-burst'),
  },
  {
    id: 'tempo-slide',
    title: 'Tempo Slide',
    blurb: 'Touch to arpeggiate F3–F4; slide up/down to speed it up or slow it down.',
    accent: '#c64fff',
    audio: true,
    load: () => import('./tempo-slide'),
  },
  {
    id: 'notesketch',
    title: 'NoteSketch',
    blurb: 'Draw through notes (F3–F4) to arpeggiate them at 120 BPM; double-tap clears.',
    accent: '#cfd8ff',
    audio: true,
    load: () => import('./notesketch'),
  },
  {
    id: 'tap-color',
    title: 'Tap Color',
    blurb: 'Tap anywhere to shift the canvas through a palette.',
    accent: '#5b8cff',
    load: () => import('./tap-color'),
    variations: [
      {
        id: 'gradient',
        title: 'Gradient flip',
        blurb: 'Gradient instead of solid; each tap flips its direction.',
        preset: { fill: 'gradient', motion: 'flip' },
      },
      {
        id: 'gradient-drift',
        title: 'Gradient drift',
        blurb: 'Gradient that slowly drifts; tap changes color.',
        preset: { fill: 'gradient', motion: 'drift' },
      },
      {
        id: 'strobe',
        title: 'Strobe',
        blurb: 'Solid color flashing on and off; tap changes color.',
        preset: { strobe: true },
      },
      {
        id: 'drift-strobe',
        title: 'Drift + Strobe',
        blurb: 'Combination: a drifting gradient that also strobes.',
        preset: { fill: 'gradient', motion: 'drift', strobe: true },
      },
    ],
  },
  {
    id: 'adsr',
    title: 'ADSR',
    blurb: 'Shape an ADSR envelope by dragging handles; double-tap to fire a sine pulse through it.',
    accent: '#ff9f43',
    load: () => import('./adsr'),
  },
];

export function getExperiment(id: string | undefined): Experiment | undefined {
  if (!id) return undefined;
  return experiments.find((e) => e.id === id);
}

export function getVariation(
  id: string | undefined,
  variationId: string | undefined
): Variation | undefined {
  if (!variationId) return undefined;
  return getExperiment(id)?.variations?.find((v) => v.id === variationId);
}
