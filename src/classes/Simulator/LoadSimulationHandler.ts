import {
  TSimulationServiceMetric,
  TSimulationEndpointMetric,
  TLoadSimulation
} from "../../entities/TSimulationConfig";
import {
  TBaseDataWithResponses,
  TTrafficSimulationResult,
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
    const simulationDurationInDays = loadSimulationSettings.config?.simulationDurationInDays ?? 1;
    const {
      minutelyRequestCountsForEachDayMap,
      latencyMap,
      errorRateMap: basicErrorRateMap
    } = this.getTrafficMap(endpointMetrics, simulationDurationInDays);

    // Use the basic error rate to simulate traffic propagation and calculate the 
    // expected incoming traffic for each service under normal (non-overloaded) conditions
    const trafficPropagationWithBasicErrorResults = this.propagator.simulatePropagationWithBaseErrorRates(
      dependOnMap,
      minutelyRequestCountsForEachDayMap,
      latencyMap,
      basicErrorRateMap,
    );

    // Estimate overload level for each service based on expected incoming traffic, the number of replicas, and per-replica throughput capacity  
    // Then combine with base error rate to calculate the adjusted error rate per endpoint, per minute  
    const serviceRequestCountsPerMinute = this.aggregateServiceRequestCountPerMinute(trafficPropagationWithBasicErrorResults);
    const generateAdjustedErrorRatePerMinuteResult = this.generateAdjustedEndpointErrorRatePerMinute(
      serviceRequestCountsPerMinute,
      basicErrorRateMap,
      replicaCountList,
      serviceMetrics
    )

    // Re-run traffic propagation with adjusted error rates  
    // to obtain actual traffic distribution considering both "base errors" and "overload-induced errors"
    const trafficPropagationWithOverloadErrorResults = this.propagator.simulatePropagationWithAdjustedErrorRates(
      dependOnMap,
      minutelyRequestCountsForEachDayMap,
      latencyMap,
      generateAdjustedErrorRatePerMinuteResult,
    );

    const realtimeCombinedDataPerMinuteMap: Map<string, TCombinedRealtimeData[]> = this.dataGenerator.generateRealtimeDataFromSimulationResults(
      EndpointRealTimeBaseDatas,
      trafficPropagationWithOverloadErrorResults,
      simulateDate
    );
    return realtimeCombinedDataPerMinuteMap;
  }

  private getTrafficMap(
    endpointMetrics: TSimulationEndpointMetric[],
    simulationDurationInDays: number,
  ): {
    minutelyRequestCountsForEachDayMap: Map<string, number[][][]>; // key: endpointId, value: dailyRequestCounts[day][hour][minute]
    latencyMap: Map<string, number>;      // latency >= 0 key:endpointId value: latencyMs
    errorRateMap: Map<string, number>;    // errorRate in [0,1] key:endpointId value: errorRatePercentage / 100
  } {
    const minutelyRequestCountsForEachDayMap = new Map<string, number[][][]>();
    const latencyMap = new Map<string, number>();
    const errorRateMap = new Map<string, number>();

    if (!endpointMetrics) {
      return { minutelyRequestCountsForEachDayMap, latencyMap, errorRateMap };
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

      // Minutely Request Counts for Each Day
      // e.g., for the 3rd day, the count at 11:05 AM is dailyRequestCounts[2][11][5]
      const baseDailyRequestCount = metric.expectedExternalDailyRequestCount ?? 0;
      if (baseDailyRequestCount === 0) continue;
      const dailyRequestCounts: number[][][] = [];

      for (let day = 0; day < simulationDurationInDays; day++) {
        const isMutated = Math.random() < PROBABILITY_OF_MUTATION;
        const mutationScaleRate = isMutated
          ? SCALE_FACTORS[Math.floor(Math.random() * SCALE_FACTORS.length)]
          : 1;

        const realRequestCountForThisday = Math.round(
          baseDailyRequestCount * mutationScaleRate
        );

        dailyRequestCounts.push(
          this.distributeDailyRequestToEachMinutes(realRequestCountForThisday)
        );
      }

      minutelyRequestCountsForEachDayMap.set(endpointId, dailyRequestCounts);
    }

    return { minutelyRequestCountsForEachDayMap: minutelyRequestCountsForEachDayMap, latencyMap, errorRateMap };
  }

  private aggregateServiceRequestCountPerMinute(
    trafficPropagationResults: TTrafficSimulationResult
  ): Map<string, Map<string, number>> {
    const serviceRequestCountsPerMinute = new Map<string, Map<string, number>>();

    for (const [day, dailyStats] of trafficPropagationResults.entries()) {
      for (const [hour, hourlyStats] of dailyStats.entries()) {
        for (const [minute, minuteStats] of hourlyStats.entries()) {
          const key = `${day}-${hour}-${minute}`;
          if (!serviceRequestCountsPerMinute.has(key)) {
            serviceRequestCountsPerMinute.set(key, new Map());
          }
          const serviceMap = serviceRequestCountsPerMinute.get(key)!;
          for (const [endpointId, stats] of minuteStats.entries()) {
            const serviceId = this.extractServiceIdFromEndpointId(endpointId);
            const prevCount = serviceMap.get(serviceId) || 0;
            serviceMap.set(serviceId, prevCount + stats.requestCount);
          }
        }
      }
    }

    return serviceRequestCountsPerMinute;
  }

  private generateAdjustedEndpointErrorRatePerMinute(
    serviceRequestCountsPerMinute: Map<string, Map<string, number>>,
    basicErrorRateMap: Map<string, number>,
    replicaCountList: TReplicaCount[],
    serviceMetrics: TSimulationServiceMetric[],
  ): Map<string, Map<string, number>> {

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

    for (const [dayHourMinuteKey, serviceCounts] of serviceRequestCountsPerMinute.entries()) {
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

  // Randomly distribute the total daily request count across each minute of the day
  private distributeDailyRequestToEachMinutes(realRequestCountForThisDay: number): number[][] {
    const hours = 24;
    const minutesPerHour = 60;
    const totalMinutes = hours * minutesPerHour;

    if (realRequestCountForThisDay === 0) {
      return Array.from({ length: hours }, () => new Array(minutesPerHour).fill(0));
    }

    // Generate random request count weights for 1440 minutes
    const weights = Array.from({ length: totalMinutes }, () => Math.random());
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    const normalizeWeights = weights.map(w => w / totalWeight);


    const flatMinuteRequestCounts: number[] =
      normalizeWeights.map(w => Math.round(w * realRequestCountForThisDay));

    // Fix rounding error
    let diff = realRequestCountForThisDay
      - flatMinuteRequestCounts.reduce((a, b) => a + b, 0);

    if (diff !== 0) {
      const indices = Array.from({ length: totalMinutes }, (_, i) => i);
      indices.sort((a, b) => normalizeWeights[b] - normalizeWeights[a]);
      let i = 0;
      while (diff !== 0) {
        const index = indices[i % totalMinutes];

        if (diff > 0) {
          flatMinuteRequestCounts[index]++;
          diff--;
        } else if (diff < 0) {
          const allZero = flatMinuteRequestCounts.every(count => count === 0);
          if (allZero) {
            break;
          }
          if (flatMinuteRequestCounts[index] > 0) {
            flatMinuteRequestCounts[index]--;
            diff++;
          }
        }
        i++;
      }
    }
    // Convert flat array [1440] to 2D array [24][60]
    const minuteRequestCounts: number[][] = [];
    for (let hour = 0; hour < hours; hour++) {
      const start = hour * minutesPerHour;
      const end = start + minutesPerHour;
      minuteRequestCounts.push(flatMinuteRequestCounts.slice(start, end));
    }


    return minuteRequestCounts;
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