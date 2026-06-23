import { useLocalSearchParams } from 'expo-router';
import React, { Suspense, useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { ExperimentHost } from '../../experiments/_host';
import { getExperiment } from '../../experiments/registry';

// Dynamic host route. Looks the experiment up by id and renders its (lazily
// loaded) screen inside the shared host. One file serves every experiment.
export default function ExperimentScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const experiment = getExperiment(id);

  const Lazy = useMemo(
    () => (experiment ? React.lazy(experiment.load) : null),
    [experiment]
  );

  return (
    <ExperimentHost>
      {Lazy ? (
        <Suspense fallback={<Centered>{<ActivityIndicator color="#fff" />}</Centered>}>
          <Lazy />
        </Suspense>
      ) : (
        <Centered>
          <Text style={styles.missing}>Unknown experiment: {String(id)}</Text>
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
