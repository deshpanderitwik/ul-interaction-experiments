import { useFocusEffect, useRouter } from 'expo-router';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { RecordControl } from './recorder';
import { getExperiment, getVariation } from './registry';
import { SettingsGear, SettingsProvider, SettingsSheet } from './settings';

// Whether the hosted experiment is currently "live": on-screen AND the app is
// foregrounded. Experiments should gate their hardware (camera, sensors) and
// render loops on this so resources are released when you navigate away or
// background the app. Defaults to true so an experiment rendered outside a
// host still behaves.
const ActiveContext = createContext(true);

/**
 * Read inside an experiment to know when it is live. Wire camera/sensor
 * subscriptions and animation loops to this value:
 *   const active = useExperimentActive();
 *   useEffect(() => { if (!active) return; start(); return stop; }, [active]);
 */
export function useExperimentActive(): boolean {
  return useContext(ActiveContext);
}

/**
 * Wraps every experiment. Provides:
 *  - focus-based "active" signal for hardware teardown, and
 *  - a custom overlay back control (canvas stays edge-to-edge; swipe-back
 *    still works).
 * Intentionally lean: no error boundary, no safe-area wrapper (yet).
 */
export function ExperimentHost({
  children,
  settingsKey = 'experiment',
}: {
  children: ReactNode;
  settingsKey?: string;
}) {
  const router = useRouter();
  const [focused, setFocused] = useState(true);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');

  // Focused while this screen is the active route on the stack.
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, [])
  );

  // Foreground/background.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) =>
      setAppActive(s === 'active')
    );
    return () => sub.remove();
  }, []);

  const active = focused && appActive;

  // Chrome (back / record / gear / hide) can be tucked away for a clean capture;
  // tapping the now-empty top-bar strip brings it back.
  const [chromeHidden, setChromeHidden] = useState(false);

  const [expId, varId] = settingsKey.split('/');
  const exp = getExperiment(expId);
  const variation = getVariation(expId, varId);
  // A variation can opt into audio on its own (e.g. a sound sketch under an
  // otherwise visual experiment); otherwise inherit the parent's flag.
  const audio = variation?.audio ?? exp?.audio ?? false;

  return (
    <ActiveContext.Provider value={active}>
      <SettingsProvider id={settingsKey} audio={audio}>
        <View style={styles.fill}>
          {children}
          {chromeHidden ? (
            // The UI is tucked away — a transparent strip over the old top-bar
            // area brings it back on tap.
            <Pressable
              onPress={() => setChromeHidden(false)}
              accessibilityRole="button"
              accessibilityLabel="Show controls"
              style={styles.revealStrip}
            />
          ) : (
            <>
              <Pressable
                onPress={() => router.back()}
                hitSlop={16}
                accessibilityRole="button"
                accessibilityLabel="Back to Home"
                style={styles.back}
              >
                <Text style={styles.chevron}>‹</Text>
              </Pressable>
              {audio ? (
                <RecordControl experiment={variation?.title ?? exp?.title ?? 'Experiment'} />
              ) : null}
              <SettingsGear />
              <Pressable
                onPress={() => setChromeHidden(true)}
                hitSlop={16}
                accessibilityRole="button"
                accessibilityLabel="Hide controls"
                style={styles.hide}
              >
                <Text style={styles.hideIcon}>⌄</Text>
              </Pressable>
            </>
          )}
          <SettingsSheet />
        </View>
      </SettingsProvider>
    </ActiveContext.Provider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  back: {
    position: 'absolute',
    top: 56,
    left: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  chevron: {
    color: '#fff',
    fontSize: 26,
    lineHeight: 28,
    marginTop: -2,
    marginLeft: -2,
  },
  // Sits just left of the gear (gear is right:20, width 40, + 8 gap).
  hide: {
    position: 'absolute',
    top: 56,
    right: 68,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  hideIcon: { color: '#fff', fontSize: 20, lineHeight: 20, marginTop: -2 },
  // Transparent tap target spanning the top-bar band while chrome is hidden.
  revealStrip: {
    position: 'absolute',
    top: 44,
    left: 0,
    right: 0,
    height: 68,
  },
});
