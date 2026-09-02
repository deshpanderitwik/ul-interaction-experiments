import { Link, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { routeFromHash } from '../components/WebShell';

// Unknown route. On the web this also catches a host that serves the app
// under a path expo-router doesn't know (a preview viewer, a proxy): send it
// home instead of showing a dead end.
export default function NotFound() {
  const router = useRouter();
  useEffect(() => {
    if (Platform.OS === 'web') router.replace((routeFromHash() ?? '/') as any);
  }, [router]);
  return (
    <View style={styles.fill}>
      <Link href="/" style={styles.link}>
        ‹ Experiments
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  link: { color: '#888', fontSize: 15 },
});
