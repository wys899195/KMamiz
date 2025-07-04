import {
  TSimulationConfigErrors,
  TLoadSimulationSettings,
  TSimulationEndpointMetric,
  TFallbackStrategy,
} from "../../../entities/TSimulationConfig";

export default class SimConfigLoadSimulationPreprocessor {

  preprocess(
    loadSimulationSettings: TLoadSimulationSettings,
    endpointIdToUniqueNameMap: Map<string, string>, // key: endpointId, value: UniqueEndpointName
    allDefinedEndpointIds: Set<string>,
  ): TSimulationConfigErrors[] {
    const assignUniqueEndpointNameErrors = this.assignUniqueEndpointName(loadSimulationSettings, endpointIdToUniqueNameMap);
    if (assignUniqueEndpointNameErrors.length) return assignUniqueEndpointNameErrors;
    
    this.addDefaultMetricsForMissingEndpointsInPlace(loadSimulationSettings,allDefinedEndpointIds);

    // If no errors found, return an empty array.
    return [];
  }

  // Assign uniqueEndpointName to each endpoint for later use
  private assignUniqueEndpointName(
    loadSimulationSettings: TLoadSimulationSettings,
    endpointIdToUniqueNameMap: Map<string, string>,
  ): TSimulationConfigErrors[] {
    // If the previous validations were correctly implemented, this error should not occur
    // this is here only as a safeguard.
    const errorMessages: TSimulationConfigErrors[] = [];

    // endpointMetric
    loadSimulationSettings.endpointMetrics.forEach((epMetric, index) => {
      epMetric.uniqueEndpointName = endpointIdToUniqueNameMap.get(epMetric.endpointId);
      if (!epMetric.uniqueEndpointName) {
        const errorLocation = `loadSimulation.endpointMetrics[${index}].endpointId`;
        errorMessages.push({
          errorLocation: errorLocation,
          message: `Failed to assign uniqueEndpointName: endpointId "${epMetric.endpointId}" does not exist in the mapping. (This is unexpected system error!!)`
        });
      }
    });

    // faults TODO
    loadSimulationSettings.faults?.forEach((fault, faultIndex) => {
      if (fault.type != "reduce-instance") {
        if (fault.targets?.endpoints) {
          fault.targets.endpoints.forEach((ep, epIndex) => {
            const originalId = ep.endpointId;
            const mappedId = endpointIdToUniqueNameMap.get(originalId);
            const errorLocation = `faults[${faultIndex}].targets.endpoints[${epIndex}].endpointId`;

            if (mappedId) {
              ep.endpointId = mappedId;
            } else {
              errorMessages.push({
                errorLocation,
                message: `Cannot map endpointId "${originalId}" in faults.`,
              });
            }
          });
        }
      }

    });

    return errorMessages;
  }

  // Avoid missing base error rates for endpoints when adjusting error rates during load simulation
  private addDefaultMetricsForMissingEndpointsInPlace(
    loadSimulationSettings: TLoadSimulationSettings,
    allDefinedEndpointIds: Set<string>,
  ) {
    const endpointMetrics: TSimulationEndpointMetric[] = loadSimulationSettings.endpointMetrics;
    const existingMetricIds = new Set(endpointMetrics.map(m => m.endpointId));
    const missingEndpointIds = Array.from(allDefinedEndpointIds).filter(id => !existingMetricIds.has(id));
    const defaultMetrics = missingEndpointIds.map(id => ({
      endpointId: id,
      delay: { latencyMs: 0, jitterMs: 0 },
      expectedExternalDailyRequestCount: 0,
      errorRatePercent: 0,
      fallbackStrategy: "failIfAnyDependentFail" as TFallbackStrategy
    }));
    loadSimulationSettings.endpointMetrics = [...endpointMetrics, ...defaultMetrics];

  }
}
