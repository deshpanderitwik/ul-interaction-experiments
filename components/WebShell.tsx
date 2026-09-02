import type { ReactNode } from 'react';

// Native: the web shell is a passthrough. See WebShell.web.tsx for the
// browser build (Skia/CanvasKit loader + desktop phone frame).
export function WebShell({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

/** Web-only concept; no hash routes on native. */
export function routeFromHash(): string | null {
  return null;
}
