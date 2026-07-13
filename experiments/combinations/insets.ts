import { createContext, useContext } from 'react';

// How much space the combination host reserves at the bottom of the screen for
// its nav selector. A hosted experiment reads this and lifts its bottom-anchored
// UI (and shrinks its playfield) by that much, so nothing sits under the nav —
// and so the empty lower area you long-press in isn't the nav's tap target.
// Zero with no provider, so a standalone experiment is unaffected.
const HostBottomInsetContext = createContext(0);

export const HostBottomInsetProvider = HostBottomInsetContext.Provider;

export function useHostBottomInset(): number {
  return useContext(HostBottomInsetContext);
}
