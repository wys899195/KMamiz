import {
  TEndpointPropagationStatsForOneTimeSlot,
} from "../../entities/TLoadSimulation";
import {
  TFallbackStrategy
} from "../../entities/TSimulationConfig";

interface ErrorPropagationStrategy {
  /**
   * Determines whether to adjust the endpoint status based on errors from dependent endpoints for a given request
   * @param endpointCurrentSuccess - The current success status of the endpoint for the request
   * @param dependentEndpointsSuccessList - The success status list of dependent endpoints for the request
   * @returns The adjusted status of the endpoint (true = success, false = failure)
   */
  propagateError(
    endpointCurrentSuccess: boolean,
    dependentEndpointsSuccessList: boolean[]
  ): boolean;
}




// (default) Endpoint fail if any depend endpoints fails
class FailIfAnyDependentFailsStrategy implements ErrorPropagationStrategy {
  propagateError(endpointCurrentSuccess: boolean, dependentEndpointsSuccessList: boolean[]): boolean {
    if (!endpointCurrentSuccess) return false;
    return !dependentEndpointsSuccessList.includes(false);
  }
}

//  Endpoint fail only if all depend endpoints fail
class FailIfAllDependentsFailStrategy implements ErrorPropagationStrategy {
  propagateError(endpointCurrentSuccess: boolean, dependentEndpointsSuccessList: boolean[]): boolean {
    if (!endpointCurrentSuccess) return false; // It has failed on its own
    if (dependentEndpointsSuccessList.length === 0) return true; // No dependency on endpoint, directly successful

    const allFailed = dependentEndpointsSuccessList.every(success => !success);
    return !allFailed;
  }
}

// Depend endpoints errors are not propagated to the parent
class IgnoreDependentErrorsStrategy implements ErrorPropagationStrategy {
  propagateError(endpointCurrentSuccess: boolean, _dependentEndpointsSuccessList: boolean[]): boolean {
    return endpointCurrentSuccess;
  }
}



export default class LoadSimulationPropagator {

  private strategyInstances: Record<TFallbackStrategy, ErrorPropagationStrategy>;

  constructor() {
    this.strategyInstances = {
      "failIfAnyDependentFail": new FailIfAnyDependentFailsStrategy(),
      "failIfAllDependentFail": new FailIfAllDependentsFailStrategy(),
      "ignoreDependentFail": new IgnoreDependentErrorsStrategy(),
    };
  }

  simulatePropagationToEstimateLoad(
    dependOnMap: Map<string, Set<string>>,
    entryEndpointRequestCountsMapByTimeSlot: Map<string, Map<string, number>>,
    latencyMap: Map<string, number>,
    errorRateMap: Map<string, number>,
    fallbackStrategyMap: Map<string, TFallbackStrategy>,
  ): Map<string, Map<string, TEndpointPropagationStatsForOneTimeSlot>> {
    // console.log("dependOnMap", dependOnMap);
    // console.log("entryEndpointRequestCountsMapByTimeSlot",entryEndpointRequestCountsMapByTimeSlot);
    // console.log("latencyMap", latencyMap);
    // console.log("errorRateMap", errorRateMap);
    // console.log("resuit", this.simulatePropagation(
    //   dependOnMap,
    //   entryEndpointRequestCountsMapByTimeSlot,
    //   latencyMap,
    //   () => errorRateMap
    // ))

    return this.simulatePropagation(
      dependOnMap,
      entryEndpointRequestCountsMapByTimeSlot,
      latencyMap,
      () => errorRateMap,
      this.preprocessFallbackStrategyMap(fallbackStrategyMap),
      false,
    );
  }

  simulatePropagationWithAdjustedErrorRates(
    dependOnMap: Map<string, Set<string>>,
    entryEndpointRequestCountsMapByTimeSlot: Map<string, Map<string, number>>,
    latencyMap: Map<string, number>,
    adjustedErrorRatePerTimeSlot: Map<string, Map<string, number>>,
    fallbackStrategyMap: Map<string, TFallbackStrategy>,
  ): Map<string, Map<string, TEndpointPropagationStatsForOneTimeSlot>> {
    return this.simulatePropagation(
      dependOnMap,
      entryEndpointRequestCountsMapByTimeSlot,
      latencyMap,
      (timeSlotKey) => {
        return adjustedErrorRatePerTimeSlot.get(timeSlotKey) || new Map<string, number>();
      },
      this.preprocessFallbackStrategyMap(fallbackStrategyMap),
      true
    );
  }

  private simulatePropagation(
    dependOnMap: Map<string, Set<string>>,
    entryEndpointRequestCountsMapByTimeSlot: Map<string, Map<string, number>>,
    latencyMap: Map<string, number>,
    getErrorRateMap: (timeSlotKey: string) => Map<string, number>, //  key = `${day}-${hour}-${minute}`
    fallbackStrategyMap: Map<string, ErrorPropagationStrategy>,
    shouldComputeLatency: boolean
  ): Map<string, Map<string, TEndpointPropagationStatsForOneTimeSlot>> {
    /*
     * Returns a Map representing aggregated traffic simulation results.
     *
     * Top-level Map:
     * Key:   string - A timeSlotKey in "day-hour-minute" format (e.g., "0-10-30").
     * Value: Map<string, TEndpointPropagationStats> - Details for all endpoints active during a specific time slot.
     *
     * Inner Map (Value of Top-level Map):
     * Key:   string - The unique ID of a target endpoint (endpointId).
     * Value: TEndpointPropagationStats
     */
    const results: Map<string, Map<string, TEndpointPropagationStatsForOneTimeSlot>> = new Map();

    // Iterate through each entry point (entryPointId) configured in the simulation configuration.
    for (const [timeSlotKey, entryPointReqestCountMap] of entryEndpointRequestCountsMapByTimeSlot.entries()) {
      // Get the error rate map for all endpoints at this specific time slot.
      const errorRateMap = getErrorRateMap(timeSlotKey);

      const propagationResultAtThisTimeSlot = this.simulatePropagationInSingleTimeSlot(
        entryPointReqestCountMap,
        dependOnMap,
        latencyMap,
        errorRateMap,
        fallbackStrategyMap,
        shouldComputeLatency
      )

      results.set(timeSlotKey, propagationResultAtThisTimeSlot);

    }

    return results;
  }

  private simulatePropagationInSingleTimeSlot(
    entryPointReqestCountMap: Map<string, number>,
    dependOnMap: Map<string, Set<string>>,
    latencyMap: Map<string, number>,
    errorRateMap: Map<string, number>,
    fallbackStrategyMap: Map<string, ErrorPropagationStrategy>,
    shouldComputeLatency: boolean
  ): Map<string, TEndpointPropagationStatsForOneTimeSlot> {
    const stats = new Map<string, TEndpointPropagationStatsForOneTimeSlot>(); // key: endpointID value: TEndpointPropagationStats for this endpoint

    // Store actual latencies of all requests for each endpointNode and status code, for later average calculation
    // key: endpointId, value: Map<statusCode, number[]>
    const allLatenciesPerNodeByStatus = new Map<string, Map<string, number[]>>();

    // Generate request IDs, format: 'endpoint-0', 'endpoint-1' ...
    function generateRequestIds(ep: string, count: number): string[] {
      const ids: string[] = [];
      for (let i = 0; i < count; i++) {
        ids.push(`${ep}-${i}`);
      }
      return ids;
    }

    // DFS to simulate errors and calculate actual latency for each request
    function dfsForPropagate(
      endpointId: string,
      requestIds: string[],
    ): { statusMap: Map<string, boolean>; latencyMap: Map<string, number> } {

      const currentStatus = new Map<string, boolean>();
      const realLatencyMap = new Map<string, number>();

      const errorRate = errorRateMap.get(endpointId) ?? 0;
      const baseLatency = latencyMap.get(endpointId) ?? 0;

      // Simulate this endpointNode's own error state
      const ownSuccessMap = new Map<string, boolean>();
      for (const reqId of requestIds) {
        const isError = Math.random() < errorRate;
        ownSuccessMap.set(reqId, !isError);
        currentStatus.set(reqId, !isError);

        const jitterFactor = 0.9 + Math.random() * 0.2 // Latency fluctuates randomly within +-10%
        const latency = baseLatency * jitterFactor;
        realLatencyMap.set(reqId, latency);// Default latency starts as own latency
      }

      // Get dependent endpoints
      const dependents = dependOnMap.get(endpointId);

      if (dependents && dependents.size > 0) {
        // dependent endpoints' latencies for each request
        const dependentLatenciesPerRequest = new Map<string, number[]>();

        // Recursively get all dependent endpoints' statuses and latencies, then store them
        const dependentResults: Map<string, { statusMap: Map<string, boolean>; latencyMap: Map<string, number> }> = new Map();

        for (const dependentId of dependents) {
          // Only forward successful requests to dependent endpoints
          const successReqs = [...ownSuccessMap.entries()]
            .filter(([_, success]) => success)
            .map(([reqId, _]) => reqId);

          if (successReqs.length > 0) {
            dependentResults.set(dependentId, dfsForPropagate(dependentId, successReqs));
          }
        }

        // For each request, collect all dependent endpoints' success statuses, then let the strategy decide the parent's status
        for (const reqId of requestIds) {
          if (!currentStatus.has(reqId)) continue;
          if (!currentStatus.get(reqId)) continue;  // If endpoint already failed, no need to check dependents

          const dependentSuccessList: boolean[] = [];

          for (const [_, { statusMap, latencyMap }] of dependentResults.entries()) {
            if (statusMap.has(reqId)) {
              dependentSuccessList.push(statusMap.get(reqId)!);

              // Accumulate dependent latencies per request
              if (!dependentLatenciesPerRequest.has(reqId)) {
                dependentLatenciesPerRequest.set(reqId, []);
              }
              dependentLatenciesPerRequest.get(reqId)!.push(latencyMap.get(reqId) ?? 0);
            }
          }

          // Use the strategy to decide the new parent status
          const parentCurrentSuccess = currentStatus.get(reqId)!;
          const fallbackStrategy = fallbackStrategyMap.get(endpointId) ?? new FailIfAnyDependentFailsStrategy();
          const newParentSuccess = fallbackStrategy.propagateError(parentCurrentSuccess, dependentSuccessList);
          currentStatus.set(reqId, newParentSuccess);
        }

        // Update actual latency using the maximum dependent latency
        for (const reqId of requestIds) {
          if (currentStatus.get(reqId)) {
            const dependentLats = dependentLatenciesPerRequest.get(reqId) ?? [];
            const maxDependentLat = dependentLats.length > 0 ? Math.max(...dependentLats) : 0;
            const ownLat = realLatencyMap.get(reqId) ?? 0;
            realLatencyMap.set(reqId, ownLat + maxDependentLat);
          }
        }
      }

      // Store all request latencies for this endpointNode by status code
      if (!allLatenciesPerNodeByStatus.has(endpointId)) {
        allLatenciesPerNodeByStatus.set(endpointId, new Map<string, number[]>());
      }
      const latMap = allLatenciesPerNodeByStatus.get(endpointId)!;
      for (const reqId of requestIds) {
        const statusCode = currentStatus.get(reqId) ? "200" : "500";
        if (!latMap.has(statusCode)) {
          latMap.set(statusCode, []);
        }
        latMap.get(statusCode)!.push(realLatencyMap.get(reqId)!);
      }


      // Count own errors and downstream errors
      let ownErrorCount = 0;
      let downstreamErrorCount = 0;
      for (const reqId of requestIds) {
        const ownSuccess = ownSuccessMap.get(reqId) ?? false;
        const finalSuccess = currentStatus.get(reqId) ?? false;

        if (!ownSuccess) ownErrorCount++;
        else if (!finalSuccess) downstreamErrorCount++;
      }

      // Update endpointNode statistics
      const prevStats = stats.get(endpointId) ?? {
        requestCount: 0,
        ownErrorCount: 0,
        downstreamErrorCount: 0,
        latencyStatsByStatus: new Map<string, { mean: number; cv: number }>(),
      };
      stats.set(endpointId, {
        requestCount: prevStats.requestCount + requestIds.length,
        ownErrorCount: prevStats.ownErrorCount + ownErrorCount,
        downstreamErrorCount: prevStats.downstreamErrorCount + downstreamErrorCount,
        latencyStatsByStatus: prevStats.latencyStatsByStatus,
      });

      return { statusMap: currentStatus, latencyMap: realLatencyMap };
    }

    // Execute simulation
    for (const [entryPoint, count] of entryPointReqestCountMap.entries()) {
      const requestIds = generateRequestIds(entryPoint, count);
      dfsForPropagate(entryPoint, requestIds);
    }

    // Calculate average latency and CV per status code, then update stats
    for (const [endpointId, latByStatus] of allLatenciesPerNodeByStatus.entries()) {
      const prevStats = stats.get(endpointId)!;
      const latencyStatsByStatus = new Map<string, { mean: number; cv: number }>();
      for (const [status, latencies] of latByStatus.entries()) {
        latencyStatsByStatus.set(
          status,
          shouldComputeLatency ? this.computeMeanAndCVByWelford(latencies) : { mean: 0, cv: 0 }
        );
      }
      stats.set(endpointId, {
        ...prevStats,
        latencyStatsByStatus,
      });
    }

    return stats;
  }

  // Use Welford's algorithm to calculate CV and avoid overflow issues when computing variance
  private computeMeanAndCVByWelford(latencies: number[]): { mean: number, cv: number } {
    if (latencies.length === 0) return { mean: 0, cv: 0 };

    let mean = 0;
    let sumSqDiff = 0;

    for (let i = 0; i < latencies.length; i++) {
      const x = latencies[i];
      const oldMean = mean;
      mean += (x - mean) / (i + 1);
      sumSqDiff += (x - mean) * (x - oldMean);
    }

    const variance = sumSqDiff / latencies.length;
    const stdDev = Math.sqrt(variance);
    const cv = mean !== 0 ? stdDev / mean : 0;

    return { mean, cv };
  }

  private preprocessFallbackStrategyMap(fallbackStrategyMap: Map<string, TFallbackStrategy>): Map<string, ErrorPropagationStrategy> {
    const result = new Map<string, ErrorPropagationStrategy>();

    for (const [endpointId, strategyName] of fallbackStrategyMap.entries()) {
      const strategyInstance = this.strategyInstances[strategyName];
      result.set(endpointId, strategyInstance);
    }

    return result;
  }

}