import { Stack } from 'expo-router';

// The hello app's root layout: a single screen, no native header.
export default function Layout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
