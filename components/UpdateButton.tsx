import * as Updates from 'expo-updates';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

type Status = 'idle' | 'checking' | 'downloading' | 'current' | 'error';

/**
 * Pulls the latest over-the-air bundle on demand, so you don't have to kill
 * and relaunch the app to pick up an `eas update`. Lives in the header.
 *
 * Only does real work in release builds (preview/production). In a dev/Metro
 * session Updates.isEnabled is false — Fast Refresh already covers you — so the
 * button just reports "up to date" instead of erroring.
 */
export default function UpdateButton() {
  const [status, setStatus] = useState<Status>('idle');
  const resetSoon = () => setTimeout(() => setStatus('idle'), 1500);

  const onPress = async () => {
    if (!Updates.isEnabled) {
      setStatus('current');
      resetSoon();
      return;
    }
    try {
      setStatus('checking');
      const check = await Updates.checkForUpdateAsync();
      if (!check.isAvailable) {
        setStatus('current');
        resetSoon();
        return;
      }
      setStatus('downloading');
      await Updates.fetchUpdateAsync();
      await Updates.reloadAsync(); // relaunches the JS with the new bundle
    } catch {
      setStatus('error');
      resetSoon();
    }
  };

  const busy = status === 'checking' || status === 'downloading';

  return (
    <Pressable onPress={onPress} disabled={busy} hitSlop={12} style={styles.btn}>
      {busy ? (
        <ActivityIndicator size="small" color="#00d2a8" />
      ) : (
        <Text style={styles.label}>{labelFor(status)}</Text>
      )}
    </Pressable>
  );
}

function labelFor(status: Status): string {
  switch (status) {
    case 'current':
      return 'Up to date';
    case 'error':
      return 'Failed — retry';
    default:
      return '↻ Refresh';
  }
}

const styles = StyleSheet.create({
  btn: { paddingHorizontal: 8, paddingVertical: 4 },
  label: { color: '#00d2a8', fontSize: 15, fontWeight: '600' },
});
