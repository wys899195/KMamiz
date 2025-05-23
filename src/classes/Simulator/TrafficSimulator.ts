
import yaml from "js-yaml";
import Simulator from './Simulator';
import DependencyGraphSimulator from './DependencyGraphSimulator';
import {
  TSimulationEndpointDatatype,
  TSimulationNamespace,
  TSimulationEndpointDependency,
  TSimulationResponseBody,
  TSimulationEndpoint,
  TSimulationEndpointMetricInfo,
  TSimulationEndpointRequestCount,
  TSimulationYAML
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

export default class TrafficSimulator extends Simulator {
  private static instance?: TrafficSimulator;
  static getInstance = () => this.instance || (this.instance = new this());

  yamlToSimulationData(yamlString: string): {
    validationErrorMessage: string; // error message when validating YAML format
    convertingErrorMessage: string; // error message when converting to realtime data
    endpointDependencies: TEndpointDependency[];
    dataType: TEndpointDataType[];
    cbRealtimeDataList: TCombinedRealtimeData[];
    replicaCountList: TReplicaCount[];
  } {
    const { validationErrorMessage, parsedYAML } = this.validateAndParseYAML(yamlString);

    if (!parsedYAML) {
      return {
        validationErrorMessage: validationErrorMessage,
        convertingErrorMessage: "",
        endpointDependencies: [],
        dataType: [],
        cbRealtimeDataList: [],
        replicaCountList: [],
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

    const { requestCounts, latencyMap, errorRateMap } = this.getTrafficMap(parsedYAML.endpointMetrics);


    const trafficPropagationResults = this.simulateTrafficPropagationFromAllEntries(
      dependOnMap,
      requestCounts,
      latencyMap,
      errorRateMap,
    );



    const {
      realTimeDataList,
      sampleRealTimeDataList,// to extract simulation data types even without traffic
      replicaCountList
    } = this.extractSampleDataAndReplicaCount(
      parsedYAML.endpointsInfo,
      convertDate,
      existingUniqueEndpointNameMappings,
      trafficPropagationResults
    );


    const endpointDependencies = dependencySimulator.createEndpointDependencies(
      convertDate,
      endpointInfoSet,
      dependOnMap,
      dependByMap,
    );

    try {
      return {
        validationErrorMessage: "",
        convertingErrorMessage: "",
        ...this.convertRawToSimulationData(
          realTimeDataList,
          sampleRealTimeDataList,
          endpointDependencies
        ),
        replicaCountList: replicaCountList,
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
        cbRealtimeDataList: [],
        replicaCountList: [],
      };
    }
  }

  private convertRawToSimulationData(
    realTimeDataList: TRealtimeData[],
    sampleRealTimeDataList: TRealtimeData[],
    endpointDependencies: TEndpointDependency[],
  ) {
    const cbData = new RealtimeDataList(realTimeDataList).toCombinedRealtimeData();
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
      cbRealtimeDataList: cbData.toJSON(),
    }
  }

  private extractSampleDataAndReplicaCount(
    endpointsInfo: TSimulationNamespace[],
    convertDate: number,
    existingUniqueEndpointNameMappings: Map<string, string>,
    trafficPropagationResults: Map<string, {
      entryEndpoint: string;
      requestCount: number;
      errorCount: number;
      maxLatency: number;
    }[]>
  ): {
    realTimeDataList: TRealtimeData[];
    sampleRealTimeDataList: TRealtimeData[];
    replicaCountList: TReplicaCount[];
  } {
    const realTimeDataList: TRealtimeData[] = [];
    const sampleRealTimeDataList: TRealtimeData[] = [];
    const replicaCountList: TReplicaCount[] = [];
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
            // create a realtimeData
            this.collectEndpointRealtimeData(
              realTimeDataList,
              sampleRealTimeDataList,
              uniqueServiceName,
              uniqueEndpointName,
              ns.namespace,
              svc.serviceName,
              ver.version,
              methodUpperCase,
              convertDate,
              ep.datatype,
              trafficPropagationResults.get(ep.endpointId),
            );
          }
        }
      }
    }

    return { realTimeDataList, sampleRealTimeDataList, replicaCountList };
  }

  private collectEndpointRealtimeData(
    realTimeDataList: TRealtimeData[],
    sampleRealTimeDataList: TRealtimeData[],
    uniqueServiceName: string,
    uniqueEndpointName: string,
    namespace: string,
    service: string,
    version: string,
    methodUpperCase: TRequestTypeUpper,
    convertDate: number,
    datatype?: TSimulationEndpointDatatype,
    trafficPropagationResult?: {
      entryEndpoint: string;
      requestCount: number;
      errorCount: number;
      maxLatency: number;
    }[],
  ) {
    // Create a response map based on datatype
    const respMap = new Map<string, { body: string; contentType: string }>();
    datatype?.responses?.forEach(r => {
      respMap.set(String(r.status), {
        body: r.responseBody,
        contentType: r.responseContentType
      });
    });
    const sampleStatuses = [...respMap.keys()];

    const baseData = {
      uniqueServiceName,
      uniqueEndpointName,
      timestamp: convertDate * 1000, // microseconds
      method: methodUpperCase,
      service,
      namespace,
      version,
      requestBody: datatype?.requestBody,
      requestContentType: datatype?.requestContentType,
      replica: undefined,
    };


    sampleRealTimeDataList.push(
      ...sampleStatuses.map(status => ({
        ...baseData,
        latency: 0,
        status,
        responseBody: respMap.get(status)?.body,
        responseContentType: respMap.get(status)?.contentType,
      }))
    );


    if (trafficPropagationResult) {
      const resp200 = respMap.get("200");
      const resp500 = respMap.get("500");
      for (const result of trafficPropagationResult) {
        const { requestCount, errorCount, maxLatency } = result;
        const successCount = requestCount - errorCount;

        for (let i = 0; i < successCount; i++) {
          realTimeDataList.push({
            ...baseData,
            latency: maxLatency,
            status: "200",
            responseBody: resp200?.body,
            responseContentType: resp200?.contentType,
          });
        }

        for (let i = 0; i < errorCount; i++) {
          realTimeDataList.push({
            ...baseData,
            latency: maxLatency,
            status: "500",
            responseBody: resp500?.body,
            responseContentType: resp500?.contentType,
          });
        }
      }
    }
  }
  private getTrafficMap(endpointMetrics?: {
    info: TSimulationEndpointMetricInfo[];
    requests: TSimulationEndpointRequestCount[];
  }): {
    requestCounts: Map<string, number>;
    latencyMap: Map<string, number>;   // latency >= 0
    errorRateMap: Map<string, number>; // errorRate in [0,1]
  } {
    if (!endpointMetrics) {
      return {
        requestCounts: new Map(),
        latencyMap: new Map(),
        errorRateMap: new Map(),
      };
    }

    const requestCounts = new Map<string, number>();
    for (const { endpointId, requestCount } of endpointMetrics.requests) {
      requestCounts.set(endpointId, (requestCounts.get(endpointId) ?? 0) + requestCount);
    }

    const latencyMap = new Map<string, number>();
    const errorRateMap = new Map<string, number>();
    for (const { endpointId, latencyMs, errorRate } of endpointMetrics.info) {
      latencyMap.set(endpointId, latencyMs < 0 ? 0 : latencyMs);
      errorRateMap.set(endpointId, Math.min(Math.max(errorRate ?? 0, 0), 100) / 100);
    }

    return { requestCounts, latencyMap, errorRateMap };
  }
  // Simulates traffic propagation starting from multiple entry endpoint and aggregates results
  private simulateTrafficPropagationFromAllEntries(
    dependOnMap: Map<string, Set<string>>,
    requestCounts: Map<string, number>,
    latencyMap: Map<string, number>,
    errorRateMap: Map<string, number>
  ): Map<string, { entryEndpoint: string; requestCount: number; errorCount: number; maxLatency: number }[]> {
    // Map to aggregate stats per endpoint, with an array of stats from different entry endpoint
    const aggregatedResults = new Map<string, { entryEndpoint: string; requestCount: number; errorCount: number; maxLatency: number }[]>();

    // For each starting entry point and its initial request count
    for (const [entryPointId, count] of requestCounts.entries()) {
      // Run single entry propagation
      const { stats } = this.simulateTrafficPropagationFromSingleEntry(
        entryPointId,
        count,
        dependOnMap,
        latencyMap,
        errorRateMap
      );

      // Aggregate results: for each endpoint reached, add the stats with origin info
      for (const [targetEndpointId, stat] of stats.entries()) {
        if (!aggregatedResults.has(targetEndpointId)) {
          aggregatedResults.set(targetEndpointId, []);
        }
        aggregatedResults.get(targetEndpointId)!.push({
          entryEndpoint: entryPointId,
          requestCount: stat.requestCount,
          errorCount: stat.errorCount,
          maxLatency: stat.maxLatency,
        });
      }
    }

    return aggregatedResults;
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