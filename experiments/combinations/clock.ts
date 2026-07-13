import { createContext, useContext } from 'react';
import type { SharedValue } from 'react-native-reanimated';

// A single clock shared across combined experiments so they play on ONE grid.
//
// Each experiment normally drives its scheduler off its own Skia `useClock()`
// and anchors its grid at some t0. When several experiments are hosted together
// (see combinations/index.tsx) they must phase-lock, which needs two things:
//   1. the SAME time source (so `now` is identical), and
//   2. the SAME origin (so their bars line up).
// The provider hands every child the host's clock; a child that sees a shared
// clock uses it as `now` and anchors at the clock's origin (t0 = 0). With no
// provider the context is null and each experiment keeps its standalone clock —
// so this is invisible to an experiment run on its own.
export type SharedClock = SharedValue<number>;

const SharedClockContext = createContext<SharedClock | null>(null);

export const SharedClockProvider = SharedClockContext.Provider;

/** The shared clock when inside a combination, or null when standalone. */
export function useSharedClock(): SharedClock | null {
  return useContext(SharedClockContext);
}
