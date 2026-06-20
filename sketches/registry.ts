import type { Sketch } from './types';

/**
 * Auto-registered catalog. Every `*.tsx` in this folder that default-exports a
 * Sketch is picked up automatically via Metro's `require.context` (the same
 * mechanism expo-router uses) — so **adding a sketch is just dropping a file
 * here**, with no edit to this shared file. That keeps parallel threads from
 * colliding on a hand-maintained list.
 *
 * Ordering lives on each sketch via `order` (higher = newer); nesting via
 * `parentId`. `types.ts` / `registry.ts` are `.ts`, so they're never matched.
 */
const ctx = require.context('./', false, /\.tsx$/);

export const sketches: Sketch[] = ctx
  .keys()
  .map((key) => {
    try {
      return ctx<{ default?: Sketch }>(key).default;
    } catch (e) {
      console.warn(`Failed to load sketch ${key}:`, e);
      return undefined;
    }
  })
  .filter((s): s is Sketch => !!s && !!s.id && !!s.Component)
  .sort((a, b) => (b.order ?? 0) - (a.order ?? 0) || a.title.localeCompare(b.title));

export const getSketch = (id: string): Sketch | undefined =>
  sketches.find((s) => s.id === id);
