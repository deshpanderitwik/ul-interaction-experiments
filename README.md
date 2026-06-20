# ul-interaction-experiments

A native iOS/Android sketchbook for mobile interaction-design experiments. The
**native shell is built once** with a generous set of capabilities; each
experiment ("sketch") is **pure JS** that ships **over-the-air** via `eas update`
— so most iteration needs no rebuild and no cable.

## Architecture

- **Bare RN via Expo (CNG).** No `ios/`/`android/` folders committed — the native
  projects are generated in the cloud at build time. Keeps the repo clean while
  staying fully native.
- **`app/`** — [expo-router](https://docs.expo.dev/router/introduction/) screens.
  `index.tsx` lists sketches; `sketch/[id].tsx` renders one full-screen.
- **`sketches/`** — one file per experiment. Each default-exports a `Sketch`
  (`id`, `title`, `description`, `Component`). Register it in `registry.ts`.
  Pure JS → ships over-the-air.
- **`modules/fine-haptics/`** — a **local Swift native module** (CoreHaptics,
  continuous intensity × sharpness). This is the native↔JS seam: write Swift
  once, drive it from any sketch. Adding/changing Swift needs a native rebuild;
  using it from JS does not.

### The native/JS line *is* the OTA line
- **Touch JS** (new sketch, tweak, compose existing native primitives) → `eas update`, instant, no rebuild.
- **Touch Swift** (new native capability) → `eas build` + reinstall via TestFlight, then it's available to JS forever.

The strategy: front-load native capabilities, then live in the JS layer.

## What's pre-bundled (use freely from JS, no rebuild)
react-native-reanimated · react-native-gesture-handler · @shopify/react-native-skia ·
expo-haptics · expo-sensors · expo-router · plus the local `fine-haptics` Swift module.

---

## First-time setup (the interactive bits — run these yourself)

These need logins / 2FA that only you can enter. EAS automates all the
certificate & provisioning-profile work behind them.

```bash
# 0. Commit the scaffold (EAS builds from git)
git add -A && git commit -m "Scaffold sketchbook"

# 1. Log into your Expo account
eas login

# 2. Create the EAS project (writes projectId into app.json)
eas init

# 3. Wire over-the-air updates (adds updates.url + runtimeVersion)
eas update:configure

# 4. Build for TestFlight in the cloud. EAS will prompt to log into your
#    Apple Developer account (Apple ID + 2FA) and auto-create the bundle id,
#    distribution cert, and provisioning profile. --auto-submit uploads it
#    straight to App Store Connect / TestFlight when the build finishes.
eas build --platform ios --profile preview --auto-submit
```

Then on your phone: open **TestFlight** → install. No cable, ever.

> First submit also creates the App Store Connect app record (eas submit will
> offer to do this). You may get a one-time export-compliance question — answer
> "no encryption" for a sketchbook.

## The on-the-go loop (from Claude Code mobile)

```bash
# JS-only change (a new sketch, a tweak) — ships in seconds:
eas update --channel preview -m "new sketch: <name>"
#   → reopen the app on your phone; it pulls the update on launch.

# New/changed Swift (a native capability) — rebuild + reinstall via TestFlight:
eas build --platform ios --profile preview --auto-submit
```

## Build profiles (`eas.json`)
- **development** — dev client, internal distribution (live Metro reload; optional).
- **preview** — Release build on the `preview` channel, distributed via TestFlight. **Your main install.**
- **production** — Release build on the `production` channel.

## Adding a sketch
1. Create `sketches/MySketch.tsx`, default-export a `Sketch`.
2. Add it to the array in `sketches/registry.ts`.
3. `eas update --channel preview -m "..."` → it appears on your phone.
