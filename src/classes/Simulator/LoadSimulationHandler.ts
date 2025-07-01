import {
  TSimulationServiceMetric,
  TSimulationEndpointMetric,
  TLoadSimulation,
  TLoadSimulationConfig,
  TFallbackStrategy
} from "../../entities/TSimulationConfig";
import {
  TBaseDataWithResponses,
  TEndpointPropagationStatsForOneTimeSlot,
} from "../../entities/TLoadSimulation";
import { TReplicaCount } from "../../entities/TReplicaCount";
import { TCombinedRealtimeData } from "../../entities/TCombinedRealtimeData";

import LoadSimulationDataGenerator from "./LoadSimulationDataGenerator";
import LoadSimulationPropagator from "./LoadSimulationPropagator";


export default class LoadSimulationHandler {
  private static instance?: LoadSimulationHandler;
  static getInstance = () => this.instance || (this.instance = new this());

  private static readonly MUTATION_SCALE_FACTORS = [0.25, 0.5, 2, 3, 4, 5];

  private dataGenerator: LoadSimulationDataGenerator;
  private propagator: LoadSimulationPropagator;

  private constructor() {
    this.dataGenerator = new LoadSimulationDataGenerator();
    this.propagator = new LoadSimulationPropagator();
  }

  generateCombinedRealtimeDataMap(
    loadSimulationSettings: TLoadSimulation,
    dependOnMap: Map<string, Set<string>>,
    basicReplicaCountList: TReplicaCount[],
    EndpointRealTimeBaseDatas: Map<string, TBaseDataWithResponses>,
    simulateDate: number
  ): Map<string, TCombinedRealtimeData[]> {
    const serviceMetrics: TSimulationServiceMetric[] = loadSimulationSettings.serviceMetrics;
    const endpointMetrics: TSimulationEndpointMetric[] = loadSimulationSettings.endpointMetrics;
    const {
      entryEndpointRequestCountsMapByTimeSlot,  // Key: day-hour-minute, Value: Map where Key is endpointId and Value is request count
      replicaCountPerTimeSlot,                  // key: day-hour-minute, value: replica counts for each service in the specific time slot
      latencyMap,                               // Key: endpointId, Value: Latency in milliseconds (>= 0)
      errorRateMap: basicErrorRateMap,          // Key: endpointId, Value: Error rate (in [0,1], i.e., percentage / 100)
      fallbackStrategyMap
    } = this.getTrafficMap(basicReplicaCountList, endpointMetrics, loadSimulationSettings.config);

    // Use the basic error rate to simulate traffic propagation and calculate the 
    // expected incoming traffic for each service under normal (non-overloaded) conditions
    // propagationResultsWithBasicError: Map<Key: "day-hour-minute", Value: Map< key: endpointId, value:requestCount>>
    const propagationResultsWithBasicError = this.propagator.simulatePropagationToEstimateLoad(
      dependOnMap,
      entryEndpointRequestCountsMapByTimeSlot,
      latencyMap,
      basicErrorRateMap,
      fallbackStrategyMap,
    );

    // Estimate overload level for each service based on expected incoming traffic, the number of replicas, and per-replica throughput capacity  
    // Then combine with base error rate to calculate the adjusted error rate per endpoint, per timeSlot
    const serviceReceivedRequestCount = this.computeRequestCountsPerServicePerTimeSlot(propagationResultsWithBasicError);
    // console.log("serviceReceivedRequestCount", serviceReceivedRequestCount)

    const adjustedErrorRateResult = this.generateAdjustedEndpointErrorRate(
      serviceReceivedRequestCount,
      basicErrorRateMap,
      replicaCountPerTimeSlot,
      serviceMetrics
    )
    // console.log("adjustedErrorRateResult", adjustedErrorRateResult)

    // Re-run traffic propagation with adjusted error rates  
    // to obtain actual traffic distribution considering both "base errors" and "overload-induced errors"
    const propagationResultsWithOverloadError = this.propagator.simulatePropagationWithAdjustedErrorRates(
      dependOnMap,
      entryEndpointRequestCountsMapByTimeSlot,
      latencyMap,
      adjustedErrorRateResult,
      fallbackStrategyMap,
    );

    // console.log("propagationResultsWithOverloadError =")
    // for (const [timeKey, endpointMap] of propagationResultsWithOverloadError.entries()) {
    //   console.log(`Time: ${timeKey}`);
    //   for (const [endpointId, stats] of endpointMap.entries()) {
    //     console.log(`  Endpoint: ${endpointId}`);
    //     console.log(`    requestCount: ${stats.requestCount}`);
    //     console.log(`    ownErrorCount: ${stats.ownErrorCount}`);
    //     console.log(`    downstreamErrorCount: ${stats.downstreamErrorCount}`);
    //     console.log(`    latencyStatsByStatus:`);
    //     for (const [status, latencyStats] of stats.latencyStatsByStatus.entries()) {
    //       console.log(`      Status ${status}: mean=${latencyStats.mean}, cv=${latencyStats.cv}`);
    //     }
    //   }
    // }
    // console.log("end propagationResultsWithOverloadError  ==================")

    const realtimeCombinedDataPerTimeSlotMap: Map<string, TCombinedRealtimeData[]> = this.dataGenerator.generateRealtimeDataFromSimulationResults(
      EndpointRealTimeBaseDatas,
      propagationResultsWithOverloadError,
      simulateDate
    );
    return realtimeCombinedDataPerTimeSlotMap;
  }

  private getTrafficMap(
    basicReplicaCountList: TReplicaCount[],
    endpointMetrics: TSimulationEndpointMetric[],
    loadSimulationConfig?: TLoadSimulationConfig
  ): {
    entryEndpointRequestCountsMapByTimeSlot: Map<string, Map<string, number>>; // Key: day-hour-minute, Value: Map where Key is endpointId and Value is request count
    replicaCountPerTimeSlot: Map<string, TReplicaCount[]> // key: day-hour-minute, value: replica counts for each service in the specific time slot
    latencyMap: Map<string, number>;          // Key: endpointId, Value: Latency in milliseconds (>= 0)
    errorRateMap: Map<string, number>;        // Key: endpointId, Value: Error rate (in [0,1], i.e., percentage / 100)
    fallbackStrategyMap: Map<string, TFallbackStrategy>; // Key: endpointId, Value: fallback strategy for the endpoint
  } {
    const latencyMap = new Map<string, number>();
    const errorRateMap = new Map<string, number>();
    const fallbackStrategyMap = new Map<string, TFallbackStrategy>();
    const replicaCountPerTimeSlot: Map<string, TReplicaCount[]> = new Map();
    const entryEndpointRequestCountsMapByTimeSlot = new Map<string, Map<string, number>>();

    if (!endpointMetrics) {
      return {
        entryEndpointRequestCountsMapByTimeSlot,
        replicaCountPerTimeSlot,
        latencyMap,
        errorRateMap,
        fallbackStrategyMap
      };
    }

    const simulationDurationInDays = loadSimulationConfig?.simulationDurationInDays ?? 1;
    const probabilityOfMutation = (loadSimulationConfig?.mutationRatePercentage ?? 25) / 100;

    // Currently uses 24 intervals per day (i.e., 1-hour intervals)
    for (let day = 0; day < simulationDurationInDays; day++) {
      for (let hour = 0; hour < 24; hour++) {
        const timeSlotKey = `${day}-${hour}-0`;
        replicaCountPerTimeSlot.set(timeSlotKey, basicReplicaCountList.map(item => ({ ...item })))
      }
    }

    for (const metric of endpointMetrics) {
      const endpointId = metric.endpointId;

      // latencyMap
      const latencyMs = metric.latencyMs ?? 0;
      latencyMap.set(endpointId, latencyMs);

      // errorRateMap
      const errorRate = (metric.errorRatePercentage ?? 0) / 100;
      errorRateMap.set(endpointId, errorRate);

      // fallbackStrategyMap
      const fallbackStrategy = metric.fallbackStrategy;
      fallbackStrategyMap.set(endpointId, fallbackStrategy);

      // Request Counts for Each Day
      // Map to store request counts for this specific endpoint across all simulated "day-hour-minute" intervals
      const baseDailyRequestCount = metric.expectedExternalDailyRequestCount ?? 0;
      if (baseDailyRequestCount === 0) continue;

      // Currently uses 24 intervals per day (i.e., 1-hour intervals)
      for (let day = 0; day < simulationDurationInDays; day++) {

        const realRequestCountForThisDay = Math.round(baseDailyRequestCount);

        this.updateRequestCountsMapByTimeSlot(
          entryEndpointRequestCountsMapByTimeSlot,
          day,
          endpointId,
          realRequestCountForThisDay,
          probabilityOfMutation
        );
      }
    }

    return {
      entryEndpointRequestCountsMapByTimeSlot,
      replicaCountPerTimeSlot,
      latencyMap,
      errorRateMap,
      fallbackStrategyMap
    };
  }

  // Randomly distribute the total daily request count and update to RequestCountsMap
  private updateRequestCountsMapByTimeSlot(
    entryEndpointRequestCountsMapByTimeSlot: Map<string, Map<string, number>>,
    day: number,
    endpointId: string,
    realRequestCountForThisDay: number,
    probabilityOfMutation: number,
  ) {

    const totalIntervals = 24;

    if (realRequestCountForThisDay === 0) {
      return;
    }

    // Generate random request count weights
    const weights = Array.from({ length: totalIntervals }, () => Math.random());
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    const normalizedWeights = weights.map(w => w / totalWeight);


    // Multiply weights by total request count and floor the result to initially distribute requests
    const flatRequestCounts = normalizedWeights.map(w => Math.floor(w * realRequestCountForThisDay));


    // Calculate the difference that needs to be fixed
    let diff = realRequestCountForThisDay - flatRequestCounts.reduce((a, b) => a + b, 0);

    // Add the errors back sequentially to the time slots in descending order of their weights, 
    // ensuring that the total number of requests matches the original total.
    if (diff >= 1) {
      const sortedIndices = normalizedWeights
        .map((w, idx) => ({ idx, weight: w }))
        .sort((a, b) => b.weight - a.weight)
        .map(entry => entry.idx);

      let i = 0;
      while (diff >= 1) {
        const index = sortedIndices[i % totalIntervals];
        flatRequestCounts[index]++;
        diff--;
        i++;
      }
    }

    // Convert time intervals with request counts into a Map, with keys formatted as "day-hour-minute"
    // And apply per-hour mutation

    for (let hour = 0; hour < totalIntervals; hour++) {
      let count = flatRequestCounts[hour];
      if (count > 0) {
        // request count mutation
        // console.log("probabilityOfMutatio", probabilityOfMutation)
        const isMutated = Math.random() < probabilityOfMutation;
        if (isMutated) {
          const scale = LoadSimulationHandler.MUTATION_SCALE_FACTORS[Math.floor(Math.random() * LoadSimulationHandler.MUTATION_SCALE_FACTORS.length)];
          // console.log("count b",count)
          count = Math.round(count * scale);
          // console.log("count a",count)
        }

        // Create time slot key in the format "day-hour-minute"
        const timeSlotKey = `${day}-${hour}-0`;
        if (!entryEndpointRequestCountsMapByTimeSlot.has(timeSlotKey)) {
          entryEndpointRequestCountsMapByTimeSlot.set(timeSlotKey, new Map());
        }
        const endpointCountMap = entryEndpointRequestCountsMapByTimeSlot.get(timeSlotKey)!;
        endpointCountMap.set(endpointId, count);
      }
    }
    return;
  }

  private computeRequestCountsPerServicePerTimeSlot(
    propagationResultsWithBasicError: Map<string, Map<string, TEndpointPropagationStatsForOneTimeSlot>>
  ): Map<string, Map<string, number>> {
    /*
     * This Map aggregates the total request counts for each service at specific time intervals.
     *
     * Top-level Map:
     * Key:   string - A time slot key in "day-hour-minute" format (e.g., "0-10-30"), representing the start of a specific time interval.
     * Value: Map<string, number> - Total request counts for each service during this time interval.
     *
     * Inner Map (Value of Top-level Map):
     * Key:   string - The unique ID of a service (serviceId).
     * Value: number - The aggregated request count for that specific service during the time interval.
     */

    // Used to store the final statistical results. The key is the timestamp and the value 
    // is the number of requests for each service at that timestamp.
    const serviceRequestCountsPerTimeSlot = new Map<string, Map<string, number>>();

    for (const [timeSlotKey, timeSlotStats] of propagationResultsWithBasicError.entries()) {

      if (!serviceRequestCountsPerTimeSlot.has(timeSlotKey)) {
        serviceRequestCountsPerTimeSlot.set(timeSlotKey, new Map());
      }

      // Retrieve the map of services and their request counts for the current time slot
      const serviceMap = serviceRequestCountsPerTimeSlot.get(timeSlotKey)!;

      // timeSlotStats contains statistics for all endpoints during this time slot
      for (const [endpointId, stats] of timeSlotStats.entries()) {
        // Extract the service ID from the endpoint ID
        const serviceId = this.extractServiceIdFromEndpointId(endpointId);

        // Get the current aggregated count for this service, defaulting to 0 if none exists
        const prevCount = serviceMap.get(serviceId) || 0;

        // Add the current endpoint's request count to the service's total count
        serviceMap.set(serviceId, prevCount + stats.requestCount);
      }
    }

    return serviceRequestCountsPerTimeSlot;
  }

  private generateAdjustedEndpointErrorRate(
    serviceRequestCounts: Map<string, Map<string, number>>,
    /*
      serviceRequestCounts:
        -key:"day-hour-minute" 
        -value:
          -key:serviceID
          -value:requestCount
    */
    basicErrorRateMap: Map<string, number>,
    replicaCountPerTimeSlot: Map<string, TReplicaCount[]>,
    serviceMetrics: TSimulationServiceMetric[],
  ): Map<string, Map<string, number>> {
    /*
    return Map: 
      -key:"day-hour-minute" 
      -value:
        -key:endpointID
        -value:errorRates
    */


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
    const adjustedErrorRatePerTimeSlot = new Map<string, Map<string, number>>();

    for (const [timeSlotKey, serviceCounts] of serviceRequestCounts.entries()) {
      const adjustedMap = new Map<string, number>();

      // Map :serviceId => replica count
      const replicaCountList = replicaCountPerTimeSlot.get(timeSlotKey) ?? [];
      const replicaCountMap = new Map<string, number>();
      for (const replicaInfo of replicaCountList) {
        replicaCountMap.set(replicaInfo.uniqueServiceName, replicaInfo.replicas);
      }


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

      adjustedErrorRatePerTimeSlot.set(timeSlotKey, adjustedMap);
    }

    return adjustedErrorRatePerTimeSlot;
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
    // console.log("requestCountPerSecond", requestCountPerSecond)
    // console.log(` replicas: ${replicaCount}`)
    // console.log(` capacity: ${capacity}`)
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