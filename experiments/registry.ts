import type { ComponentType } from 'react';

// The single source of truth for what experiments exist.
// Add an experiment = drop a file in experiments/ and add one entry here.
// Both the Home menu and the dynamic route read from this list, so they
// can never drift out of sync.
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
  load: () => Promise<{ default: ComponentType }>;
};

export const experiments: Experiment[] = [
  {
    id: 'tap-color',
    title: 'Tap Color',
    blurb: 'Tap anywhere to shift the canvas through a palette.',
    accent: '#5b8cff',
    load: () => import('./tap-color'),
  },
];

export function getExperiment(id: string | undefined): Experiment | undefined {
  if (!id) return undefined;
  return experiments.find((e) => e.id === id);
}
