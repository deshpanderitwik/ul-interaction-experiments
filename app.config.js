// Dynamic Expo config so this one repo can ship more than one native app.
//
// Which app to build/run/publish is chosen with the APP env var:
//
//     (unset)    -> "ulsketches"  — the original sketchbook (uses app.json as-is)
//     APP=hello  -> "hello"       — a clean, empty hello-world starter
//
// Each app is its OWN native binary (its own bundle id) and its OWN EAS project
// (its own projectId / OTA update stream / channels). The original app's config
// lives untouched in app.json and is returned here verbatim, so nothing about
// the sketchbook changes — all of the new behavior is gated behind APP=hello.
//
// Why this shape: Expo reads app.json first and passes the normalized result in
// as `config`. Returning it unchanged is a guaranteed no-op. A returned object
// with a top-level `expo` key is used as-is, so the hello branch is fully
// self-contained.

const APP = process.env.APP ?? 'ulsketches';

// --- hello: a fresh, empty starter app -------------------------------------
// One-time, run it yourself (needs your Expo login):
//
//     APP=hello eas init        # creates the EAS project, prints a projectId
//
// then paste that id below. Until it's set, `expo start` works for local
// preview, but `eas build` / `eas update` need it (they associate the build
// with an EAS project and an OTA update stream).
const HELLO_EAS_PROJECT_ID = 'e5405cda-2bb9-49cb-8cff-b9d9c4ef97c7';

function helloConfig() {
  const hasProject = HELLO_EAS_PROJECT_ID.length > 0;

  return {
    name: 'hello',
    slug: 'hello',
    version: '1.0.0',
    scheme: 'hello',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'dark',
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.ritdeshpande.hello',
      config: { usesNonExemptEncryption: false },
      // Autolinking pulls every native module in package.json into the binary
      // (e.g. react-native-vision-camera), so Apple requires purpose strings
      // even though hello's JS never touches the camera/mic. Mirrors the
      // sketchbook's app.json infoPlist; without these, App Store Connect
      // rejects the upload with ITMS-90683.
      infoPlist: {
        NSCameraUsageDescription:
          'This app needs camera access for camera-based sketches.',
        NSMicrophoneUsageDescription:
          'This app needs microphone access for camera-based sketches.',
      },
    },
    android: {
      package: 'com.ritdeshpande.hello',
    },
    // This app renders its routes from app-hello/ instead of the sketchbook's
    // app/. Scoping the custom root to the hello app (the sketchbook keeps the
    // default app/) keeps any router-root caveats off the working app.
    plugins: [
      ['expo-router', { root: 'app-hello' }],
      ...(hasProject ? ['expo-updates'] : []),
    ],
    runtimeVersion: { policy: 'appVersion' },
    owner: 'ritwikdesh',
    // OTA wiring only once the project exists, so a not-yet-initialized hello
    // app still produces a valid config for `expo start`.
    ...(hasProject
      ? {
          updates: { url: `https://u.expo.dev/${HELLO_EAS_PROJECT_ID}` },
          extra: { eas: { projectId: HELLO_EAS_PROJECT_ID } },
        }
      : {}),
  };
}

module.exports = ({ config }) => {
  // `config` is the original sketchbook config read from app.json.
  if (APP === 'hello') return { expo: helloConfig() };
  return config; // ulsketches — unchanged
};
