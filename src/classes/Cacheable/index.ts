import { CCombinedRealtimeData } from "./CCombinedRealtimeData";
import { CEndpointDataType } from "./CEndpointDataType";
import { CEndpointDependencies } from "./CEndpointDependencies";
import { CLabeledEndpointDependencies } from "./CLabeledEndpointDependencies";
import { CLabelMapping } from "./CLabelMapping";
import { CLookBackRealtimeData } from "./CLookBackRealtimeData";
import { CReplicas } from "./CReplicas";
import { CTaggedInterfaces } from "./CTaggedInterfaces";
import { CTaggedSwaggers } from "./CTaggedSwaggers";
import { CTaggedDiffData } from "./CTaggedDiffData";
import { CUserDefinedLabel } from "./CUserDefinedLabel";
import { CTaggedSimulationYAML } from "./CTaggedSimulationYAML";

const classes = {
  [CCombinedRealtimeData.uniqueName]: CCombinedRealtimeData,
  [CEndpointDependencies.uniqueName]: CEndpointDependencies,
  [CLabeledEndpointDependencies.uniqueName]: CLabeledEndpointDependencies,
  [CEndpointDataType.uniqueName]: CEndpointDataType,
  [CReplicas.uniqueName]: CReplicas,
  [CLabelMapping.uniqueName]: CLabelMapping,
  [CUserDefinedLabel.uniqueName]: CUserDefinedLabel,
  [CTaggedInterfaces.uniqueName]: CTaggedInterfaces,
  [CTaggedSwaggers.uniqueName]: CTaggedSwaggers,
  [CTaggedDiffData.uniqueName]: CTaggedDiffData,
  [CLookBackRealtimeData.uniqueName]: CLookBackRealtimeData,
  [CTaggedSimulationYAML.uniqueName]: CTaggedSimulationYAML,
};

const names = [
  CCombinedRealtimeData.uniqueName,
  CEndpointDependencies.uniqueName,
  CLabeledEndpointDependencies.uniqueName,
  CEndpointDataType.uniqueName,
  CReplicas.uniqueName,
  CLabelMapping.uniqueName,
  CUserDefinedLabel.uniqueName,
  CTaggedInterfaces.uniqueName,
  CTaggedSwaggers.uniqueName,
  CTaggedDiffData.uniqueName,
  CLookBackRealtimeData.uniqueName,
  CTaggedSimulationYAML.uniqueName,
] as const;

export type CacheableNames = typeof names[number];
export { classes, names as nameList };
