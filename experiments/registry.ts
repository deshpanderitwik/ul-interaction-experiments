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
  /** Lazy import of the experiment's screen (default export). */
  load: Load;
  /** Optional sub-experiments shown indented under this one. */
  variations?: Variation[];
};

export const experiments: Experiment[] = [
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
