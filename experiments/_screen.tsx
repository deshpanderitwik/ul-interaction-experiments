import React, { Suspense, useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { ExperimentHost } from './_host';

type Load = () => Promise<{ default: React.ComponentType }>;

// Shared render path for both the base experiment route and the variation
// route: wrap in the host, lazy-load the screen, or show a not-found message.
export function HostedExperiment({
  load,
  missingLabel,
}: {
  load?: Load;
  missingLabel?: string;
}) {
  const Lazy = useMemo(() => (load ? React.lazy(load) : null), [load]);

  return (
    <ExperimentHost>
      {Lazy ? (
        <Suspense
          fallback={
            <Centered>
              <ActivityIndicator color="#fff" />
            </Centered>
          }
        >
          <Lazy />
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
