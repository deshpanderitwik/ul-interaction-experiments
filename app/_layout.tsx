import { Stack } from 'expo-router';

// Root layout: a single screen, no native header. Build out from here.
export default function Layout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
