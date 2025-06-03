import {
  TSimulationEndpointMetric,
  TSimulationEndpointDatatype,
  TLoadSimulation
} from "../../entities/TSimulationConfig";
import { TRealtimeData } from "../../entities/TRealtimeData";
import { TReplicaCount } from "../../entities/TReplicaCount";
import { TCombinedRealtimeData } from "../../entities/TCombinedRealtimeData";
import Utils from "../../utils/Utils";


type TBaseRealtimeData = Omit<
  TRealtimeData,
  'latency' | 'status' | 'responseBody' | 'responseContentType' | 'timestamp'
>;

type TBaseDataWithResponses = {
  baseData: TBaseRealtimeData,
  responses?: TSimulationEndpointDatatype['responses'],
}

// Represents request statistics for a specific endpoint during a particular hour
type TEndpointTrafficStats = {
  requestCount: number;
  errorCount: number;
  maxLatency: number;
};

// Request statistics for all endpoints in a specific hour 
// (key: endpoint ID, value: statistics for that endpoint)
type THourlyTrafficStatsMap = Map<string, TEndpointTrafficStats>;

// Request statistics for 24 hours in a specific day 
// (key: hour of the day (0–23), value: HourlyStatsMap for that hour)
type TDailyTrafficStatsMap = Map<number, THourlyTrafficStatsMap>;

// Simulation results for all dates in the simulation period of a single run 
// (key: day index (0 ~ simulationDurationInDays -1), value: DailyStatsMap for that day)
type TTrafficSimulationResult = Map<number, TDailyTrafficStatsMap>;

export default class LoadSimulationHandler {
  private static instance?: LoadSimulationHandler;
  static getInstance = () => this.instance || (this.instance = new this());
  private constructor() {}
  
  generateHourlyCombinedRealtimeDataMap(
    loadSimulationSettings: TLoadSimulation,
    dependOnMap: Map<string, Set<string>>,
    replicaCountList: TReplicaCount[],
    EndpointRealTimeBaseDatas: Map<string, TBaseDataWithResponses>,
    simulateDate: number
  ): Map<string, TCombinedRealtimeData[]> {
    const endpointMetrics = loadSimulationSettings.endpointMetrics;
    const simulationDurationInDays = loadSimulationSettings.config?.simulationDurationInDays ?? 1;
    const {
      hourlyRequestCountsForEachDayMap,
      latencyMap,
      errorRateMap: basicErrorRateMap
    } = this.getTrafficMap(endpointMetrics, simulationDurationInDays);

    // Use the basic error rate to simulate traffic propagation and calculate the 
    // expected incoming traffic for each service under normal (non-overloaded) conditions
    const trafficPropagationWithBasicErrorResults = this.simulateTrafficWithBaseErrorRates(
      dependOnMap,
      hourlyRequestCountsForEachDayMap,
      latencyMap,
      basicErrorRateMap,
    );

    // Estimate overload level for each service based on expected incoming traffic, the number of replicas, and per-replica throughput capacity  
    // Then combine with base error rate to calculate the adjusted error rate per endpoint, per hour  
    // (TODO) Per-replica throughput is currently fixed — consider allowing user configuration in the future
    const serviceRequestCountsPerHour = this.aggregateServiceRequestCountPerHour(trafficPropagationWithBasicErrorResults);
    const generateAdjustedErrorRatePerHourResult = this.generateAdjustedEndpointErrorRatePerHour(
      serviceRequestCountsPerHour,
      basicErrorRateMap, replicaCountList
    )

    // Re-run traffic propagation with adjusted error rates  
    // to obtain actual traffic distribution considering both "base errors" and "overload-induced errors"
    const trafficPropagationWithOverloadErrorResults = this.simulateTrafficWithAdjustedErrorRates(
      dependOnMap,
      hourlyRequestCountsForEachDayMap,
      latencyMap,
      generateAdjustedErrorRatePerHourResult,
    );

    const realtimeCombinedDataPerHourMap: Map<string, TCombinedRealtimeData[]> = this.generateRealtimeDataFromSimulationResults(
      EndpointRealTimeBaseDatas,
      trafficPropagationWithOverloadErrorResults,
      simulateDate
    );
    return realtimeCombinedDataPerHourMap;
  }

  private getTrafficMap(
    endpointMetrics: TSimulationEndpointMetric[],
    simulationDurationInDays: number,
  ): {
    hourlyRequestCountsForEachDayMap: Map<string, number[][]>; // key: endpointId, value: array of [days][24 hours]
    latencyMap: Map<string, number>;      // latency >= 0 key:endpointId value: latencyMs
    errorRateMap: Map<string, number>;    // errorRate in [0,1] key:endpointId value: errorRatePercentage / 100
  } {
    const hourlyRequestCountsForEachDayMap = new Map<string, number[][]>();
    const latencyMap = new Map<string, number>();
    const errorRateMap = new Map<string, number>();

    if (!endpointMetrics) {
      return { hourlyRequestCountsForEachDayMap, latencyMap, errorRateMap };
    }

    const SCALE_FACTORS = [0.25, 0.5, 2, 3, 4, 5];
    const PROBABILITY_OF_MUTATION = 0.3;


    for (const metric of endpointMetrics) {
      const endpointId = metric.endpointId;

      // latencyMap
      const latencyMs = metric.latencyMs ?? 0;
      latencyMap.set(endpointId, latencyMs);

      // errorRateMap
      const errorRate = (metric.errorRatePercentage ?? 0) / 100;
      errorRateMap.set(endpointId, errorRate);

      // hourlyRequestCountsForEachDayMap
      const baseDailyRequestCount = metric.expectedExternalDailyRequestCount ?? 0;
      if (baseDailyRequestCount === 0) continue;
      // Hourly request counts for each day (e.g., for the 3rd day, the count from 11:00 to 12:00 is dailyRequestCounts[2][11])
      const dailyRequestCounts: number[][] = [];

      for (let day = 0; day < simulationDurationInDays; day++) {
        const isMutated = Math.random() < PROBABILITY_OF_MUTATION;
        const mutationScaleRate = isMutated
          ? SCALE_FACTORS[Math.floor(Math.random() * SCALE_FACTORS.length)]
          : 1;

        const realRequestCountForThisday = Math.round(
          baseDailyRequestCount * mutationScaleRate
        );

        dailyRequestCounts.push(
          this.distributeDailyRequestToEachHours(realRequestCountForThisday)
        );
      }

      hourlyRequestCountsForEachDayMap.set(endpointId, dailyRequestCounts);
    }

    return { hourlyRequestCountsForEachDayMap, latencyMap, errorRateMap };
  }

  private aggregateServiceRequestCountPerHour(
    trafficPropagationResults: TTrafficSimulationResult
  ): Map<string, Map<string, number>> {
    const serviceRequestCountsPerHour = new Map<string, Map<string, number>>();

    for (const [day, dailyStats] of trafficPropagationResults.entries()) {
      for (const [hour, hourlyStats] of dailyStats.entries()) {
        const key = `${day}-${hour}`;
        if (!serviceRequestCountsPerHour.has(key)) {
          serviceRequestCountsPerHour.set(key, new Map());
        }
        const serviceMap = serviceRequestCountsPerHour.get(key)!;

        for (const [endpointId, stats] of hourlyStats.entries()) {
          const serviceId = this.extractServiceIdFromEndpointId(endpointId);
          const prevCount = serviceMap.get(serviceId) || 0;
          serviceMap.set(serviceId, prevCount + stats.requestCount);
        }
      }
    }

    return serviceRequestCountsPerHour;
  }

  private simulateTrafficWithBaseErrorRates(
    dependOnMap: Map<string, Set<string>>,
    hourlyRequestCountsForEachDayMap: Map<string, number[][]>,
    latencyMap: Map<string, number>,
    errorRateMap: Map<string, number>
  ): TTrafficSimulationResult {

    const results: TTrafficSimulationResult = new Map();

    console.log(hourlyRequestCountsForEachDayMap)
    for (const [entryPointId, dailyHourlyCounts] of hourlyRequestCountsForEachDayMap.entries()) {
      for (let day = 0; day < dailyHourlyCounts.length; day++) {
        const hourlyCounts = dailyHourlyCounts[day];
        for (let hour = 0; hour < 24; hour++) {
          const count = hourlyCounts[hour];
          if (count <= 0) continue;

          const { stats } = this.simulateTrafficPropagationFromSingleEntry(
            entryPointId,
            count,
            dependOnMap,
            latencyMap,
            errorRateMap
          );
          console.log("errorRateMap", errorRateMap)

          if (!results.has(day)) {
            results.set(day, new Map());
          }
          const dailyStats: TDailyTrafficStatsMap = results.get(day)!;
          if (!dailyStats.has(hour)) {
            dailyStats.set(hour, new Map());
          }
          const hourlyStats: THourlyTrafficStatsMap = dailyStats.get(hour)!;


          for (const [targetEndpointId, stat] of stats.entries()) {
            if (!hourlyStats.has(targetEndpointId)) {
              hourlyStats.set(targetEndpointId, {
                requestCount: 0,
                errorCount: 0,
                maxLatency: 0
              });
            }
            const existingStats = hourlyStats.get(targetEndpointId)!;
            existingStats.requestCount += stat.requestCount;
            existingStats.errorCount += stat.errorCount;
            existingStats.maxLatency = Math.max(existingStats.maxLatency, stat.maxLatency);
            console.log(hourlyStats.get(targetEndpointId))
          }
        }
      }
    }
    return results;
  }

  private simulateTrafficWithAdjustedErrorRates(
    dependOnMap: Map<string, Set<string>>,
    hourlyRequestCountsForEachDayMap: Map<string, number[][]>,
    latencyMap: Map<string, number>,
    adjustedErrorRatePerHour: Map<string, Map<string, number>>
  ): TTrafficSimulationResult {

    const results: TTrafficSimulationResult = new Map();

    for (const [entryPointId, dailyHourlyCounts] of hourlyRequestCountsForEachDayMap.entries()) {
      for (let day = 0; day < dailyHourlyCounts.length; day++) {
        const hourlyCounts = dailyHourlyCounts[day];
        for (let hour = 0; hour < 24; hour++) {
          const count = hourlyCounts[hour];
          if (count <= 0) continue;

          const dayHour = `${day}-${hour}`;

          // Get the adjusted error rate of all endpoints in a specific hour
          const errorRateMapForHour = adjustedErrorRatePerHour.get(dayHour) || new Map();

          const { stats } = this.simulateTrafficPropagationFromSingleEntry(
            entryPointId,
            count,
            dependOnMap,
            latencyMap,
            errorRateMapForHour
          );
          console.log("errorRateMapForHour ", errorRateMapForHour)

          if (!results.has(day)) {
            results.set(day, new Map());
          }
          const dailyStats: TDailyTrafficStatsMap = results.get(day)!;
          if (!dailyStats.has(hour)) {
            dailyStats.set(hour, new Map());
          }
          const hourlyStats: THourlyTrafficStatsMap = dailyStats.get(hour)!;


          for (const [targetEndpointId, stat] of stats.entries()) {
            if (!hourlyStats.has(targetEndpointId)) {
              hourlyStats.set(targetEndpointId, {
                requestCount: 0,
                errorCount: 0,
                maxLatency: 0
              });
            }
            const existingStats = hourlyStats.get(targetEndpointId)!;
            existingStats.requestCount += stat.requestCount;
            existingStats.errorCount += stat.errorCount;
            existingStats.maxLatency = Math.max(existingStats.maxLatency, stat.maxLatency);
            console.log(hourlyStats.get(targetEndpointId))
          }
        }
      }
    }
    return results;
  }

  private generateAdjustedEndpointErrorRatePerHour(
    serviceRequestCountsPerHour: Map<string, Map<string, number>>,
    basicErrorRateMap: Map<string, number>,
    replicaCountList: TReplicaCount[],
    replicaMaxQPS: number = 1 // Maximum throughput per second for a single service replica. If the requests per second exceed this value, the service is considered overloaded.
  ): Map<string, Map<string, number>> {

    // serviceId => replica count
    const replicaCountMap = new Map<string, number>();
    for (const replicaInfo of replicaCountList) {
      replicaCountMap.set(replicaInfo.uniqueServiceName, replicaInfo.replicas);
    }

    // endpointId => serviceId
    const endpointToServiceMap = new Map<string, string>();
    for (const endpointId of basicErrorRateMap.keys()) {
      const serviceId = endpointId.split('\t').slice(0, 3).join('\t');
      endpointToServiceMap.set(endpointId, serviceId);
    }

    // Final result: Map<dayHour, Map<endpointId, adjustedErrorRate>>
    const adjustedErrorRatePerHour = new Map<string, Map<string, number>>();

    for (const [dayHour, serviceCounts] of serviceRequestCountsPerHour.entries()) {
      const adjustedMap = new Map<string, number>();

      for (const [endpointId, baseErrorRate] of basicErrorRateMap.entries()) {
        const serviceId = endpointToServiceMap.get(endpointId)!;

        // Get request count for the service in this hour
        const requestCountPerHour = serviceCounts.get(serviceId) ?? 0;
        const requestCountPerSecond = requestCountPerHour / 3600;

        const replicaCount = replicaCountMap.get(serviceId) ?? 1;

        const adjustedErrorRate = this.estimateErrorRateWithServiceOverload(
          requestCountPerSecond,
          replicaCount,
          replicaMaxQPS,
          baseErrorRate
        );

        adjustedMap.set(endpointId, adjustedErrorRate);
      }

      adjustedErrorRatePerHour.set(dayHour, adjustedMap);
    }

    return adjustedErrorRatePerHour;
  }

  private generateRealtimeDataFromSimulationResults(
    baseDataMap: Map<string, TBaseDataWithResponses>,
    trafficPropagationResults: TTrafficSimulationResult,
    simulateDate: number
  ): Map<string, TCombinedRealtimeData[]> {
    const realtimeDataPerHour = new Map<string, TCombinedRealtimeData[]>(); // key: "day-hour"

    for (const [day, dailyStats] of trafficPropagationResults.entries()) {
      for (const [hour, hourlyStats] of dailyStats.entries()) {
        const combinedList: TCombinedRealtimeData[] = [];

        for (const [endpointId, stats] of hourlyStats.entries()) {
          const baseDataWithResp = baseDataMap.get(endpointId);
          if (!baseDataWithResp) continue;

          const { baseData, responses } = baseDataWithResp;
          const timestampMicro = (simulateDate + day * 86400_000 + hour * 3600_000) * 1000;


          const successCount = stats.requestCount - stats.errorCount;
          const errorCount = stats.errorCount;

          if (successCount > 0) {
            const resp2xx = responses?.find(r => String(r.status).startsWith("2"));
            combinedList.push({
              uniqueServiceName: baseData.uniqueServiceName,
              uniqueEndpointName: baseData.uniqueEndpointName,
              latestTimestamp: timestampMicro,
              method: baseData.method,
              service: baseData.service,
              namespace: baseData.namespace,
              version: baseData.version,
              requestBody: baseData.requestBody,
              requestContentType: baseData.requestContentType,
              responseBody: resp2xx?.responseBody,
              responseContentType: resp2xx?.responseContentType,
              requestSchema: undefined,
              responseSchema: undefined,
              avgReplica: baseData.replica,
              combined: successCount,
              status: String(resp2xx?.status ?? "200"),
              latency: this.computeLatencyCV(stats.maxLatency, successCount),
            });
          }

          if (errorCount > 0) {
            const resp5xx = responses?.find(r => String(r.status).startsWith("5"));
            combinedList.push({
              uniqueServiceName: baseData.uniqueServiceName,
              uniqueEndpointName: baseData.uniqueEndpointName,
              latestTimestamp: timestampMicro,
              method: baseData.method,
              service: baseData.service,
              namespace: baseData.namespace,
              version: baseData.version,
              requestBody: baseData.requestBody,
              requestContentType: baseData.requestContentType,
              responseBody: resp5xx?.responseBody,
              responseContentType: resp5xx?.responseContentType,
              requestSchema: undefined,
              responseSchema: undefined,
              avgReplica: baseData.replica,
              combined: errorCount,
              status: String(resp5xx?.status ?? "500"),
              latency: this.computeLatencyCV(stats.maxLatency, errorCount),
            });
          }
        }
        realtimeDataPerHour.set(`${day}-${hour}`, combinedList);
      }
    }
    return realtimeDataPerHour;
  }

  // Randomly distribute the total daily request count across each hour of the day
  private distributeDailyRequestToEachHours(realRequestCountForThisday: number): number[] {
    if (realRequestCountForThisday === 0) {
      return new Array(24).fill(0);;
    }

    // Generate random request count weights for 24 hours
    const weights = Array.from({ length: 24 }, () => Math.random());
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    const normalizeWeights = weights.map(w => w / totalWeight);
    const hourlyRequestCountsForThisDay: number[] =
      normalizeWeights.map(w => Math.round(w * realRequestCountForThisday));

    // Fix rounding error
    let diff = realRequestCountForThisday
      - hourlyRequestCountsForThisDay.reduce((a, b) => a + b, 0);
    if (diff !== 0) {// fix rounding error
      const indices = Array.from({ length: 24 }, (_, i) => i);
      indices.sort((a, b) => normalizeWeights[b] - normalizeWeights[a]);
      let i = 0;
      while (diff !== 0) {
        const index = indices[i % 24];

        if (diff > 0) {
          hourlyRequestCountsForThisDay[index]++;
          diff--;
        } else if (diff < 0) {
          const allZero = hourlyRequestCountsForThisDay.every(count => count === 0);
          if (allZero) {
            break;
          }
          if (hourlyRequestCountsForThisDay[index] > 0) {
            hourlyRequestCountsForThisDay[index]--;
            diff++;
          }
        }
        i++;
      }
    }
    return hourlyRequestCountsForThisDay;
  }

  private simulateTrafficPropagationFromSingleEntry(
    entryPointId: string,
    initialRequestCount: number,
    dependencyGraph: Map<string, Set<string>>,
    latencyMap: Map<string, number>,
    errorRateMap: Map<string, number>,
  ): {
    entryPointId: string;
    stats: Map<string, { requestCount: number; errorCount: number; maxLatency: number }>;
  } {
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
      const children = dependencyGraph.get(endpointId);
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

  private extractServiceIdFromEndpointId(endpointId: string): string {
    const parts = endpointId.split('\t');
    return parts.slice(0, 3).join('\t');
  }

  private estimateErrorRateWithServiceOverload(
    requestCountPerSecond: number,
    replicaCount: number,
    replicaMaxQPS: number,
    baseErrorRate: number,
  ): number {
    const capacity = replicaCount * replicaMaxQPS; // Total system processing capacity (requests per second)

    const utilization = requestCountPerSecond / capacity; // System utilization (load ratio)
    // console.log("----------")
    //   console.log("requestCountPerSecond", requestCountPerSecond)
    // console.log(` replicas: ${replicaCount}`)
    //  console.log(` capacity: ${capacity}`)
    console.log(` utilization: ${utilization}`)
    if (utilization <= 1) {
      // When the system is not overloaded, the error rate remains at the baseline error rate.
      return baseErrorRate;
    }

    const overloadFactor = utilization - 1; // Overload ratio (the portion where utilization exceeds 1)

    // Additional error rate caused by overload, calculated using an exponential model.
    // The coefficient 3 in the exponential function controls how quickly the error rate increases.
    // (TODO)This is a temporary value; a more realistic model will be tested and applied in the future.
    const serviceOverloadErrorRate = 1 - Math.exp(-3 * overloadFactor);

    // Total error rate = base error rate + remaining available error rate * overload-induced error rate
    // (Overload-induced errors only affect requests that were originally successful, hence (1 - baseErrorRate) is used)
    const totalErrorRate = baseErrorRate + (1 - baseErrorRate) * serviceOverloadErrorRate;

    return Math.min(1, totalErrorRate);
  }

  private computeLatencyCV(
    baseLatency: number,
    count: number
  ): { scaledMean: number; scaledDivBase: number; cv: number; scaleLevel: number } {
    if (count <= 0) return { scaledMean: 0, scaledDivBase: 0, cv: 0, scaleLevel: 0 };

    // Generate jittered latencies
    const latencies: number[] = [];
    for (let i = 0; i < count; i++) {
      // Apply ±10% random fluctuation around baseLatency
      const jittered = Math.round(baseLatency * (0.9 + Math.random() * 0.2));
      latencies.push(jittered);
    }

    // Calculate scaleFactor and scaleLevel based on the range of latencies
    const { scaleFactor, scaleLevel } = this.calculateScaleFactor(latencies);

    // Apply the same scaling factor to all latency samples
    const scaled = latencies.map(l => l / scaleFactor);

    // Compute mean and sum of squares (divBase) on the scaled values
    const sum = scaled.reduce((s, v) => s + v, 0);
    const mean = sum / count;
    const divBase = scaled.reduce((s, v) => s + v * v, 0);

    // Compute variance and coefficient of variation (CV)
    const variance = divBase / count - mean * mean;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;

    return {
      scaledMean: Utils.ToPrecise(mean),
      scaledDivBase: Utils.ToPrecise(divBase),
      cv: Utils.ToPrecise(cv),
      scaleLevel
    };
  }

  private calculateScaleFactor(latencies: number[]): { scaleFactor: number; scaleLevel: number } {
    if (latencies.length === 0) return { scaleFactor: 1, scaleLevel: 0 };
    const minLatency = Math.min(...latencies);
    const maxLatency = Math.max(...latencies);
    if (minLatency <= 0 || maxLatency <= 0) return { scaleFactor: 1, scaleLevel: 0 };
    const minExp = Math.floor(Math.log10(minLatency));
    const maxExp = Math.floor(Math.log10(maxLatency));
    if (maxExp > 0) {
      return { scaleFactor: Math.pow(10, maxExp), scaleLevel: maxExp };
    } else if (minExp < 0) {
      return { scaleFactor: Math.pow(10, minExp), scaleLevel: minExp };
    }
    return { scaleFactor: 1, scaleLevel: 0 };
  }
}