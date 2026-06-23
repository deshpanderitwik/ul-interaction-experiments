import { useLocalSearchParams } from 'expo-router';
import { HostedExperiment } from '../../../experiments/_screen';
import { getVariation } from '../../../experiments/registry';

// Variation route: /experiments/<id>/<variation>
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
  return <HostedExperiment load={v?.load} missingLabel={`${id}/${variation}`} />;
}
