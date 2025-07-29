import {
  TSimulationNamespaceServiceMetrics,
  TSimulationEndpointMetric,
  TLoadSimulationSettings,
  TLoadSimulationConfig,
  TSimulationEndpointDelay,
} from "../../../entities/simulator/TSimConfigLoadSimulation";
import {
  TBaseDataWithResponses,
  TEndpointPropagationStatsForOneTimeSlot,
  TDependOnMapWithCallProbability
} from "../../../entities/simulator/TLoadSimulation";
import { TCMetricsPerTimeSlot } from "../../../entities/simulator/TLoadSimulation";
import { TReplicaCount } from "../../../entities/TReplicaCount";
import { TCombinedRealtimeData } from "../../../entities/TCombinedRealtimeData";

import LoadSimulationDataGenerator from "./LoadSimulationDataGenerator";
import LoadSimulationPropagator from "./LoadSimulationPropagator";
import FaultInjector from "./FaultInjector";
import SimulatorUtils from "../SimulatorUtils";

export default class LoadSimulationHandler {
  private static instance?: LoadSimulationHandler;
  static getInstance = () => this.instance || (this.instance = new this());

  private dataGenerator: LoadSimulationDataGenerator;
  private propagator: LoadSimulationPropagator;
  private faultInjector: FaultInjector;

  private constructor() {
    this.dataGenerator = new LoadSimulationDataGenerator();
    this.propagator = new LoadSimulationPropagator();
    this.faultInjector = new FaultInjector();
  }

  generateCombinedRealtimeDataMap(
    loadSimulationSettings: TLoadSimulationSettings,
    dependOnMapWithCallProbability: TDependOnMapWithCallProbability,
    baseReplicaCountList: TReplicaCount[],
    EndpointRealTimeBaseDatas: Map<string, TBaseDataWithResponses>,
    simulateDate: number
  ): Map<string, TCombinedRealtimeData[]> {

    // Generate base metrics data for each service and endpoint from 
    // simulation config
    const metricsPerTimeSlotMap = this.generateBaseMetricsPerTimeSlotMap(
      loadSimulationSettings,
      baseReplicaCountList
    );

    // console.log("metricsPerTimeSlotMap origin", metricsPerTimeSlotMap);

    /*
      Inject faults before traffic propagation to ensure that both propagations 
      encounter the same fault conditions.(This is to ensure that the estimated 
      service load after the first propagation is accurate.)
    */
    this.faultInjector.injectFault(
      loadSimulationSettings,
      metricsPerTimeSlotMap
    );

    // console.log("metricsPerTimeSlotMap after faultInjector", metricsPerTimeSlotMap);

    /* 
      Use the base error rate to simulate traffic propagation and calculate the 
      expected incoming traffic for each service under normal (non-overloaded) 
      conditions propagationResultsWithBasicError: 
      Map<
        Key: "day-hour-minute", 
        Value: Map<
          key: uniqueEndpointName, 
          value:requestCount
        >
      >
    */
    const propagationResultsWithBasicError = this.propagator.simulatePropagation(
      loadSimulationSettings.endpointMetrics,
      dependOnMapWithCallProbability,
      metricsPerTimeSlotMap,
      false
    );

    /*
      Estimate overload level for each service based on expected incoming traffic, the number of replicas, and per-replica throughput capacity  
      Then combine with base error rate to calculate the adjusted error rate per endpoint, per timeSlot
    */
    const serviceReceivedRequestCount = this.computeRequestCountsPerServicePerTimeSlot(propagationResultsWithBasicError);

    this.AdjustedErrorRateByOverload(
      metricsPerTimeSlotMap,
      serviceReceivedRequestCount
    );

    // console.log("metricsPerTimeSlotMap after AdjustedErrorRateByOverload", metricsPerTimeSlotMap);

    // Re-run traffic propagation with adjusted error rates  
    // to obtain actual traffic distribution considering both "base errors" and "overload-induced errors"
    const propagationResultsWithOverloadError = this.propagator.simulatePropagation(
      loadSimulationSettings.endpointMetrics,
      dependOnMapWithCallProbability,
      metricsPerTimeSlotMap,
      true,
    );

    // console.log("propagationResultsWithOverloadError", propagationResultsWithOverloadError)

    // console.log("propagationResultsWithOverloadError =")
    // for (const [timeKey, endpointMap] of propagationResultsWithOverloadError.entries()) {
    //   console.log(`Time: ${timeKey}`);
    //   for (const [uniqueEndpointName, stats] of endpointMap.entries()) {
    //     console.log(`  Endpoint: ${uniqueEndpointName}`);
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

  private generateBaseMetricsPerTimeSlotMap(
    loadSimulationSettings: TLoadSimulationSettings,
    baseServiceReplicaCountList: TReplicaCount[],
  ): Map<string, TCMetricsPerTimeSlot> {
    /**
     * return type:
     *  key: A string representing the time slot (e.g., "day-hour-minute")
     *  value: An instance of BaseMetricsPerTimeSlot containing aggregated metrics for that time slot
     */

    // loadSimulation settings
    const serviceMetrics: TSimulationNamespaceServiceMetrics[] = loadSimulationSettings.serviceMetrics;
    const endpointMetrics: TSimulationEndpointMetric[] = loadSimulationSettings.endpointMetrics;
    const loadSimulationConfig: TLoadSimulationConfig = loadSimulationSettings.config;
    const simulationDurationInDays = loadSimulationConfig.simulationDurationInDays;

    // initial return data
    const metricsPerTimeSlotMap = new Map<string, TCMetricsPerTimeSlot>();
    for (let day = 0; day < simulationDurationInDays; day++) {
      for (let hour = 0; hour < 24; hour++) {
        const timeSlotKey = `${day}-${hour}-0`;
        metricsPerTimeSlotMap.set(timeSlotKey, new TCMetricsPerTimeSlot());
      }
    }

    // Early return if there is no traffic
    if (!endpointMetrics) {
      return metricsPerTimeSlotMap;
    }

    // construct base data maps from simulation config
    const baseEndpointDelayMap = new Map<string, TSimulationEndpointDelay>();
    const baseEndpointErrorRateMap = new Map<string, number>();
    const baseEndpointSimulationReqCountsMap = new Map<string, number[][]>();
    const baseServiceReplicaCountMap = new Map<string, number>(
      baseServiceReplicaCountList.map(item => [item.uniqueServiceName, item.replicas])
    )
    const baseServiceCapacityPerReplicaMap = new Map<string, number>();
    const timeSlotCountPerDay = 24 // Time granularity is hourly (i.e., 24 intervals per day)
    for (const metric of endpointMetrics) {
      const uniqueEndpointName = metric.uniqueEndpointName!;

      // EndpointDelay
      baseEndpointDelayMap.set(uniqueEndpointName, {
        latencyMs: metric.delay.latencyMs,
        jitterMs: metric.delay.jitterMs
      });

      // EndpointErrorRate
      baseEndpointErrorRateMap.set(uniqueEndpointName,
        (metric.errorRatePercent) / 100
      );

      // DailyRequestCount (distributed)
      const distributedDailyRequestCount: number[][] = this.distributeRequestCountsForSimulationDuration({
        expectedExternalDailyRequestCount: metric.expectedExternalDailyRequestCount,
        simulationDurationInDays,
        timeSlotCountPerDay,
      });
      baseEndpointSimulationReqCountsMap.set(uniqueEndpointName,
        distributedDailyRequestCount
      )

    }

    const transformedBaseEndpointDailyReqCounts = this.transformEndpointSimulationReqCountsMap({
      baseEndpointSimulationReqCountsMap,
      simulationDurationInDays,
      timeSlotCountPerDay
    });
    for (const ns of serviceMetrics) {
      for (const svc of ns.services) {
        for (const ver of svc.versions) {
          if (ver.uniqueServiceName) {
            baseServiceCapacityPerReplicaMap.set(ver.uniqueServiceName, ver.capacityPerReplica);
          }
        }
      }
    }

    // Update information in BaseMetricsPerTimeSlotMap using base data maps
    for (let day = 0; day < simulationDurationInDays; day++) {
      for (let hour = 0; hour < 24; hour++) {
        const timeSlotKey = `${day}-${hour}-0`;
        const metricsInThisTimeSlot = metricsPerTimeSlotMap.get(timeSlotKey)!;

        // EndpointDelay
        metricsInThisTimeSlot.setEndpointDelayMap(baseEndpointDelayMap);

        // EndpointErrorRate
        metricsInThisTimeSlot.setEndpointErrorRateMap(baseEndpointErrorRateMap);

        // DailyRequestCount (distributed)
        metricsInThisTimeSlot.setEntryPointRequestCountMap(transformedBaseEndpointDailyReqCounts[day][hour]);

        // ServiceReplicaCount
        metricsInThisTimeSlot.setServiceReplicaCountMap(baseServiceReplicaCountMap);

        // ServiceCapacityPerReplica
        metricsInThisTimeSlot.setServiceCapacityPerReplicaMap(baseServiceCapacityPerReplicaMap);

      }
    }

    return metricsPerTimeSlotMap;
  }

  // Randomly distribute the  daily request count
  private distributeRequestCountsForSimulationDuration(
    data: {
      expectedExternalDailyRequestCount: number,
      simulationDurationInDays: number
      timeSlotCountPerDay: number,
    }
  ): number[][] {
    const result: number[][] = [];
    const { simulationDurationInDays, ...otherParams } = data;

    for (let day = 0; day < data.simulationDurationInDays; day++) {
      const dailyDistribution = this.distributeDailyRequestCount(
        otherParams
      );
      result.push(dailyDistribution);
    }

    return result;
  }
  private distributeDailyRequestCount(
    data: {
      expectedExternalDailyRequestCount: number,
      timeSlotCountPerDay: number,
    }

  ): number[] {

    /*
      Generate random weights for distributing request counts across all time slots  
      with ±20% fluctuation.
      (TODO:後續可找幾篇論文研究真實流量波動範圍，然後調整此設計！！)
    */
    const weights = Array.from({ length: data.timeSlotCountPerDay }, () => {
      return 1 + (Math.random() * 0.4 - 0.2); // 範圍：0.8 ~ 1.2
    });
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    const normalizedWeights = weights.map(w => w / totalWeight);

    // Multiply weights by total request count and floor the result to initially distribute requests
    const distributedDailyRequestCount = normalizedWeights.map(w => Math.floor(w * data.expectedExternalDailyRequestCount));

    // Calculate the difference that needs to be fixed
    let diff = data.expectedExternalDailyRequestCount - distributedDailyRequestCount.reduce((a, b) => a + b, 0);

    // Add the errors back sequentially to the time slots in descending order of their weights, 
    // ensuring that the total number of requests matches the original total.
    if (diff >= 1) {
      const sortedIndices = normalizedWeights
        .map((w, idx) => ({ idx, weight: w }))
        .sort((a, b) => b.weight - a.weight)
        .map(entry => entry.idx);

      let i = 0;
      while (diff >= 1) {
        const index = sortedIndices[i % data.timeSlotCountPerDay];
        distributedDailyRequestCount[index]++;
        diff--;
        i++;
      }
    }
    return distributedDailyRequestCount;
  }

  /*
    Transforms the simulation request counts map (endpoint → 2D [days][timeSlots] array) 
    into a 2D array of Maps indexed by [day][timeSlot], where each Map stores endpoint → count.
    (for easier construction of BaseMetricsPerTimeSlotMap)
  */
  private transformEndpointSimulationReqCountsMap(
    data: {
      baseEndpointSimulationReqCountsMap: Map<string, number[][]>,
      simulationDurationInDays: number,
      timeSlotCountPerDay: number
    }
  ): Array<Array<Map<string, number>>> {
    // Create the result structure: days x timeSlots
    const result: Array<Array<Map<string, number>>> = [];

    for (let day = 0; day < data.simulationDurationInDays; day++) {
      const daySlots: Array<Map<string, number>> = [];
      for (let slot = 0; slot < data.timeSlotCountPerDay; slot++) {
        daySlots.push(new Map<string, number>());
      }
      result.push(daySlots);
    }

    // Fill the structure: [day][slot] → Map<endpoint, count>
    for (const [endpoint, dailyCounts] of data.baseEndpointSimulationReqCountsMap.entries()) {
      for (let day = 0; day < data.simulationDurationInDays; day++) {
        const countsForThisDay = dailyCounts[day] || [];

        for (let slot = 0; slot < data.timeSlotCountPerDay; slot++) {
          const count = countsForThisDay[slot] ?? 0;
          result[day][slot].set(endpoint, count);
        }
      }
    }

    return result;
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
     * Key:   string - uniqueServiceName.
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
      for (const [uniqueEndpointName, stats] of timeSlotStats.entries()) {
        // Extract the service ID from the endpoint ID
        const uniqueServiceName = SimulatorUtils.extractUniqueServiceNameFromEndpointName(uniqueEndpointName);

        // Get the current aggregated count for this service, defaulting to 0 if none exists
        const prevCount = serviceMap.get(uniqueServiceName) || 0;

        // Add the current endpoint's request count to the service's total count
        serviceMap.set(uniqueServiceName, prevCount + stats.requestCount);
      }
    }

    return serviceRequestCountsPerTimeSlot;
  }

  private AdjustedErrorRateByOverload(
    metricsPerTimeSlotMap: Map<string, TCMetricsPerTimeSlot>,
    serviceReceivedRequestCount: Map<string, Map<string, number>>,
  ) {
    for (const [timeSlotKey, serviceCounts] of serviceReceivedRequestCount.entries()) {
      const metricsInThisTimeSlot = metricsPerTimeSlotMap.get(timeSlotKey);
      if (metricsInThisTimeSlot) {
        const errorRateMapThisSlot = metricsInThisTimeSlot.getEndpointErrorRateMap();

        for (const [uniqueEndpointName, baseErrorRate] of errorRateMapThisSlot.entries()) {
          const uniqueServiceName = SimulatorUtils.extractUniqueServiceNameFromEndpointName(uniqueEndpointName);

          // Get request count for the service in this hour
          const requestCountInThisHour = serviceCounts.get(uniqueServiceName) ?? 0;
          const requestCountPerSecond = requestCountInThisHour / 3600;

          const replicaCount = metricsInThisTimeSlot.getServiceReplicaCount(uniqueServiceName);
          const replicaMaxRPS = metricsInThisTimeSlot.getServiceCapacityPerReplica(uniqueServiceName);


          // console.log("----------")
          // console.log("timeSlotKey=", timeSlotKey)
          // console.log("uniqueEndpointName=", uniqueEndpointName)
          // console.log("requestCountInThisHour=", requestCountInThisHour)
          console.log(replicaMaxRPS)
          const adjustedErrorRate = this.estimateErrorRateWithServiceOverload({
            requestCountPerSecond,
            replicaCount,
            replicaMaxRPS,
            baseErrorRate
          });

          metricsInThisTimeSlot.setEndpointErrorRate(uniqueEndpointName, adjustedErrorRate);
        }

      }
    }
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


    // console.log("requestCountPerSecond", data.requestCountPerSecond)
    // console.log(` replicas: ${data.replicaCount}`)
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