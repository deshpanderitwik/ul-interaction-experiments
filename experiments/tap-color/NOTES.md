# Tap Color — exploration log

Base mechanic: tap to advance a shared palette (`shared.ts`). Behavior is
config-driven (`TapColorConfig` in `index.tsx`) along three orthogonal axes —
`fill` (solid | gradient), `motion` (none | flip | drift), `strobe` (bool).
Each variation below is just a **preset** in `registry.ts`, so combinations are
free (set more fields). `load` remains available for a variation that's a
genuinely different idea rather than the base with knobs.

## Fold ritual
When a variation feels dialed: make its preset the base default, delete the
registry entry, and append a dated line under **Folded** with what won and why.

## Variations (live)
- **Gradient flip** — `{ fill: gradient, motion: flip }` — tap flips direction
- **Gradient drift** — `{ fill: gradient, motion: drift }` — axis auto-rotates (~9s)
- **Strobe** — `{ strobe: true }` — black overlay square-waves (~2.9 Hz)
- **Drift + Strobe** — `{ fill: gradient, motion: drift, strobe: true }` — combination

## Folded
- (none yet)

## Notes
- Strobe rate kept just under ~3 flashes/sec (photosensitivity); dial via
  `duration` in `index.tsx`.
- 2026-06-23: refactored three separate variation files into one parameterized
  base; variations are now presets. Old files remain in git history.
