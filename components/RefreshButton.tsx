import * as Updates from 'expo-updates';
import { useUpdates } from 'expo-updates';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text } from 'react-native';

// A top-level "update ready" affordance. It appears only when a JS (OTA) update
// is available or already downloaded. Tapping ensures the update is downloaded
// and prompts a reopen to apply it.
//
// NOTE: we deliberately do NOT call Updates.reloadAsync() here — on this build
// the in-app reload crashes natively (the whole app process dies), which a JS
// try/catch can't prevent. Applying on the next natural launch is crash-free.
// True one-tap apply needs a native fix shipped via a TestFlight rebuild.
//
// expo-updates' APIs are disabled in dev, so this no-ops (and hides) there.
export function RefreshButton() {
  const { isUpdateAvailable, isUpdatePending, isDownloading } = useUpdates();
  const [busy, setBusy] = useState(false);

  // Check once on mount so the button can surface updates published while the
  // app was already open (the automatic check only runs on launch).
  useEffect(() => {
    if (!Updates.isEnabled) return;
    Updates.checkForUpdateAsync().catch(() => {});
  }, []);

  if (!Updates.isEnabled || (!isUpdateAvailable && !isUpdatePending)) return null;

  const onPress = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // Ensure the update is downloaded (no-op if already pending), then prompt
      // a reopen. We never call reloadAsync() — it crashes natively here.
      if (!isUpdatePending) await Updates.fetchUpdateAsync();
      Alert.alert(
        'Update ready',
        'Fully close and reopen the app to apply the latest update.'
      );
    } catch (e) {
      Alert.alert('Update check failed', String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const working = busy || isDownloading;
  return (
    <Pressable
      onPress={onPress}
      disabled={working}
      accessibilityRole="button"
      accessibilityLabel="Refresh to apply the available update"
      style={styles.button}
    >
      {working ? (
        <ActivityIndicator color="#fff" size="small" />
      ) : (
        <Text style={styles.label}>↻ Update</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 86,
    paddingHorizontal: 14,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#5b8cff',
  },
  label: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
