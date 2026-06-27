import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Toaster } from '../components/Toast';

// Root layout: a single screen, no native header. Wrapped in
// GestureHandlerRootView so experiments can use react-native-gesture-handler
// (e.g. NoteSketch's draw/clear gestures). Toaster overlays every screen.
export default function Layout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }} />
      <Toaster />
    </GestureHandlerRootView>
  );
}
