import {
  TEndpointTrafficStats,
} from "../../entities/TLoadSimulation";

export default class LoadSimulationPropagator {

  simulatePropagationWithBaseErrorRates(
    dependOnMap: Map<string, Set<string>>,
    endpointDailyRequestCountsMap: Map<string, Map<string, number>>,
    latencyMap: Map<string, number>,
    errorRateMap: Map<string, number>
  ): Map<string, Map<string, TEndpointTrafficStats>> {
    console.log("dependOnMap", dependOnMap);
    console.log("endpointDailyRequestCountsMap", endpointDailyRequestCountsMap);
    console.log("latencyMap", latencyMap);
    console.log("errorRateMap", errorRateMap);
    console.log("resuit", this.simulatePropagation(
      dependOnMap,
      endpointDailyRequestCountsMap,
      latencyMap,
      () => errorRateMap
    ))
    return this.simulatePropagation(
      dependOnMap,
      endpointDailyRequestCountsMap,
      latencyMap,
      () => errorRateMap
    );
  }

  simulatePropagationWithAdjustedErrorRates(
    dependOnMap: Map<string, Set<string>>,
    endpointDailyRequestCountsMap: Map<string, Map<string, number>>,
    latencyMap: Map<string, number>,
    adjustedErrorRatePerMinute: Map<string, Map<string, number>>
  ): Map<string, Map<string, TEndpointTrafficStats>> {
    return this.simulatePropagation(
      dependOnMap,
      endpointDailyRequestCountsMap,
      latencyMap,
      (dayHourMinuteKey) => {
        return adjustedErrorRatePerMinute.get(dayHourMinuteKey) || new Map<string, number>();
      }
    );
  }

  private simulatePropagation(
    dependOnMap: Map<string, Set<string>>,
    endpointDailyRequestCountsMap: Map<string, Map<string, number>>,
    latencyMap: Map<string, number>,
    getErrorRateMap: (dayHourMinuteKey: string) => Map<string, number>        //  key = `${day}-${hour}-${minute}`
  ): Map<string, Map<string, TEndpointTrafficStats>> {
    /*
     * Returns a Map representing aggregated traffic simulation results per minute.
     *
     * Top-level Map:
     * Key:   string - A timestamp key in "day-hour-minute" format (e.g., "0-10-30").
     * Value: Map<string, TEndpointTrafficStats> - Details for all endpoints active during this minute.
     *
     * Inner Map (Value of Top-level Map):
     * Key:   string - The unique ID of a target endpoint (endpointId).
     * Value: TEndpointTrafficStats
     */
    const results: Map<string, Map<string, TEndpointTrafficStats>> = new Map();

    // Iterate through each entry point (entryPointId) configured in the simulation configuration.
    for (const [entryPointId, dailyCounts] of endpointDailyRequestCountsMap.entries()) {
      // dailyCounts is a Map<"day-hour-minute", count>.
      // Iterate through the request counts for this entry point across all time slots (dayHourMinuteKey).
      for (const [dayHourMinuteKey, count] of dailyCounts.entries()) {
        if (count <= 0) continue; // Skip if no requests for this time slot

        // Get the error rate map for all endpoints at this specific time slot.
        const errorRateMap = getErrorRateMap(dayHourMinuteKey);

        // Simulate traffic propagation starting from this entry point,
        // and get the statistics for all affected endpoints.
        const { stats } = this.simulatePropagationFromSingleEntrySingleTimeSlot(
          entryPointId,
          count,
          dependOnMap,
          latencyMap,
          errorRateMap
        );


        if (!results.has(dayHourMinuteKey)) {
          results.set(dayHourMinuteKey, new Map());
        }
        const endpointStatsMapInspecificTime = results.get(dayHourMinuteKey)!;

        // Iterate through the 'stats' returned by simulatePropagationFromSingleEntrySingleTimeSlot.
        // (stats represents the traffic propagation result for a single entry point within a single time slot).
        // Accumulate the total request count, error count, and maximum latency for each endpoint in 'stats'.
        for (const [targetEndpointId, stat] of stats.entries()) {

          if (!endpointStatsMapInspecificTime.has(targetEndpointId)) {
            endpointStatsMapInspecificTime.set(targetEndpointId, {
              requestCount: 0,
              errorCount: 0,
              maxLatency: 0
            });
          }
          const existingStats = endpointStatsMapInspecificTime.get(targetEndpointId)!;
          existingStats.requestCount += stat.requestCount;
          existingStats.errorCount += stat.errorCount;
          existingStats.maxLatency = Math.max(existingStats.maxLatency, stat.maxLatency);
        }
      }
    }

    return results;
  }

  // this function will return the traffic propagation result for a single entry point within a single time slot
  private simulatePropagationFromSingleEntrySingleTimeSlot(
    entryPointId: string,
    initialRequestCount: number,
    dependOnMap: Map<string, Set<string>>,
    latencyMap: Map<string, number>,
    errorRateMap: Map<string, number>,
  ): {
    entryPointId: string;
    stats: Map<string, { requestCount: number; errorCount: number; maxLatency: number }>;
  } {
    // console.log(dependByMap);
    // If there are no initial requests, return empty stats
    if (initialRequestCount <= 0) {
      return { entryPointId, stats: new Map() };
    }

    // Store aggregated statistics per endpoint
    const stats = new Map<string, { requestCount: number; errorCount: number; maxLatency: number }>();
    // Track visited endpoints to avoid cycles
    const visited = new Set<string>();

    // Depth-first search to propagate traffic and compute metrics
    function dfs(endpointId: string, propagatedRequests: number): number {
      // If already visited or no requests to propagate, return zero latency
      if (visited.has(endpointId) || propagatedRequests <= 0) return 0;
      visited.add(endpointId);

      const errorRate = errorRateMap.get(endpointId) ?? 0;
      const latency = latencyMap.get(endpointId) ?? 0;

      // Simulate error count based on error rate
      let errorCount = 0;
      if (errorRate === 1) errorCount = propagatedRequests;
      else if (errorRate > 0) {
        for (let i = 0; i < propagatedRequests; i++) {
          if (Math.random() < errorRate) errorCount++;
        }
      }

      // Calculate successful requests after errors
      const successfulRequests = propagatedRequests - errorCount;

      // Recursively propagate to dependent child endpoints
      const children = dependOnMap.get(endpointId);
      let maxChildLatency = 0;
      if (children) {
        for (const childId of children) {
          const childLatency = dfs(childId, successfulRequests);
          if (childLatency > maxChildLatency) maxChildLatency = childLatency;
        }
      }

      // Total latency includes current endpoint's latency and max downstream latency
      const totalLatency = latency + maxChildLatency;

      // Update stats for this endpoint with accumulated values
      const currentStats = stats.get(endpointId) ?? { requestCount: 0, errorCount: 0, maxLatency: 0 };
      stats.set(endpointId, {
        requestCount: currentStats.requestCount + propagatedRequests,
        errorCount: currentStats.errorCount + errorCount,
        maxLatency: Math.max(currentStats.maxLatency, totalLatency),
      });

      // Remove endpoint from visited set before backtracking
      visited.delete(endpointId);
      return totalLatency;
    }

    // Start DFS traversal from the entry point
    dfs(entryPointId, initialRequestCount);

    return { entryPointId, stats };
  }
}