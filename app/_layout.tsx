import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Toaster } from '../components/Toast';
import { WebShell } from '../components/WebShell';

// Root layout: a single screen, no native header. Wrapped in
// GestureHandlerRootView so experiments can use react-native-gesture-handler
// (e.g. NoteSketch's draw/clear gestures). Toaster overlays every screen.
// WebShell is a passthrough on native; in the browser it loads CanvasKit and
// frames the app phone-sized on desktop (see components/WebShell.web.tsx).
export default function Layout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <WebShell>
        <Stack screenOptions={{ headerShown: false }} />
        <Toaster />
      </WebShell>
    </GestureHandlerRootView>
  );
}
