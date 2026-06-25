import React, { Suspense, useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { ExperimentHost } from './_host';

type Load = () => Promise<{ default: React.ComponentType<any> }>;

// Shared render path for both the base experiment route and the variation
// route: wrap in the host, lazy-load the screen (passing any preset props), or
// show a not-found message.
export function HostedExperiment({
  load,
  props,
  missingLabel,
  settingsKey,
}: {
  load?: Load;
  props?: Record<string, unknown>;
  missingLabel?: string;
  settingsKey?: string;
}) {
  const Lazy = useMemo(() => (load ? React.lazy(load) : null), [load]);

  return (
    <ExperimentHost settingsKey={settingsKey}>
      {Lazy ? (
        <Suspense
          fallback={
            <Centered>
              <ActivityIndicator color="#fff" />
            </Centered>
          }
        >
          <Lazy {...props} />
        </Suspense>
      ) : (
        <Centered>
          <Text style={styles.missing}>Unknown: {String(missingLabel)}</Text>
        </Centered>
      )}
    </ExperimentHost>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <View style={styles.centered}>{children}</View>;
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  missing: { color: '#888', fontSize: 15 },
});
