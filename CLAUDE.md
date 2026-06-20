# Working in this repo (read me first)

A native iOS sketchbook: a one-time native shell, plus pure-JS "sketches" that
ship over-the-air via `eas update`. See `README.md` for the full architecture
and the authoring loop. This file is about **how multiple agents/threads work
on this app at once without clobbering each other.**

## The two shared resources to respect

Most things here are safely isolated per branch. Two are **not**, and they are
where parallel work collides:

1. **The OTA channel + runtime** (`preview` channel @ `runtimeVersion 1.0.0`) —
   device-facing. EAS Update serves **only the latest publish per channel** to
   every install. If two threads both `eas update --channel preview`, the last
   one wins and silently replaces what everyone's phone pulls — including work
   from a branch that doesn't contain yours. This has already happened once.
2. **Hand-edited shared files** — `sketches/registry.ts`, `sketches/types.ts`,
   `app/index.tsx`. Everyone edits `registry.ts` to add a sketch, so these are
   merge-conflict hotspots when branches land on `main`.

## Rules for parallel work

### Git
- **Branch from the latest `main`.** One branch per thread/workstream.
- **Never push to another thread's branch**, and never force-push shared refs.
- **Rebase/merge `main` into your branch often** so conflicts stay small.
- Keep edits to the shared files (`registry.ts`, `types.ts`, `app/index.tsx`)
  **small and additive** — append your entry, don't reorder or reformat the
  whole file.

### OTA publishing — `preview` is for `main` only
- **Do NOT run `eas update --channel preview` from a feature branch.** That
  channel is reserved for integrated work. Publishing from a feature branch
  overwrites every device for every thread.
- The flow to get your work on the device is: **merge to `main`, then publish
  to `preview` from `main`.** Whoever publishes from `main` is publishing the
  integrated app, not just their slice.
- The publish command itself (headless iOS, from `main`) is:
  ```bash
  eas update --channel preview --environment preview --platform ios \
    --non-interactive -m "<what changed>"
  ```
- Auth is non-interactive via `EXPO_TOKEN`. Project is already linked
  (`extra.eas.projectId` + `updates.url` in `app.json`).

### Need to preview your own branch on a device before merging?
That requires isolation we haven't set up yet. Two future options (pick later):
- **Dev client + per-branch updates:** one `eas build --profile development`,
  then each branch publishes with `eas update --branch <git-branch>` and you
  choose which to open from the dev launcher. True isolated parallel previews.
- Until then, preview on device = merge to `main` and publish from `main`.

## Known sharp edges / good next cleanups
- `sketches/registry.ts` is still hand-maintained, so it stays a conflict
  hotspot. A good future fix is auto-registering sketches via Metro's
  `require.context` so adding a sketch never edits a shared file. (Not done
  yet — discussed and deferred.)
- All builds share `runtimeVersion 1.0.0`; only a native rebuild changes it.
  An OTA update only reaches installs on the matching runtime.

## Quick orientation
- `app/` — expo-router screens. `index.tsx` lists sketches (supports one level
  of nesting via `Sketch.parentId`); `sketch/[id].tsx` renders one full-screen.
- `sketches/` — one file per experiment, default-exporting a `Sketch`,
  registered in `registry.ts`.
- `studies/` — work-in-progress explorations (e.g. explosion treatments) that a
  harness sketch flips between; fold a winner back into its parent sketch.
- `modules/fine-haptics/` — local Swift native module (changing it needs a
  native rebuild; using it from JS does not).
