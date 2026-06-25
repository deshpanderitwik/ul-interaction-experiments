import { useLocalSearchParams } from 'expo-router';
import { HostedExperiment } from '../../../experiments/_screen';
import { getExperiment, getVariation } from '../../../experiments/registry';

// Variation route: /experiments/<id>/<variation>
// A preset variation renders the parent experiment's component with the preset
// as props; a custom variation provides its own `load`.
export default function ExperimentVariation() {
  const params = useLocalSearchParams<{
    id: string | string[];
    variation: string | string[];
  }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const variation = Array.isArray(params.variation)
    ? params.variation[0]
    : params.variation;

  const v = getVariation(id, variation);
  const load = v?.load ?? getExperiment(id)?.load;

  return (
    <HostedExperiment
      load={v ? load : undefined}
      props={v?.preset}
      settingsKey={`${id}/${variation}`}
      missingLabel={`${id}/${variation}`}
    />
  );
}
