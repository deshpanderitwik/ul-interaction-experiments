# ul-interaction-experiments-v2

A native iOS/Android app for mobile interaction-design experiments, built on a
**build-once native shell** plus **pure-JS screens that ship over-the-air** via
`eas update`. Most iteration needs no rebuild and no cable — you edit JS, publish,
and reopen the app.

This is a **clean starting point**. The original sketchbook (App 1) was archived;
see [Archived: the original sketchbook](#archived-the-original-sketchbook).

## Architecture

- **Bare RN via Expo (CNG).** No `ios/`/`android/` folders in git — the native
  projects are generated in the cloud at build time.
- **`app/`** — [expo-router](https://docs.expo.dev/router/introduction/) screens.
  `index.tsx` is the (currently blank) home screen; add routes as files here.
- **`modules/fine-haptics/`** — a local Swift native module (CoreHaptics) kept as
  the native↔JS seam example: write Swift once, drive it from JS. Changing Swift
  needs a native rebuild; using it from JS does not.
- **The native/JS line is the OTA line.** Touch **JS** → `eas update`, live in
  seconds. Touch **native** (Swift, a new native dep, Info.plist, the app
  version) → `eas build` + reinstall via TestFlight.

## App identity (don't change these — installs + OTA are pinned to them)

| | |
|---|---|
| EAS project | `@ritwikdesh/hello` · projectId `e5405cda-2bb9-49cb-8cff-b9d9c4ef97c7` |
| iOS bundle id | `com.ritdeshpande.hello` |
| App Store Connect app | `6782713709` |
| OTA channel | `preview` |
| runtimeVersion | `1.4.0` (explicitly pinned in `app.json`; bump on every native change) |

The home-screen **display name** is `ul-interaction-experiments-v2`; the `hello`
slug/bundle are internal plumbing kept for continuity (renaming them would orphan
the installed app + its OTA stream).

## The iteration loop (headless, from Claude Code mobile/web)

Auth is non-interactive via the `EXPO_TOKEN` env var. iOS-only for now.

```bash
# JS-only change — ships in seconds:
eas update --channel preview --environment preview --platform ios \
  --non-interactive -m "what changed"
#   → reopen the app on your phone; expo-updates downloads on one launch and
#     applies on the next, so quit/reopen twice to see it.

# Native change (Swift, new native dep, Info.plist, version bump) — rebuild:
eas build --platform ios --profile preview
```

> The `preview` channel is shared by every install and the latest publish wins,
> so it's **published from `main`** — merge, then publish. See `CLAUDE.md`.

> `--platform ios` is required (no `react-native-web` here); `--environment
> preview` + `--non-interactive` are required in headless mode.

## Build profiles (`eas.json`)
- **development** — dev client, internal distribution (live Metro reload; optional).
- **preview** — Release build on the `preview` channel, distributed via TestFlight. **Your main install.**
- **production** — Release build on the `production` channel.

## Headless builds/submits with an App Store Connect API key (no Apple login)

For CI / agent sessions where you can't do an interactive Apple ID + 2FA login,
authenticate to Apple with an **App Store Connect API key** (`.p8` on disk):

```bash
export EXPO_TOKEN=...                 # Expo auth
export EXPO_ASC_KEY_ID=...            # ASC API key id
export EXPO_ASC_ISSUER_ID=...         # ASC issuer id
export EXPO_ASC_API_KEY_PATH=/path/to/AuthKey_XXXX.p8
export EXPO_APPLE_TEAM_ID=443MNYHZG2
export EXPO_APPLE_TEAM_TYPE=COMPANY_OR_ORGANIZATION
```

With `EXPO_ASC_*` set, `eas build` authenticates to Apple via the key (no 2FA
prompt). iOS credentials (distribution cert + provisioning profile) are already
set up for this app, so builds run `--non-interactive`.

> **First build for a *brand-new* app needs a TTY (once).** `eas build
> --non-interactive` can *use* credentials but can't bootstrap a new bundle id's
> distribution cert / provisioning profile — run the first build interactively
> (in a pseudo-TTY) and accept the `Reuse this distribution certificate?` /
> `Generate a new Apple Provisioning Profile?` confirms. This app is already past
> that step.

### TestFlight submit (headless)
Apple's ASC API key can *upload* a build but **cannot create the App Store
Connect app record** — create it once in the ASC web UI (Apps → ✛ → New App,
pick the `com.ritdeshpande.hello` bundle). Then, unlike `eas build`, `eas submit`
does **not** read `EXPO_ASC_*` env vars — pass the key through the submit profile:

```bash
# Temporarily add to submit.preview.ios in eas.json (keep the .p8 path out of git):
#   "ascApiKeyPath": "/path/to/AuthKey_XXXX.p8",
#   "ascApiKeyId": "...", "ascApiKeyIssuerId": "..."
eas submit --platform ios --profile preview --id <buildId> --non-interactive
```

`submit.preview.ios.ascAppId` is `6782713709` (this app). After processing, the
build appears under TestFlight for the account holder to install.

## Archived: the original sketchbook

The original app — **ulsketches** (`ul-interaction-experiments`, bundle
`com.ritdeshpande.ulsketches`, projectId `7a3a2223…`) and its full sketchbook
engine (`app/` routes, `sketches/`, `studies/`, `components/`, the multi-app
`app.config.js`) — was archived when this repo was re-centered on App 2. It's
fully preserved on the **`archive/ulsketches`** branch:

```bash
git checkout archive/ulsketches   # browse / restore the original sketchbook
```

That app's EAS project, channels, and TestFlight remain on Expo's side untouched;
this repo simply no longer builds or publishes to it.
