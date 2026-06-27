import * as Updates from 'expo-updates';
import { useUpdates } from 'expo-updates';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text } from 'react-native';

// A top-level "apply update" affordance. It appears only when a JS (OTA) update
// is available or already downloaded. Tapping fetches it (if needed) and reloads
// the JS runtime to apply — a quick in-app relaunch, no quit/reopen. Native
// updates aren't covered here; those still ship via a TestFlight build.
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
      // Make sure there's genuinely a new update before relaunching: if it isn't
      // already downloaded, fetch it and only proceed when it's actually new.
      let pending = isUpdatePending;
      if (!pending) {
        const res = await Updates.fetchUpdateAsync();
        pending = res.isNew;
      }
      if (pending) {
        await Updates.reloadAsync(); // applies the update via a quick relaunch
      } else {
        setBusy(false); // nothing new to apply
      }
    } catch (e) {
      // Surface the real reason instead of failing silently/hard.
      setBusy(false);
      Alert.alert('Update failed', String((e as Error)?.message ?? e));
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
