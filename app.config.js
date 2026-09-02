// Layered on top of app.json (which stays the source of truth for the app's
// identity — see README "App identity"). This only adds the web target:
//
//   WEB_BASE_URL  the path the site is served under. GitHub Pages serves the
//                 repo at /ul-interaction-experiments; local dev uses "".
//   WEB_OUTPUT    "static" (default: one HTML per route, for Pages) or
//                 "single" (one index.html, for single-file previews).
//
// Nothing here touches the native build or the OTA runtime.
module.exports = ({ config }) => ({
  ...config,
  web: {
    bundler: 'metro',
    output: process.env.WEB_OUTPUT === 'single' ? 'single' : 'static',
    favicon: './assets/favicon.png',
  },
  experiments: {
    ...(config.experiments ?? {}),
    baseUrl: process.env.WEB_BASE_URL ?? '',
  },
});
