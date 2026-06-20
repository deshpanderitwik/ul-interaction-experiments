import type { Sketch } from './types';
import DraggableSpring from './DraggableSpring';
import HapticGrid from './HapticGrid';
import HapticPad from './HapticPad';
import TapRipple from './TapRipple';

/**
 * The catalog. Add a sketch here and it shows up on the home screen and gets
 * a route automatically. Keep newest-first so fresh experiments are on top.
 */
export const sketches: Sketch[] = [TapRipple, HapticPad, HapticGrid, DraggableSpring];

export const getSketch = (id: string): Sketch | undefined =>
  sketches.find((s) => s.id === id);
