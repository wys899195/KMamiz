import {
  TTrafficSimulationResult,
} from "../../entities/TLoadSimulation";

export default class LoadSimulationPropagator {

  simulatePropagationWithBaseErrorRates(
    dependOnMap: Map<string, Set<string>>,
    minutelyRequestCountsForEachDayMap: Map<string, number[][][]>,
    latencyMap: Map<string, number>,
    errorRateMap: Map<string, number>
  ): TTrafficSimulationResult {
    return this.simulatePropagation(
      dependOnMap,
      minutelyRequestCountsForEachDayMap,
      latencyMap,
      () => errorRateMap
    );
  }

  simulatePropagationWithAdjustedErrorRates(
    dependOnMap: Map<string, Set<string>>,
    minutelyRequestCountsForEachDayMap: Map<string, number[][][]>,
    latencyMap: Map<string, number>,
    adjustedErrorRatePerMinute: Map<string, Map<string, number>>
  ): TTrafficSimulationResult {
    return this.simulatePropagation(
      dependOnMap,
      minutelyRequestCountsForEachDayMap,
      latencyMap,
      (day, hour, minute) => {
        const key = `${day}-${hour}-${minute}`;
        return adjustedErrorRatePerMinute.get(key) || new Map<string, number>();
      }
    );
  }

  private simulatePropagation(
    dependOnMap: Map<string, Set<string>>,
    minutelyRequestCountsForEachDayMap: Map<string, number[][][]>,
    latencyMap: Map<string, number>,
    getErrorRateMap: (day: number, hour: number, minute: number) => Map<string, number>
  ): TTrafficSimulationResult {

    const results: TTrafficSimulationResult = new Map();

    for (const [entryPointId, dailyCounts] of minutelyRequestCountsForEachDayMap.entries()) {
      for (let day = 0; day < dailyCounts.length; day++) {
        const hourlyCounts = dailyCounts[day];
        for (let hour = 0; hour < 24; hour++) {
          const minuteCounts = hourlyCounts[hour];
          for (let minute = 0; minute < 60; minute++) {
            const count = minuteCounts[minute];
            if (count <= 0) continue;

            const errorRateMap = getErrorRateMap(day, hour, minute);

            const { stats } = this.simulatePropagationFromSingleEntry(
              entryPointId,
              count,
              dependOnMap,
              latencyMap,
              errorRateMap
            );

            if (!results.has(day)) {
              results.set(day, new Map());
            }
            const dailyStats = results.get(day)!;

            if (!dailyStats.has(hour)) {
              dailyStats.set(hour, new Map());
            }
            const hourlyStats = dailyStats.get(hour)!;

            if (!hourlyStats.has(minute)) {
              hourlyStats.set(minute, new Map());
            }
            const minuteStats = hourlyStats.get(minute)!;

            for (const [targetEndpointId, stat] of stats.entries()) {
              if (!minuteStats.has(targetEndpointId)) {
                minuteStats.set(targetEndpointId, {
                  requestCount: 0,
                  errorCount: 0,
                  maxLatency: 0
                });
              }
              const existingStats = minuteStats.get(targetEndpointId)!;
              existingStats.requestCount += stat.requestCount;
              existingStats.errorCount += stat.errorCount;
              existingStats.maxLatency = Math.max(existingStats.maxLatency, stat.maxLatency);
            }
          }
        }
      }
    }

    return results;
  }

  private simulatePropagationFromSingleEntry(
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