import * as Updates from 'expo-updates';
import { useUpdates } from 'expo-updates';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text } from 'react-native';

// A top-level "apply update" affordance. It appears only when a JS (OTA) update
// is available or already downloaded. Tapping fetches it (if needed) and reloads
// the JS runtime in place to apply — a quick relaunch, no quit/reopen.
//
// (The earlier native crash on reloadAsync came from expo-dev-client being
// compiled into the release build; that's removed as of runtimeVersion 1.1.0,
// so in-app reload is safe again. This JS only ships to runtime 1.1.0+ builds.)
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
      // Make sure there's genuinely a new update, then reload in place to apply.
      let pending = isUpdatePending;
      if (!pending) {
        const res = await Updates.fetchUpdateAsync();
        pending = res.isNew;
      }
      if (pending) {
        await Updates.reloadAsync();
      } else {
        setBusy(false); // nothing new to apply
      }
    } catch (e) {
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
