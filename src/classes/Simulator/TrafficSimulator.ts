
import yaml from "js-yaml";
import Simulator from './Simulator';
import DependencyGraphSimulator from './DependencyGraphSimulator';
import {
  TSimulationEndpointMetric,
  TSimulationEndpointDependency,
  TSimulationEndpointDatatype,
  TSimulationNamespace,
  TSimulationYAML,
  TSimulationEndpoint,
  TSimulationResponseBody,
} from "../../entities/TSimulationYAML";
import DataCache from "../../services/DataCache";
import { TRealtimeData } from "../../entities/TRealtimeData";
import { TReplicaCount } from "../../entities/TReplicaCount";
import { TEndpointDependency } from "../../entities/TEndpointDependency";
import { TRequestTypeUpper } from "../../entities/TRequestType";
import { TEndpointDataType } from "../../entities/TEndpointDataType";
import { TCombinedRealtimeData } from "../../entities/TCombinedRealtimeData";
import { EndpointDependencies } from "../EndpointDependencies";
import { RealtimeDataList } from "../RealtimeDataList";

import { CEndpointDependencies } from "../Cacheable/CEndpointDependencies";
import { CEndpointDataType } from "../Cacheable/CEndpointDataType";
import { CReplicas } from "../Cacheable/CReplicas";
import Logger from "../../utils/Logger";



type TBaseRealtimeData = Omit<
  TRealtimeData,
  'latency' | 'status' | 'responseBody' | 'responseContentType' | 'timestamp'
>;

type BaseDataWithResponses = {
  baseData: TBaseRealtimeData,
  responses?: TSimulationEndpointDatatype['responses'],
}

// Represents request statistics for a specific endpoint during a particular hour
type EndpointStats = {
  requestCount: number;
  errorCount: number;
  maxLatency: number;
};

// Request statistics for all endpoints in a specific hour 
// (key: endpoint ID, value: statistics for that endpoint)
type HourlyStatsMap = Map<string, EndpointStats>;

// Request statistics for 24 hours in a specific day 
// (key: hour of the day (0–23), value: HourlyStatsMap for that hour)
type DailyStatsMap = Map<number, HourlyStatsMap>;

// Simulation results for all dates in the simulation period of a single run 
// (key: day index (0 ~ simulationDurationInDays -1), value: DailyStatsMap for that day)
type TrafficSimulationResult = Map<number, DailyStatsMap>;


export default class TrafficSimulator extends Simulator {
  private static instance?: TrafficSimulator;
  static getInstance = () => this.instance || (this.instance = new this());

  yamlToSimulationData(yamlString: string): {
    validationErrorMessage: string; // error message when validating YAML format
    convertingErrorMessage: string; // error message when converting to realtime data
    endpointDependencies: TEndpointDependency[];
    dataType: TEndpointDataType[];
    replicaCountList: TReplicaCount[];
    realtimeDataPerHourMap:Map<string, TCombinedRealtimeData[]>
  } {
    const { validationErrorMessage, parsedYAML } = this.validateAndParseYAML(yamlString);

    if (!parsedYAML) {
      return {
        validationErrorMessage: validationErrorMessage,
        convertingErrorMessage: "",
        endpointDependencies: [],
        dataType: [],
        replicaCountList: [],
        realtimeDataPerHourMap: new Map(),
      };
    }

    const convertDate = Date.now();
    const dependencySimulator = DependencyGraphSimulator.getInstance();
    const existingUniqueEndpointNameMappings = this.getExistingUniqueEndpointNameMappings();

    const {
      endpointInfoSet
    } = dependencySimulator.extractEndpointsInfo(
      parsedYAML.endpointsInfo,
      convertDate,
      existingUniqueEndpointNameMappings
    );

    const {
      dependOnMap,
      dependByMap
    } = dependencySimulator.buildDependencyMaps(parsedYAML.endpointDependencies);

    const {
      sampleRealTimeDataList,// to extract simulation data types even without traffic
      replicaCountList,
      baseDataMap
    } = this.extractSampleDataAndReplicaCount(
      parsedYAML.endpointsInfo,
      convertDate,
      existingUniqueEndpointNameMappings
    );

    const endpointDependencies = dependencySimulator.createEndpointDependencies(
      convertDate,
      endpointInfoSet,
      dependOnMap,
      dependByMap,
    );

    let realtimeDataPerHourMap:Map<string, TCombinedRealtimeData[]> = new Map();
    if (parsedYAML.trafficSimulation && parsedYAML.trafficSimulation.endpointMetrics.length > 0) {
      const endpointMetrics = parsedYAML.trafficSimulation.endpointMetrics;
      const simulationDurationInDays = parsedYAML.trafficSimulation.config.simulationDurationInDays;
      const {
        hourlyRequestCountsForEachDayMap,
        latencyMap,
        errorRateMap
      } = this.getTrafficMap(endpointMetrics, simulationDurationInDays);

      const trafficPropagationResults = this.aggregateSimulateTrafficStats(
        dependOnMap,
        hourlyRequestCountsForEachDayMap,
        latencyMap,
        errorRateMap,
      );
      realtimeDataPerHourMap = this.generateRealtimeDataFromSimulationResults(baseDataMap, trafficPropagationResults, convertDate);
    }


    try {
      return {
        validationErrorMessage: "",
        convertingErrorMessage: "",
        ...this.convertRawToSimulationData(
          sampleRealTimeDataList,
          endpointDependencies,
        ),
        replicaCountList: replicaCountList,
        realtimeDataPerHourMap:realtimeDataPerHourMap
      };
    } catch (err) {
      const errMsg = `${err instanceof Error ? err.message : err}`;
      Logger.error("Failed to convert simulationRawData to simulation data, skipping.");
      Logger.verbose("-detail: ", errMsg);
      return {
        validationErrorMessage: "",
        convertingErrorMessage: `Failed to convert simulationRawData to simulation data:\n ${errMsg}`,
        endpointDependencies: [],
        dataType: [],
        replicaCountList: [],
        realtimeDataPerHourMap: new Map(),
      };
    }
  }

  private convertRawToSimulationData(
    sampleRealTimeDataList: TRealtimeData[],
    endpointDependencies: TEndpointDependency[],
  ) {
    const sampleCbdata = new RealtimeDataList(sampleRealTimeDataList).toCombinedRealtimeData();
    const dataType = sampleCbdata.extractEndpointDataType();
    const existingDep = DataCache.getInstance()
      .get<CEndpointDependencies>("EndpointDependencies")
      .getData()?.toJSON();
    const newDep = new EndpointDependencies(endpointDependencies);
    const dep = existingDep
      ? new EndpointDependencies(existingDep).combineWith(newDep)
      : newDep;

    return {
      endpointDependencies: dep.toJSON(),
      dataType: dataType.map((d) => d.toJSON()),
    }
  }

  private extractSampleDataAndReplicaCount(
    endpointsInfo: TSimulationNamespace[],
    convertDate: number,
    existingUniqueEndpointNameMappings: Map<string, string>
  ): {
    sampleRealTimeDataList: TRealtimeData[];
    replicaCountList: TReplicaCount[];
    baseDataMap: Map<string, BaseDataWithResponses>;
  } {
    const sampleRealTimeDataList: TRealtimeData[] = [];
    const replicaCountList: TReplicaCount[] = [];
    const baseDataMap = new Map<string, BaseDataWithResponses>();
    const processedUniqueServiceNameSet = new Set<string>();


    for (const ns of endpointsInfo) {
      for (const svc of ns.services) {
        for (const ver of svc.versions) {
          const uniqueServiceName = `${svc.serviceName}\t${ns.namespace}\t${ver.version}`;

          // to avoid duplicate processing of the same service
          if (processedUniqueServiceNameSet.has(uniqueServiceName)) continue;
          processedUniqueServiceNameSet.add(uniqueServiceName);

          // create replicaCount
          replicaCountList.push({
            uniqueServiceName,
            service: svc.serviceName,
            namespace: ns.namespace,
            version: ver.version,
            replicas: ver.replica ?? 1,
          });

          for (const ep of ver.endpoints) {
            const { path, method } = ep.endpointInfo;
            const methodUpperCase = method.toUpperCase() as TRequestTypeUpper;

            const uniqueEndpointName = this.generateUniqueEndpointName(
              uniqueServiceName,
              svc.serviceName,
              ns.namespace,
              methodUpperCase,
              path,
              existingUniqueEndpointNameMappings
            )

            const baseData: TBaseRealtimeData = {
              uniqueServiceName,
              uniqueEndpointName,
              method: methodUpperCase,
              service: svc.serviceName,
              namespace: ns.namespace,
              version: ver.version,
              requestBody: ep.datatype?.requestBody,
              requestContentType: ep.datatype?.requestContentType,
              replica: ver.replica ?? 1,
            };

            baseDataMap.set(ep.endpointId, { baseData, responses: ep.datatype?.responses });

            // collect endpoint sample data (fake realtime data)
            const endpointSampleData = this.collectEndpointSampleData(
              convertDate,
              baseData,
              ep.datatype?.responses
            );
            sampleRealTimeDataList.push(...endpointSampleData);
          }
        }
      }
    }

    return { sampleRealTimeDataList, replicaCountList, baseDataMap };
  }

  private collectEndpointSampleData(
    convertDate: number,
    baseData: TBaseRealtimeData,
    responses?: TSimulationResponseBody[],
  ): TRealtimeData[] {
    // Create a response map based on datatype
    const respMap = new Map<string, { body: string; contentType: string }>();
    responses?.forEach(r => {
      respMap.set(String(r.status), {
        body: r.responseBody,
        contentType: r.responseContentType
      });
    });
    const sampleStatuses = [...respMap.keys()];

    const endpointSampleData: TRealtimeData[] = sampleStatuses.map(status => ({
      ...baseData,
      latency: 0,
      timestamp: convertDate * 1000, // microseconds
      status,
      responseBody: respMap.get(status)?.body,
      responseContentType: respMap.get(status)?.contentType,
    }))

    return endpointSampleData;
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


  private aggregateSimulateTrafficStats(
    dependOnMap: Map<string, Set<string>>,
    hourlyRequestCountsForEachDayMap: Map<string, number[][]>,
    latencyMap: Map<string, number>,
    errorRateMap: Map<string, number>
  ): TrafficSimulationResult {

    const results: TrafficSimulationResult = new Map();

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
          // console.log(stats.entries())

          if (!results.has(day)) {
            results.set(day, new Map());
          }
          const dailyStats: DailyStatsMap = results.get(day)!;
          if (!dailyStats.has(hour)) {
            dailyStats.set(hour, new Map());
          }
          const hourlyStats: HourlyStatsMap = dailyStats.get(hour)!;


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

  private generateRealtimeDataFromSimulationResults(
    baseDataMap: Map<string, BaseDataWithResponses>,
    trafficPropagationResults: TrafficSimulationResult,
    convertDate: number
  ): Map<string, TCombinedRealtimeData[]> {
    const realtimeDataPerHourMap = new Map<string, TCombinedRealtimeData[]>(); // key: "day-hour"

    for (const [day, dailyStats] of trafficPropagationResults.entries()) {
      for (const [hour, hourlyStats] of dailyStats.entries()) {
        let realtimeDataList: TRealtimeData[] = [];

        for (const [endpointId, stats] of hourlyStats.entries()) {
          const baseDataWithResp = baseDataMap.get(endpointId);
          if (!baseDataWithResp) continue;

          const { baseData, responses } = baseDataWithResp;
          const timestampMicro = (convertDate + day * 24 * 3600 * 1000 + hour * 3600 * 1000) * 1000;

          // Generate successful response realtime data
          const successCount = stats.requestCount - stats.errorCount;
          if (successCount > 0) {
            const successSamples = this.sampleResponseData(
              baseData,
              timestampMicro,
              stats.maxLatency,
              successCount,
              responses,
              false
            );
            realtimeDataList = realtimeDataList.concat(successSamples);
          }

          // Generate failed response realtime data (only server error)
          if (stats.errorCount > 0) {
            const errorSamples = this.sampleResponseData(
              baseData,
              timestampMicro,
              stats.maxLatency,
              stats.errorCount,
              responses,
              true
            );
            realtimeDataList = realtimeDataList.concat(errorSamples);
          }
        }

        const key = `${day}-${hour}`;
        realtimeDataPerHourMap.set(key, new RealtimeDataList(realtimeDataList).toCombinedRealtimeData().toJSON());
      }
    }
    return realtimeDataPerHourMap;
  }



  private sampleResponseData(
    baseData: TBaseRealtimeData,
    timestamp: number,
    latency: number,
    count: number,
    responses?: TSimulationResponseBody[],
    isError: boolean = false
  ): TRealtimeData[] {
    const respMap = new Map<string, { body: string; contentType: string }>();
    responses?.forEach(r => {
      respMap.set(String(r.status), {
        body: r.responseBody,
        contentType: r.responseContentType
      });
    });


    const status = isError
      ? [...respMap.keys()].find(s => s.startsWith("5")) || "500"
      : [...respMap.keys()].find(s => s.startsWith("2")) || "200";

    const response = respMap.get(status);

    const sampleList: TRealtimeData[] = [];
    for (let i = 0; i < count; i++) {
      // Simulate latency fluctuation +-10%
      const jitteredLatency = Math.round(latency * (0.9 + Math.random() * 0.2));
      sampleList.push({
        ...baseData,
        timestamp,
        latency: jitteredLatency,
        status,
        responseBody: response?.body,
        responseContentType: response?.contentType,
      });
    }

    return sampleList;
  }


  // Retrieve necessary data from kmamiz and convert it into a YAML file that can be used to generate static simulation data
  // (such as software quality metrics, dependency graphs, endpoint data formats, etc.)
  generateStaticYamlFromCurrentData() {
    const existingEndpointDependencies = DataCache.getInstance()
      .get<CEndpointDependencies>("EndpointDependencies")
      .getData()?.toJSON() || [];
    const existingReplicaCountList = DataCache.getInstance()
      .get<CReplicas>("ReplicaCounts")
      .getData() || [];
    const existingDataTypes = DataCache.getInstance()
      .get<CEndpointDataType>("EndpointDataType")
      .getData();


    const { endpointsInfoYaml, endpointIdMap } = this.buildEndpointsInfoYaml(
      existingDataTypes.map((d) => d.toJSON()),
      existingReplicaCountList
    );
    const endpointDependenciesYaml = this.buildEndpointDependenciesYaml(existingEndpointDependencies, endpointIdMap);
    const StaticSimulationYaml: TSimulationYAML = {
      endpointsInfo: endpointsInfoYaml,
      endpointDependencies: endpointDependenciesYaml
    }

    return this.formatEmptyJsonBodiesToMultilineYaml(
      yaml.dump(StaticSimulationYaml, { lineWidth: -1 })
    );
  }

  private formatEmptyJsonBodiesToMultilineYaml(rawYamlStr: string): string {
    //improves readability and makes it easier for users to edit the body manually.
    return rawYamlStr.replace(
      /^(\s*)(requestBody|responseBody): '{}'/gm,
      `$1$2: |-\n$1  {\n\n$1  }`
    );
  }

  private buildEndpointsInfoYaml(
    dataType: TEndpointDataType[],
    replicaCountList: TReplicaCount[],
  ): {
    endpointsInfoYaml: TSimulationNamespace[],
    endpointIdMap: Map<string, string>,
  } {
    const namespacesMap: Record<string, TSimulationNamespace> = {};
    const endpointIdCounterMap = new Map<string, number>();
    const endpointIdMap = new Map<string, string>(); // key: uniqueEndpointName, value: endpointId

    // merge schemas by uniqueEndpointName
    const endpointMap = new Map<string, TEndpointDataType>();
    for (const dt of dataType) {
      const key = dt.uniqueEndpointName;
      if (!endpointMap.has(key)) {
        endpointMap.set(key, {
          uniqueServiceName: dt.uniqueServiceName,
          uniqueEndpointName: dt.uniqueEndpointName,
          service: dt.service,
          namespace: dt.namespace,
          version: dt.version,
          method: dt.method,
          schemas: []
        });
      }
      endpointMap.get(key)!.schemas.push(...dt.schemas);
    }

    for (const type of endpointMap.values()) {
      const {
        uniqueEndpointName,
        service,
        namespace,
        version,
        method,
        schemas
      } = type;

      const url = uniqueEndpointName.split("\t")[4];
      const path = this.getPathFromUrl(url)

      // Initialize namespace
      if (!namespacesMap[namespace]) {
        namespacesMap[namespace] = {
          namespace,
          services: []
        };
      }

      let serviceYaml = namespacesMap[namespace].services.find(
        s => s.serviceName === service
      );
      if (!serviceYaml) {
        serviceYaml = {
          serviceName: service,
          versions: []
        };
        namespacesMap[namespace].services.push(serviceYaml);
      }

      let versionYaml = serviceYaml.versions.find(
        v => v.version === version
      );
      if (!versionYaml) {
        versionYaml = {
          version,
          replica: 1,
          endpoints: []
        };
        serviceYaml.versions.push(versionYaml);
      }

      const responses: TSimulationResponseBody[] = schemas.map(schema => ({
        status: Number(schema.status),
        responseContentType: schema.responseContentType || "",
        responseBody:
          schema.responseContentType === "application/json"
            ? this.convertSampleToUserDefinedType(schema.responseSample || {})
            : this.convertSampleToUserDefinedType({}),
      }));

      const endpointIdPrefix = `${namespace}-${service}-${version}-${method.toLowerCase()}-ep`;
      const serialNumber = (endpointIdCounterMap.get(endpointIdPrefix) || 1);
      const endpointId = `${endpointIdPrefix}-${serialNumber}`;
      endpointIdMap.set(uniqueEndpointName, endpointId);
      endpointIdCounterMap.set(endpointIdPrefix, serialNumber + 1);

      const endpoint: TSimulationEndpoint = {
        endpointId: endpointId,
        endpointInfo: {
          path,
          method
        },
        datatype: {
          requestContentType: schemas[0]?.requestContentType || "",
          requestBody:
            schemas[0]?.requestContentType === "application/json"
              ? this.convertSampleToUserDefinedType(schemas[0]?.requestSample || {})
              : this.convertSampleToUserDefinedType({}),
          responses
        }
      };
      versionYaml.endpoints.push(endpoint);
    }

    // Update replica counts to endpointsInfoYaml
    for (const replica of replicaCountList) {
      const { uniqueServiceName, replicas, namespace, version } = replica;
      const [serviceName] = uniqueServiceName.split("\t");

      const namespaceYaml = namespacesMap[namespace];
      if (!namespaceYaml) continue;

      const serviceYaml = namespaceYaml.services.find(
        s => s.serviceName === serviceName
      );
      if (!serviceYaml) continue;

      const versionYaml = serviceYaml.versions.find(
        v => v.version === version
      );
      if (!versionYaml) continue;

      versionYaml.replica = replicas;
    }

    return {
      endpointsInfoYaml: Object.values(namespacesMap),
      endpointIdMap: endpointIdMap
    };
  }

  private buildEndpointDependenciesYaml(
    endpointDependencies: TEndpointDependency[],
    endpointIdMap: Map<string, string>
  ): TSimulationEndpointDependency[] {
    return endpointDependencies.map(dep => {
      const fromKey = dep.endpoint.uniqueEndpointName;
      const fromId = endpointIdMap.get(fromKey);
      if (!fromId) return null;

      const dependOn = dep.dependingOn
        .filter(d => d.distance === 1) // Each endpoint in yaml only needs to know which endpoints it directly depends on
        .map(d => {
          const toKey = d.endpoint.uniqueEndpointName;
          const toId = endpointIdMap.get(toKey);
          return toId ? { endpointId: toId } : null;
        })
        .filter((d): d is { endpointId: string } => d !== null);

      if (dependOn.length === 0) return null;

      return {
        endpointId: fromId,
        dependOn
      };
    }).filter((d): d is TSimulationEndpointDependency => d !== null);
  }

  // Convert the requestSample in endpointDataType to UserDefinedType in yaml
  private convertSampleToUserDefinedType(obj: any, indentLevel = 0): string {
    if (JSON.stringify(obj) === '{}') return '{}';
    const indent = '  '.repeat(indentLevel);
    const nextIndent = '  '.repeat(indentLevel + 1);

    if (Array.isArray(obj)) {
      if (obj.length > 0) {
        const elementType = this.convertSampleToUserDefinedType(obj[0], indentLevel);
        return `${elementType}[]`;
      } else {
        return 'any[]';
      }
    } else if (obj !== null && typeof obj === 'object') {
      const properties: string[] = [];
      const keys = Object.keys(obj);
      if (keys.length === 0) {
        return '';
      }

      // Sort the object's keys in alphabetical order (for easier comparison with the interfaces generated by kmamiz)
      const sortedKeys = keys.sort();

      for (const key of sortedKeys) {
        const type = this.convertSampleToUserDefinedType(obj[key], indentLevel + 1);
        properties.push(`${nextIndent}${key}: ${type}`);
      }

      return `{\n${properties.join(',\n')}\n${indent}}`;
    } else if (typeof obj === 'string') {
      return 'string';
    } else if (typeof obj === 'number') {
      return 'number';
    } else if (typeof obj === 'boolean') {
      return 'boolean';
    } else {
      return 'null';
    }
  }
}