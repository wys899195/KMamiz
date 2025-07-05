import {
  TEndpointPropagationStatsForOneTimeSlot,
} from "../../entities/TLoadSimulation";
import {
  TFallbackStrategy,
  TSimulationEndpointDelay
} from "../../entities/TSimulationConfig";
import SimulatorUtils from "./SimulatorUtils";
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

  simulatePropagation(
    dependOnMap: Map<string, Set<string>>,
    entryEndpointRequestCountsMapByTimeSlot: Map<string, Map<string, number>>,
    delayWithFaultMapPerTimeSlot: Map<string, Map<string, TSimulationEndpointDelay>>,
    errorRatePerTimeSlot: Map<string, Map<string, number>>,
    replicaCountPerTimeSlot: Map<string, Map<string, number>>, // key: day-hour-minute, value: Map where Key is uniqueServiceName(`${serviceName}\t${namespace}\t${version}`) and Value is replica count
    fallbackStrategyMap: Map<string, TFallbackStrategy>,
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
     * Key:   string - uniqueEndpointName
     * Value: TEndpointPropagationStats
     */

    // console.log("dependOnMap", dependOnMap);
    // console.log("entryEndpointRequestCountsMapByTimeSlot",entryEndpointRequestCountsMapByTimeSlot);
    // console.log("delayWithFaultMapPerTimeSlot", delayWithFaultMapPerTimeSlot);
    // console.log("errorRateMap", errorRateMap);
    // console.log("resuit", this.simulatePropagation(
    //   dependOnMap,
    //   entryEndpointRequestCountsMapByTimeSlot,
    //   delayWithFaultMapPerTimeSlot,
    //   () => errorRateMap
    // ))
    const results: Map<string, Map<string, TEndpointPropagationStatsForOneTimeSlot>> = new Map();

    const preprocessedFallbackStrategyMap = this.preprocessFallbackStrategyMap(fallbackStrategyMap);

    // Iterate through each entry point (entryPointId) configured in the simulation configuration.
    for (const [timeSlotKey, entryPointReqestCountMap] of entryEndpointRequestCountsMapByTimeSlot.entries()) {
      // const replicaCountMap = new Map<string, number>([
      //   ['productpage\tbook\tv1', 2],
      //   ['details\tbook\tv1', 1],
      //   ['reviews\tbook\tv1', 0],
      //   ['reviews\tbook\tv2', 0],
      //   ['reviews\tbook\tv3', 1],
      //   ['book-recommendation\tbook\tv1', 1],
      //   ['ratings\tbook\tv1', 1],
      //   ['reviews-recommendation\tbook\tv1', 1],
      // ]);
      const replicaCountMap = replicaCountPerTimeSlot.get(timeSlotKey) || new Map<string, number>();

      const propagationResultAtThisTimeSlot = this.simulatePropagationInSingleTimeSlot(
        entryPointReqestCountMap,
        dependOnMap,
        delayWithFaultMapPerTimeSlot.get(timeSlotKey) || new Map<string, TSimulationEndpointDelay>(),
        errorRatePerTimeSlot.get(timeSlotKey) || new Map<string, number>(),
        replicaCountMap,
        preprocessedFallbackStrategyMap,
        shouldComputeLatency
      )

      //console.log("propagationResultAtThisTimeSlot", propagationResultAtThisTimeSlot)

      results.set(timeSlotKey, propagationResultAtThisTimeSlot);
    }

    return results;
  }

  private simulatePropagationInSingleTimeSlot(
    entryPointReqestCountMap: Map<string, number>,
    dependOnMap: Map<string, Set<string>>,
    delayMap: Map<string, TSimulationEndpointDelay>,
    errorRateMap: Map<string, number>,
    replicaCountMap: Map<string, number>,
    fallbackStrategyMap: Map<string, ErrorPropagationStrategy>,
    shouldComputeLatency: boolean
  ): Map<string, TEndpointPropagationStatsForOneTimeSlot> {
    const stats = new Map<string, TEndpointPropagationStatsForOneTimeSlot>(); // key: uniqueEndpointName value: TEndpointPropagationStats for this endpoint

    // console.log("dependOnMap=", dependOnMap)

    // Store actual latencies of all requests for each endpointNode and status code, for later average calculation
    // key: uniqueEndpointName, value: Map<statusCode, number[]>
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
    const dfsForPropagate = (
      uniqueEndpointName: string,
      requestIds: string[],
    ): { statusMap: Map<string, boolean>; latencyMap: Map<string, number> } => {

      const currentStatus = new Map<string, boolean>();
      const totalLatencyMap = new Map<string, number>();

      const uniqueServiceName = SimulatorUtils.extractUniqueServiceNameFromEndpointName(uniqueEndpointName);
      const replica = replicaCountMap.get(uniqueServiceName) ?? 1;

     // When a service has replica = 0, it always returns failure to upstream and does not propagate requests downstream.
      if (replica === 0) {
        for (const reqId of requestIds) {
          // The endpoint itself always succeeds (not counted as an ownError),
          // but reports a failure (false) to upstream callers,
          // and the latency is treated as 0.
          currentStatus.set(reqId, false);
          totalLatencyMap.set(reqId, 0);
        }
        // Do not propagate to downstream dependencies
        return { statusMap: currentStatus, latencyMap: totalLatencyMap };
      }

      const errorRate = errorRateMap.get(uniqueEndpointName) ?? 0;
      const delay: TSimulationEndpointDelay = delayMap.get(uniqueEndpointName) || { latencyMs: 0, jitterMs: 0 };

      // Simulate this endpointNode's own error state
      const ownSuccessMap = new Map<string, boolean>();
      for (const reqId of requestIds) {
        const isError = Math.random() < errorRate;
        ownSuccessMap.set(reqId, !isError);
        currentStatus.set(reqId, !isError);
        const jitteredLatency = this.getJitteredLatency(delay.latencyMs, delay.jitterMs);
        totalLatencyMap.set(reqId, jitteredLatency); // Default latency starts as own latency
      }

      // Get dependent endpoints
      const dependents = dependOnMap.get(uniqueEndpointName);

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
          const fallbackStrategy = fallbackStrategyMap.get(uniqueEndpointName) ?? new FailIfAnyDependentFailsStrategy();
          const newParentSuccess = fallbackStrategy.propagateError(parentCurrentSuccess, dependentSuccessList);
          currentStatus.set(reqId, newParentSuccess);
        }

        // Update actual latency using the maximum dependent latency(Critical Path Latency in DAG)
        for (const reqId of requestIds) {
          if (currentStatus.get(reqId)) {
            const dependentLats = dependentLatenciesPerRequest.get(reqId) ?? [];
            const maxDependentLat = dependentLats.length > 0 ? Math.max(...dependentLats) : 0;
            const ownLat = totalLatencyMap.get(reqId) ?? 0;
            totalLatencyMap.set(reqId, ownLat + maxDependentLat);
          }
        }
      }

      // Store all request latencies for this endpointNode by status code
      if (!allLatenciesPerNodeByStatus.has(uniqueEndpointName)) {
        allLatenciesPerNodeByStatus.set(uniqueEndpointName, new Map<string, number[]>());
      }
      const latMap = allLatenciesPerNodeByStatus.get(uniqueEndpointName)!;
      for (const reqId of requestIds) {
        const statusCode = currentStatus.get(reqId) ? "200" : "500";
        if (!latMap.has(statusCode)) {
          latMap.set(statusCode, []);
        }
        latMap.get(statusCode)!.push(totalLatencyMap.get(reqId)!);
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
      const prevStats = stats.get(uniqueEndpointName) ?? {
        requestCount: 0,
        ownErrorCount: 0,
        downstreamErrorCount: 0,
        latencyStatsByStatus: new Map<string, { mean: number; cv: number }>(),
      };
      stats.set(uniqueEndpointName, {
        requestCount: prevStats.requestCount + requestIds.length,
        ownErrorCount: prevStats.ownErrorCount + ownErrorCount,
        downstreamErrorCount: prevStats.downstreamErrorCount + downstreamErrorCount,
        latencyStatsByStatus: prevStats.latencyStatsByStatus,
      });

      return { statusMap: currentStatus, latencyMap: totalLatencyMap };
    }

    // Execute simulation
    for (const [entryPoint, count] of entryPointReqestCountMap.entries()) {
      const requestIds = generateRequestIds(entryPoint, count);
      dfsForPropagate(entryPoint, requestIds);
    }

    // Calculate average latency and CV per status code, then update stats
    for (const [uniqueEndpointName, latByStatus] of allLatenciesPerNodeByStatus.entries()) {
      const prevStats = stats.get(uniqueEndpointName)!;
      const latencyStatsByStatus = new Map<string, { mean: number; cv: number }>();
      for (const [status, latencies] of latByStatus.entries()) {
        latencyStatsByStatus.set(
          status,
          shouldComputeLatency ? this.computeMeanAndCVByWelford(latencies) : { mean: 0, cv: 0 }
        );
      }
      stats.set(uniqueEndpointName, {
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

    for (const [uniqueEndpointName, strategyName] of fallbackStrategyMap.entries()) {
      const strategyInstance = this.strategyInstances[strategyName];
      result.set(uniqueEndpointName, strategyInstance);
    }

    return result;
  }

  private getJitteredLatency(baseLatency: number, jitterMs: number): number {
    const min = baseLatency - jitterMs;
    const max = baseLatency + jitterMs;
    const jittered = Math.random() * (max - min) + min;
    return Math.max(0, jittered); // Ensure latency is not negative
  }
}