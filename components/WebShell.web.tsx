import { usePathname } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web';
import { unlockAudio } from '../modules/note-synth/src/NoteSynthModule.web';

// The browser shell. Two jobs:
//
// 1. Load Skia's CanvasKit (wasm) before any experiment renders — every Skia
//    <Canvas> assumes the global is present. The wasm is served next to the
//    site (scripts/export-web.mjs copies it into dist/), so no CDN dependency.
//
// 2. Desktop presentation. The sketches are composed for a phone in portrait
//    and read the window size directly (useWindowDimensions), so on a wide
//    viewport we render the site inside a phone-sized iframe of itself. The
//    iframe's window *is* the phone, so nothing inside needs to know. On
//    narrow viewports (mobile web) the app fills the screen as on iOS.
//
// Route sync: the inner app posts its path on every navigation and the outer
// page mirrors it into the address bar, so deep links and reloads land on the
// same sketch. Everything here is client-only — static export renders the
// black placeholder.

const FRAME_W = 390;
const FRAME_H = 844;
const DESKTOP_MIN_W = 768;
const ROUTE_MSG = 'ul-route';
const FRAME_PARAM = 'frame';

const BASE = (process.env.EXPO_BASE_URL ?? '').replace(/\/$/, '');

// Single-file builds (scripts/export-artifact.mjs) are served as one page at
// a path the host owns, so the app's routes can't live in the pathname —
// a reload of "/experiments/bodies" would be the host's 404. Keep them in
// the hash instead: history writes are rewritten to "#/route", and
// +not-found restores the route from the hash on load.
const SINGLE_FILE = typeof window !== 'undefined' && !!(window as any).__SINGLE_FILE;

function installHashHistory() {
  if (!SINGLE_FILE || (window as any).__hashHistoryInstalled) return;
  (window as any).__hashHistoryInstalled = true;
  const rewrite = (url: string | URL | null | undefined) => {
    if (url == null) return url;
    const u = new URL(String(url), window.location.href);
    if (u.origin !== window.location.origin) return url;
    const host = window.location.pathname;
    // The router normalises the host's own path on startup — that's not an
    // app route, so leave the URL alone rather than hashing it.
    if (u.pathname === host) return host + window.location.search + window.location.hash;
    const route = u.pathname + u.search;
    return host + window.location.search + '#' + route;
  };
  const push = window.history.pushState.bind(window.history);
  const replace = window.history.replaceState.bind(window.history);
  window.history.pushState = (data: any, unused: string, url?: string | URL | null) =>
    push(data, unused, rewrite(url) as any);
  window.history.replaceState = (data: any, unused: string, url?: string | URL | null) =>
    replace(data, unused, rewrite(url) as any);
}

/** The route a single-file build should open on (from the hash), or null. */
let lastHashRedirect: string | null = null;
export function routeFromHash(): string | null {
  if (!SINGLE_FILE) return null;
  const h = window.location.hash.slice(1);
  if (!h.startsWith('/') || h === window.location.pathname) return null;
  // A hash route that itself lands on +not-found would loop; take it once.
  if (h === lastHashRedirect) return null;
  lastHashRedirect = h;
  return h;
}


type Mode = 'pending' | 'app' | 'frame';

export function WebShell({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>('pending');

  useEffect(() => {
    installHashHistory();
    // Inside our own phone frame (?frame=1) → render the app. Any other
    // embedding (the personal site, a preview viewer) is treated like a
    // top-level window, so a wide host still gets the phone composition.
    const inOwnFrame = new URLSearchParams(window.location.search).has(FRAME_PARAM);
    const wide = window.innerWidth >= DESKTOP_MIN_W;
    setMode(!inOwnFrame && wide ? 'frame' : 'app');
  }, []);

  if (mode === 'pending') return <View style={styles.black} />;
  if (mode === 'frame') return <PhoneFrame />;
  return <SkiaGate>{children}</SkiaGate>;
}

// ---- inner app: load CanvasKit, warm audio, report route to the parent ----

function SkiaGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;
    installInlineWasm();
    LoadSkiaWeb({ locateFile: (file: string) => `${BASE}/${file}` })
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch((e: unknown) => console.error('CanvasKit failed to load', e));
    return () => {
      cancelled = true;
    };
  }, []);

  // Create the AudioContext inside the first real gesture so the browser
  // starts it running; later scheduled notes (clock ticks) then just play.
  useEffect(() => {
    const warm = () => unlockAudio();
    window.addEventListener('pointerdown', warm, { once: true, capture: true });
    window.addEventListener('touchstart', warm, { once: true, capture: true, passive: true });
    return () => {
      window.removeEventListener('pointerdown', warm, { capture: true } as any);
      window.removeEventListener('touchstart', warm, { capture: true } as any);
    };
  }, []);

  useEffect(() => {
    if (window.self === window.top) return;
    window.parent.postMessage({ type: ROUTE_MSG, href: `${BASE}${pathname}` }, '*');
  }, [pathname]);

  if (!ready) return <View style={styles.black} />;
  return <>{children}</>;
}

// ---- outer page on desktop: a phone-sized iframe of the same URL ----

function PhoneFrame() {
  const [size, setSize] = useState(() => frameSize());
  const [src] = useState(() => {
    const u = new URL(window.location.href);
    u.searchParams.set(FRAME_PARAM, '1');
    return u.pathname + u.search + u.hash;
  });

  useEffect(() => {
    const onResize = () => setSize(frameSize());
    window.addEventListener('resize', onResize);
    const onMessage = (e: MessageEvent) => {
      const d = e.data;
      if (!d || d.type !== ROUTE_MSG || typeof d.href !== 'string') return;
      if (d.href !== window.location.pathname) window.history.replaceState(null, '', d.href);
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('message', onMessage);
    };
  }, []);

  return (
    <View style={styles.stage}>
      <View style={[styles.frame, { width: size.w, height: size.h }]}>
        <iframe
          title="Experiment"
          src={src}
          allow="autoplay; microphone"
          style={{ border: 0, width: size.w, height: size.h, background: '#000', display: 'block' }}
        />
      </View>
    </View>
  );
}

// Single-file builds (scripts/export-artifact.mjs) carry the CanvasKit wasm
// inline as base64 on window.__CANVASKIT_WASM_B64, for hosts that can't
// serve a second file. The loader fetches "<base>/canvaskit.wasm"; answer
// that one request from memory and leave every other fetch alone.
function installInlineWasm() {
  const b64 = (window as any).__CANVASKIT_WASM_B64 as string | undefined;
  if (!b64 || (window as any).__inlineWasmInstalled) return;
  (window as any).__inlineWasmInstalled = true;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  (window as any).__CANVASKIT_WASM_B64 = undefined;
  const realFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith('canvaskit.wasm')) {
      return Promise.resolve(
        new Response(bytes, { status: 200, headers: { 'Content-Type': 'application/wasm' } })
      );
    }
    return realFetch(input as any, init);
  }) as typeof window.fetch;
}

function frameSize() {
  const margin = 48;
  const h = Math.max(480, Math.min(FRAME_H, window.innerHeight - margin));
  // Keep the phone's aspect when the viewport is short.
  const w = Math.min(FRAME_W, Math.round((h * FRAME_W) / FRAME_H));
  return { w, h };
}

const styles = StyleSheet.create({
  black: { flex: 1, backgroundColor: '#000' },
  stage: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  frame: {
    borderRadius: 32,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: '#000',
  },
});
