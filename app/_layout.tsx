import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    // Dark root so the window background never shows through white for a frame
    // during push transitions (which is what makes header buttons flash white
    // on arrival). Paired with contentStyle below for the screen surface.
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#0b0b0f' }}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#0b0b0f' },
          headerTintColor: '#fff',
          contentStyle: { backgroundColor: '#0b0b0f' },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Sketches' }} />
        <Stack.Screen name="sketch/[id]" options={{ title: '' }} />
      </Stack>
    </GestureHandlerRootView>
  );
}
