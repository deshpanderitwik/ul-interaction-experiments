import type { SharedValue } from 'react-native-reanimated';

/**
 * Shared scaffolding for the explosion studies. Each study is a "burst
 * renderer": given a pool slot it draws one impact in its own style. The
 * harness (sketches/ExplosionStudies.tsx) owns the physics + the pool and
 * lets you flip between renderers to compare them on the same hit.
 */
export type Wave = {
  x: number; // contact point
  y: number;
  born: number; // clock ms at spawn (-1 = inactive)
  nx: number; // inward wall normal (spray direction)
  ny: number;
  speed: number; // impact speed (px/s)
  seed: number; // per-burst randomness
};

export type BurstProps = {
  index: number;
  waves: SharedValue<Wave[]>;
  clock: SharedValue<number>;
};

export const POOL = 7; // concurrent bursts
export const LIFE = 720; // ms a burst lives

export const RAINBOW = [
  '#ff004c',
  '#ff7a00',
  '#ffe000',
  '#39ff14',
  '#00e5ff',
  '#3b5bff',
  '#b14bff',
  '#ff004c', // repeat first so a sweep wraps seamlessly
];

export function makeWaves(): Wave[] {
  return Array.from({ length: POOL }, () => ({
    x: 0,
    y: 0,
    born: -1,
    nx: 0,
    ny: 0,
    speed: 0,
    seed: 0,
  }));
}
