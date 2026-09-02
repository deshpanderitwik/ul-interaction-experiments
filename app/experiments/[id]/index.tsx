import { useLocalSearchParams } from 'expo-router';
import { HostedExperiment } from '../../../experiments/_screen';
import { experiments, getExperiment } from '../../../experiments/registry';

// Static web export: one HTML page per experiment.
export function generateStaticParams() {
  return experiments.map((e) => ({ id: e.id }));
}

// Base experiment route: /experiments/<id>
export default function ExperimentBase() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const experiment = getExperiment(id);
  return (
    <HostedExperiment load={experiment?.load} settingsKey={id} missingLabel={id} />
  );
}
