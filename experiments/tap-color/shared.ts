// Shared building blocks for the Tap Color experiment and its variations.
// Keeping these here is what lets a variation "build off the main body"
// (and makes folding a variation back into the base a tidy edit).
export const PALETTE = [
  '#000000',
  '#11162e',
  '#2a1140',
  '#451126',
  '#0f4030',
  '#5b8cff',
];

export const next = (i: number) => (i + 1) % PALETTE.length;
