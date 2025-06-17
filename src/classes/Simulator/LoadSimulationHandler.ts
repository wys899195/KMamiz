import {
  TSimulationServiceMetric,
  TSimulationEndpointMetric,
  TLoadSimulation,
  TLoadSimulationConfig
} from "../../entities/TSimulationConfig";
import {
  TBaseDataWithResponses,
  TEndpointTrafficStats,
} from "../../entities/TLoadSimulation";
import { TReplicaCount } from "../../entities/TReplicaCount";
import { TCombinedRealtimeData } from "../../entities/TCombinedRealtimeData";

import LoadSimulationDataGenerator from "./LoadSimulationDataGenerator";
import LoadSimulationPropagator from "./LoadSimulationPropagator";


export default class LoadSimulationHandler {
  private static instance?: LoadSimulationHandler;
  static getInstance = () => this.instance || (this.instance = new this());

  private dataGenerator: LoadSimulationDataGenerator;
  private propagator: LoadSimulationPropagator;

  private constructor() {
    this.dataGenerator = new LoadSimulationDataGenerator();
    this.propagator = new LoadSimulationPropagator();
  }

  generateMinuteCombinedRealtimeDataMap(
    loadSimulationSettings: TLoadSimulation,
    dependOnMap: Map<string, Set<string>>,
    replicaCountList: TReplicaCount[],
    EndpointRealTimeBaseDatas: Map<string, TBaseDataWithResponses>,
    simulateDate: number
  ): Map<string, TCombinedRealtimeData[]> {
    const serviceMetrics: TSimulationServiceMetric[] = loadSimulationSettings.serviceMetrics;
    const endpointMetrics: TSimulationEndpointMetric[] = loadSimulationSettings.endpointMetrics;
    const {
      entryEndpointDailyRequestCountsMap,   // Key: endpointId, Value: Map where Key is "day-hour-minute" and Value is request count
      latencyMap,                           // Key: endpointId, Value: Latency in milliseconds (>= 0)
      errorRateMap: basicErrorRateMap       // Key: endpointId, Value: Error rate (in [0,1], i.e., percentage / 100)
    } = this.getTrafficMap(endpointMetrics, loadSimulationSettings.config);

    // Use the basic error rate to simulate traffic propagation and calculate the 
    // expected incoming traffic for each service under normal (non-overloaded) conditions
    // propagationResultsWithBasicError: Map<Key: "day-hour-minute", Value: Map< key: endpointId, value:requestCount>>
    const propagationResultsWithBasicError = this.propagator.simulatePropagationWithBaseErrorRates(
      dependOnMap,
      entryEndpointDailyRequestCountsMap,
      latencyMap,
      basicErrorRateMap,
    );

    // Estimate overload level for each service based on expected incoming traffic, the number of replicas, and per-replica throughput capacity  
    // Then combine with base error rate to calculate the adjusted error rate per endpoint, per minute  
    const serviceReceivedRequestCount = this.aggregateServiceRequestCount(propagationResultsWithBasicError);
    console.log("serviceReceivedRequestCount", serviceReceivedRequestCount)
    const adjustedErrorRateResult = this.generateAdjustedEndpointErrorRate(
      serviceReceivedRequestCount,
      basicErrorRateMap,
      replicaCountList,
      serviceMetrics
    )
    console.log("adjustedErrorRateResult", adjustedErrorRateResult)
    // Re-run traffic propagation with adjusted error rates  
    // to obtain actual traffic distribution considering both "base errors" and "overload-induced errors"
    const propagationResultsWithOverloadError = this.propagator.simulatePropagationWithAdjustedErrorRates(
      dependOnMap,
      entryEndpointDailyRequestCountsMap,
      latencyMap,
      adjustedErrorRateResult,
    );

    const realtimeCombinedDataPerMinuteMap: Map<string, TCombinedRealtimeData[]> = this.dataGenerator.generateRealtimeDataFromSimulationResults(
      EndpointRealTimeBaseDatas,
      propagationResultsWithOverloadError,
      simulateDate
    );
    return realtimeCombinedDataPerMinuteMap;
  }

  private getTrafficMap(
    endpointMetrics: TSimulationEndpointMetric[],
    loadSimulationConfig?: TLoadSimulationConfig
  ): {
    // Key: endpointId of entry point(in simulation config), Value: Map where Key is "day-hour-minute" and Value is request count
    entryEndpointDailyRequestCountsMap: Map<string, Map<string, number>>;
    latencyMap: Map<string, number>;     // Key: endpointId, Value: Latency in milliseconds (>= 0)
    errorRateMap: Map<string, number>;   // Key: endpointId, Value: Error rate (in [0,1], i.e., percentage / 100)
  } {
    const entryEndpointDailyRequestCountsMap = new Map<string, Map<string, number>>();
    const latencyMap = new Map<string, number>();
    const errorRateMap = new Map<string, number>();

    if (!endpointMetrics) {
      return { entryEndpointDailyRequestCountsMap, latencyMap, errorRateMap };
    }

    const simulationDurationInDays = loadSimulationConfig?.simulationDurationInDays ?? 1;
    const mutationRatePercentage = loadSimulationConfig?.mutationRatePercentage ?? 25;
    const MUTATION_SCALE_FACTORS = [0.25, 0.5, 2, 3, 4, 5];
    const probabilityOfMutation = mutationRatePercentage / 100;


    for (const metric of endpointMetrics) {
      const endpointId = metric.endpointId;

      // latencyMap
      const latencyMs = metric.latencyMs ?? 0;
      latencyMap.set(endpointId, latencyMs);

      // errorRateMap
      const errorRate = (metric.errorRatePercentage ?? 0) / 100;
      errorRateMap.set(endpointId, errorRate);

      // Request Counts for Each Day
      // Map to store request counts for this specific endpoint across all simulated "day-hour-minute" intervals
      // e.g., for the 3rd day, the count at 11:00 AM (11:00-11:09 interval) would be stored with the key "2-11-0" in the map.
      const baseDailyRequestCount = metric.expectedExternalDailyRequestCount ?? 0;
      if (baseDailyRequestCount === 0) continue;
      const RequestCountsMap = new Map<string, number>();

      // minimumIntervalMinutes: Minimum time interval length (in minutes, and must be a divisor of 60).
      // For example, if set to 5, data will be generated every 5 minutes.


      for (let day = 0; day < simulationDurationInDays; day++) {
        const isMutated = Math.random() < probabilityOfMutation;
        const mutationScaleRate = isMutated
          ? MUTATION_SCALE_FACTORS[Math.floor(Math.random() * MUTATION_SCALE_FACTORS.length)]
          : 1;

        const realRequestCountForThisday = Math.round(
          baseDailyRequestCount * mutationScaleRate
        );

        this.updateRequestCountsMap(RequestCountsMap, day, realRequestCountForThisday);
      }

      entryEndpointDailyRequestCountsMap.set(endpointId, RequestCountsMap);
    }

    return { entryEndpointDailyRequestCountsMap: entryEndpointDailyRequestCountsMap, latencyMap, errorRateMap };
  }

  private aggregateServiceRequestCount(
    trafficPropagationResults: Map<string, Map<string, TEndpointTrafficStats>>
  ): Map<string, Map<string, number>> {
    /*
     * This Map aggregates the total request counts for each service at specific time intervals.
     *
     * Top-level Map:
     * Key:   string - A timestamp key in "day-hour-minute" format (e.g., "0-10-30"), representing the start of a specific time interval.
     * Value: Map<string, number> - Total request counts for each service during this time interval.
     *
     * Inner Map (Value of Top-level Map):
     * Key:   string - The unique ID of a service (serviceId).
     * Value: number - The aggregated request count for that specific service during the time interval.
     */
    const serviceRequestCountsPerMinute = new Map<string, Map<string, number>>();

    for (const [dayHourMinuteKey, minuteStats] of trafficPropagationResults.entries()) {
      if (!serviceRequestCountsPerMinute.has(dayHourMinuteKey)) {
        serviceRequestCountsPerMinute.set(dayHourMinuteKey, new Map());
        const serviceMap = serviceRequestCountsPerMinute.get(dayHourMinuteKey)!;
        for (const [endpointId, stats] of minuteStats.entries()) {
          const serviceId = this.extractServiceIdFromEndpointId(endpointId);
          const prevCount = serviceMap.get(serviceId) || 0;
          serviceMap.set(serviceId, prevCount + stats.requestCount);
        }
      }
    }

    return serviceRequestCountsPerMinute;
  }

  private generateAdjustedEndpointErrorRate(
    serviceRequestCounts: Map<string, Map<string, number>>,
    basicErrorRateMap: Map<string, number>,
    replicaCountList: TReplicaCount[],
    serviceMetrics: TSimulationServiceMetric[],
  ): Map<string, Map<string, number>> {
    /*
    return Map: 
      -key:"day-hour-minute" 
      -value:
        -key:endpointID
        -value:errorRates
    */

    // Map :serviceId => replica count
    const replicaCountMap = new Map<string, number>();
    for (const replicaInfo of replicaCountList) {
      replicaCountMap.set(replicaInfo.uniqueServiceName, replicaInfo.replicas);
    }

    // Map :endpointId => serviceId
    const endpointToServiceMap = new Map<string, string>();
    for (const endpointId of basicErrorRateMap.keys()) {
      const serviceId = endpointId.split('\t').slice(0, 3).join('\t');
      endpointToServiceMap.set(endpointId, serviceId);
    }

    // Map: serviceId => capacity per replica
    const serviceCapacityMap = new Map<string, number>();
    for (const metric of serviceMetrics) {
      for (const version of metric.versions) {
        if (version.serviceId) {
          serviceCapacityMap.set(version.serviceId, version.capacityPerReplica);
        }
      }
    }

    // Final result: Map<day-hour-minute, Map<endpointId, adjustedErrorRate>>
    const adjustedErrorRatePerMinute = new Map<string, Map<string, number>>();

    for (const [dayHourMinuteKey, serviceCounts] of serviceRequestCounts.entries()) {
      const adjustedMap = new Map<string, number>();

      for (const [endpointId, baseErrorRate] of basicErrorRateMap.entries()) {
        const serviceId = endpointToServiceMap.get(endpointId)!;

        // Get request count for the service in this hour
        const requestCountPerMinute = serviceCounts.get(serviceId) ?? 0;
        const requestCountPerSecond = requestCountPerMinute / 60;

        const replicaCount = replicaCountMap.get(serviceId) ?? 1;
        const replicaMaxRPS = serviceCapacityMap.get(serviceId) ?? 1;

        const adjustedErrorRate = this.estimateErrorRateWithServiceOverload({
          requestCountPerSecond,
          replicaCount,
          replicaMaxRPS,
          baseErrorRate
        });

        adjustedMap.set(endpointId, adjustedErrorRate);
      }

      adjustedErrorRatePerMinute.set(dayHourMinuteKey, adjustedMap);
    }

    return adjustedErrorRatePerMinute;
  }

  // Randomly distribute the total daily request count and update to RequestCountsMap
  private updateRequestCountsMap(
    RequestCountsMap: Map<string, number>,
    day: number,
    realRequestCountForThisDay: number,
  ) {

    const totalIntervals = 24;

    if (realRequestCountForThisDay === 0) {
      return;
    }

    // Generate random request count weights
    const weights = Array.from({ length: totalIntervals }, () => Math.random());
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    const normalizeWeights = weights.map(w => w / totalWeight);

    const flatRequestCounts: number[] = normalizeWeights.map(
      w => Math.round(w * realRequestCountForThisDay)
    );

    // Fix rounding error
    let diff = realRequestCountForThisDay -
      flatRequestCounts.reduce((a, b) => a + b, 0);

    if (diff !== 0) {
      const indices = Array.from({ length: totalIntervals }, (_, i) => i);
      indices.sort((a, b) => normalizeWeights[b] - normalizeWeights[a]);
      let i = 0;
      while (diff !== 0) {
        const index = indices[i % totalIntervals];

        if (diff > 0) {
          flatRequestCounts[index]++;
          diff--;
        } else if (diff < 0) {
          const allZero = flatRequestCounts.every(count => count === 0);
          if (allZero) {
            break;
          }
          if (flatRequestCounts[index] > 0) {
            flatRequestCounts[index]--;
            diff++;
          }
        }
        i++;
      }
    }

    // Convert time intervals with request counts into a Map, with keys formatted as "day-hour-minuteStart"
    for (let intervalIndex = 0; intervalIndex < totalIntervals; intervalIndex++) {
      const count = flatRequestCounts[intervalIndex];
      if (count > 0) {
        const hour = intervalIndex;

        // Create key in the format "day-hour-minute"
        const key = `${day}-${hour}-0`;
        RequestCountsMap.set(key, count);
      }
    }
    return;
  }

  private extractServiceIdFromEndpointId(endpointId: string): string {
    const parts = endpointId.split('\t');
    return parts.slice(0, 3).join('\t');
  }

  private estimateErrorRateWithServiceOverload(data: {
    requestCountPerSecond: number,
    replicaCount: number,
    replicaMaxRPS: number,
    baseErrorRate: number,
  }): number {
    const capacity = data.replicaCount * data.replicaMaxRPS; // Total system processing capacity (requests per second)

    if (capacity === 0) {
      // If there's no capacity, the service cannot handle any request.
      // Consider this as a full failure (100% error rate).
      return 1;
    }

    const utilization = data.requestCountPerSecond / capacity; // System utilization (load ratio)
    // console.log("----------")
    //   console.log("requestCountPerSecond", requestCountPerSecond)
    // console.log(` replicas: ${replicaCount}`)
    //  console.log(` capacity: ${capacity}`)
    // console.log(` utilization: ${utilization}`)
    if (utilization <= 1) {
      // When the system is not overloaded, the error rate remains at the baseline error rate.
      return data.baseErrorRate;
    }

    const overloadFactor = utilization - 1; // Overload ratio (the portion where utilization exceeds 1)

    // Additional error rate caused by overload, calculated using an exponential model.
    // The coefficient 3 in the exponential function controls how quickly the error rate increases.
    // (TODO)This is a temporary value; a more realistic model will be tested and applied in the future.
    const serviceOverloadErrorRate = 1 - Math.exp(-3 * overloadFactor);

    // Total error rate = base error rate + remaining available error rate * overload-induced error rate
    // (Overload-induced errors only affect requests that were originally successful, hence (1 - baseErrorRate) is used)
    const totalErrorRate = data.baseErrorRate + (1 - data.baseErrorRate) * serviceOverloadErrorRate;

    return Math.min(1, totalErrorRate);
  }
}