import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    // Dark root so the window background never shows through white for a frame
    // during push transitions. The native stack header is disabled app-wide: on
    // iOS 26 its buttons get wrapped in Liquid Glass whose bright entrance
    // "bloom" flashes in on every arrival, and there's no per-button opt-out.
    // Each screen renders its own header with JS-drawn glass buttons (see
    // components/GlassButton.tsx, app/index.tsx, app/sketch/[id].tsx).
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#0b0b0f' }}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#0b0b0f' },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="sketch/[id]" />
      </Stack>
    </GestureHandlerRootView>
  );
}
