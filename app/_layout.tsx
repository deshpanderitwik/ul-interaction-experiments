import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

// Root layout: a single screen, no native header. Wrapped in
// GestureHandlerRootView so experiments can use react-native-gesture-handler
// (e.g. NoteSketch's draw/clear gestures). Build out from here.
export default function Layout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }} />
    </GestureHandlerRootView>
  );
}
