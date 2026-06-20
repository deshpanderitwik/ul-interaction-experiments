import type { ComponentType } from 'react';

/**
 * A Sketch is one self-contained interaction experiment.
 * Drop a new file in sketches/, default-export a Sketch, and register it
 * in registry.ts — that's the whole authoring loop. Pure JS, so new sketches
 * ship over-the-air via `eas update` without a native rebuild.
 */
export type Sketch = {
  /** stable url-safe id, used as the route param */
  id: string;
  title: string;
  /** one-liner shown on the home list */
  description: string;
  /**
   * if set, this sketch is a child of the sketch with this id — it renders
   * indented under its parent on the home list. One level deep.
   */
  parentId?: string;
  /** the experiment itself, rendered full-screen */
  Component: ComponentType;
};
