# Working in this repo (read me first)

A single native app — **ul-interaction-experiments-v2**: a build-once native
shell plus pure-JS screens that ship over-the-air via `eas update`. See
`README.md` for architecture, identity, and the build/submit/OTA commands. This
file is about **not clobbering the one shared, device-facing resource** when
multiple agents/threads work at once.

## The one shared resource to respect

Almost everything here is safely isolated per branch. The exception is the
**OTA channel + runtime** (`preview` channel @ `runtimeVersion 1.4.0`). EAS
Update serves **only the latest publish per channel** to every install. If two
threads both `eas update --channel preview`, the last one wins and silently
replaces what everyone's phone pulls — including work from a branch that doesn't
contain yours.

## Rules for parallel work

### Git
- **Branch from the latest `main`.** One branch per thread/workstream.
- **Never push to another thread's branch**, and never force-push shared refs.
- **Rebase/merge `main` into your branch often** so conflicts stay small.

### OTA publishing — `preview` is for `main` only
- **Do NOT run `eas update --channel preview` from a feature branch.** That
  channel is device-facing and reserved for integrated work; publishing from a
  feature branch overwrites every install.
- The flow to get your work on the device: **merge to `main`, then publish to
  `preview` from `main`.**
- The publish command (headless iOS):
  ```bash
  eas update --channel preview --environment preview --platform ios \
    --non-interactive -m "<what changed>"
  ```
- Auth is non-interactive via `EXPO_TOKEN`. The project is already linked
  (`extra.eas.projectId` + `updates.url` in `app.json`).

## Native vs JS (what needs a rebuild)
- **JS-only** (screens in `app/`, logic, styling) → `eas update`, live in
  seconds, no rebuild.
- **Native** (Swift in `modules/`, a new native dependency, `ios.infoPlist`, the
  app `version`) → `eas build` + reinstall via TestFlight. An OTA update only
  reaches installs on the **matching `runtimeVersion`** (`1.4.0`), so bumping the
  version strands existing installs until they reinstall the new build.

## Identity that must not change
`projectId e5405cda…`, bundle `com.ritdeshpande.hello`, slug `hello`,
`runtimeVersion 1.4.0`, channel `preview`. These pin the installed app and its
OTA stream — changing any of them orphans every existing install. The
user-facing display name (`ul-interaction-experiments-v2`) is separate and safe
to change (it's baked in at build time).

## The web target
`expo export --platform web` builds the same sketches for the browser; the
`Web` GitHub Actions workflow publishes `dist/` to GitHub Pages from `main`
(or on demand from a branch). It is JS-only and independent of the OTA
channel and `runtimeVersion` — publishing the web build touches no phone. The
web home menu shows only routes listed in `experiments/web.ts` (`WEB_READY`);
vet a sketch in a desktop browser and on a phone, then add its key. See
README → "The web target".

## Archived
The original sketchbook app (**ulsketches**) and its engine were archived on the
**`archive/ulsketches`** branch (`git checkout archive/ulsketches`). This repo no
longer builds or publishes to it.
