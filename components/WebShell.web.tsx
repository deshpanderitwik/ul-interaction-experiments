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

const BASE = (process.env.EXPO_BASE_URL ?? '').replace(/\/$/, '');

type Mode = 'pending' | 'app' | 'frame';

export function WebShell({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>('pending');

  useEffect(() => {
    const embedded = window.self !== window.top;
    const wide = window.innerWidth >= DESKTOP_MIN_W;
    setMode(!embedded && wide ? 'frame' : 'app');
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
  const [src] = useState(() => window.location.pathname + window.location.search + window.location.hash);

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
