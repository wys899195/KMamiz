
import Simulator from './Simulator';
import {
  TSimulationTrafficInfo,
  TSimulationEndpointDependency,
  TSimulationEndpointDatatype,
  TSimulationStatusRate,
  TSimulationNamespace,
} from "../../entities/TSimulationYAML";

import { TRealtimeData } from "../../entities/TRealtimeData";
import { TCombinedRealtimeData } from "../../entities/TCombinedRealtimeData";

import { TReplicaCount } from "../../entities/TReplicaCount";
import { TEndpointInfo, TEndpointDependency } from "../../entities/TEndpointDependency";
import { TRequestTypeUpper } from "../../entities/TRequestType";
import { TEndpointDataType } from "../../entities/TEndpointDataType";

import { EndpointDependencies } from "../EndpointDependencies";
import { RealtimeDataList } from "../RealtimeDataList";

import { CEndpointDependencies } from "../Cacheable/CEndpointDependencies";
import DataCache from "../../services/DataCache";

import Logger from "../../../src/utils/Logger";

export default class TrafficSimulator extends Simulator {
  private static instance?: TrafficSimulator;
  static getInstance = () => this.instance || (this.instance = new this());

  yamlToSimulationRetrieveData(yamlString: string): {
    validationErrorMessage: string; // error message when validating YAML format
    convertingErrorMessage: string; // error message when converting to realtime data
    rlDataList: TCombinedRealtimeData[];
    endpointDependencies: TEndpointDependency[];
    dataType: TEndpointDataType[]
    replicaCountList: TReplicaCount[];
  } {
    const { validationErrorMessage, parsedYAML } = this.validateYAMLFormat(yamlString);

    if (!parsedYAML) {
      return {
        validationErrorMessage: validationErrorMessage,
        convertingErrorMessage: "",
        rlDataList: [],
        endpointDependencies: [],
        dataType: [],
        replicaCountList: [],
      };
    }

    const trafficDate = Date.now();

    const trafficMap = this.buildTrafficMap(parsedYAML.trafficsInfo);

    const {
      rlDataList,
      sampleRlDataList,
      replicaCountList,
      endpointInfoSet
    } = this.extractServiceAndEndpointData(parsedYAML.endpointsInfo, trafficMap, trafficDate);

    const {
      dependOnMap,
      dependByMap
    } = this.buildDependencyMaps(parsedYAML.endpointDependencies);


    const endpointDependencies = this.createEndpointDependencies(
      trafficDate,
      endpointInfoSet,
      dependOnMap,
      dependByMap,
    );

    try {
      return {
        validationErrorMessage: "",
        convertingErrorMessage: "",
        ...this.convertRawToRealtimeData(
          rlDataList,
          sampleRlDataList,
          endpointDependencies
        ),
        replicaCountList: replicaCountList,
      };
    } catch (err) {
      const errMsg = `${err instanceof Error ? err.message : err}`
      Logger.error("Failed to convert simulationRawData to realtimeData, skipping.");
      Logger.verbose("-detail: ",errMsg);
      return {
        validationErrorMessage: "",
        convertingErrorMessage: `Failed to convert simulationRawData to realtimeData:\n ${errMsg}`,
        rlDataList: [],
        endpointDependencies: [],
        dataType: [],
        replicaCountList: [],
      };
    }
  }

  convertRawToRealtimeData(
    rlDataList: TRealtimeData[],
    sampleRlDataList: TRealtimeData[],
    endpointDependencies: TEndpointDependency[],
  ) {
    const cbData = new RealtimeDataList(rlDataList).toCombinedRealtimeData();
    const sampleCbdata = new RealtimeDataList(sampleRlDataList).toCombinedRealtimeData();
    const dataType = sampleCbdata.extractEndpointDataType();
    const existingDep = DataCache.getInstance()
      .get<CEndpointDependencies>("EndpointDependencies")
      .getData()?.toJSON();
    const newDep = new EndpointDependencies(endpointDependencies);
    
    const dep = existingDep
    ? new EndpointDependencies(existingDep).combineWith(newDep)
    : newDep;

    //console.error("Error while creating endpoint dependencies:", err);
    //console.error("Error while converting realtime data:", err);

    return {
      rlDataList: cbData.toJSON(),
      endpointDependencies: dep.toJSON(),
      dataType: dataType.map((d) => d.toJSON()),
    }
  }

  private buildTrafficMap(trafficsInfo?: TSimulationTrafficInfo[]): Map<string, TSimulationTrafficInfo> {
    const trafficMap = new Map<string, TSimulationTrafficInfo>();
    trafficsInfo?.forEach(t => trafficMap.set(t.endpointUniqueId, t));
    return trafficMap;
  }

  private buildDependencyMaps(dependencies?: TSimulationEndpointDependency[]): {
    dependOnMap: Map<string, Set<string>>;
    dependByMap: Map<string, Set<string>>;
  } {
    const dependOnMap = new Map<string, Set<string>>();
    const dependByMap = new Map<string, Set<string>>();

    dependencies?.forEach(dep => {
      const from = dep.endpointUniqueId;
      const toList = dep.dependOn || [];

      let fromSet = dependOnMap.get(from);
      if (!fromSet) {
        fromSet = new Set();
        dependOnMap.set(from, fromSet);
      }

      toList.forEach(to => {
        // Establish dependency A -> B
        fromSet!.add(to);

        // Establish reverse dependency B <- A
        let toSet = dependByMap.get(to);
        if (!toSet) {
          toSet = new Set();
          dependByMap.set(to, toSet);
        }
        toSet!.add(from);
      });
    });

    return { dependOnMap, dependByMap };
  }

  private extractServiceAndEndpointData(
    endpointsInfo: TSimulationNamespace[],
    trafficMap: Map<string, TSimulationTrafficInfo>,
    trafficDate: number,
  ): {
    rlDataList: TRealtimeData[];
    sampleRlDataList: TRealtimeData[];
    replicaCountList: TReplicaCount[];
    endpointInfoSet: Map<string, TEndpointInfo>;
  } {
    const rlDataList: TRealtimeData[] = [];
    const sampleRlDataList: TRealtimeData[] = []; // to extract static data types even without traffic
    const replicaCountList: TReplicaCount[] = [];
    const endpointInfoSet = new Map<string, TEndpointInfo>();
    const processedUniqueServiceNameSet = new Set<string>();

    for (const ns of endpointsInfo) {
      for (const svc of ns.services) {
        for (const ver of svc.versions) {
          const uniqueServiceName = `${svc.service}\t${ns.namespace}\t${ver.version}`;

          // to avoid duplicate processing of the same service
          if (processedUniqueServiceNameSet.has(uniqueServiceName)) continue;
          processedUniqueServiceNameSet.add(uniqueServiceName);

          // create replicaCount
          replicaCountList.push({
            uniqueServiceName,
            service: svc.service,
            namespace: ns.namespace,
            version: ver.version,
            replicas: ver.replica ?? 1,
          });

          for (const ep of ver.endpoints) {
            const host = `http://${svc.service}.${ns.namespace}.svc.cluster.local`;
            const { path, method } = ep.endpointInfo;
            const url = `${host}${path}`; // port default 80
            const methodUpperCase = method.toUpperCase() as TRequestTypeUpper;
            const uniqueEndpointName = `${uniqueServiceName}\t${methodUpperCase}\t${url}`;


            // create a realtimeData
            this.collectEndpointRealtimeData(
              trafficDate,
              rlDataList,
              sampleRlDataList,
              uniqueServiceName,
              uniqueEndpointName,
              ns.namespace,
              svc.service,
              ver.version,
              methodUpperCase,
              ep.datatype,
              trafficMap.get(ep.endpointUniqueId),
            );

            // create TEndpointInfo and insert into endpointInfoSet(used to create endpointDependencies)
            endpointInfoSet.set(ep.endpointUniqueId, {
              uniqueServiceName,
              uniqueEndpointName,
              service: svc.service,
              namespace: ns.namespace,
              version: ver.version,
              labelName: undefined,
              url,
              host,
              path,
              port: "80",
              method: methodUpperCase,
              clusterName: "cluster.local",
              timestamp: trafficDate,
            });
          }
        }
      }
    }

    return { rlDataList, sampleRlDataList, replicaCountList, endpointInfoSet };
  }

  private collectEndpointRealtimeData(
    trafficDate: number,
    rlDataList: TRealtimeData[],
    sampleRlDataList: TRealtimeData[],
    uniqueServiceName: string,
    uniqueEndpointName: string,
    namespace: string,
    service: string,
    version: string,
    methodUpperCase: TRequestTypeUpper,
    datatype?: TSimulationEndpointDatatype,
    traffic?: TSimulationTrafficInfo
  ) {
    // Create a response map based on datatype
    const respMap = new Map<string, { body: string; contentType: string }>();
    datatype?.responses?.forEach(r => {
      respMap.set(r.status, {
        body: r.responseBody,
        contentType: r.responseContentType
      });
    });
    const sampleStatuses = [...respMap.keys()];
    console.log("sampleStatuses = ", sampleStatuses);
    console.log("\n\n");

    sampleRlDataList.push(...sampleStatuses.map(status => ({
      uniqueServiceName,
      uniqueEndpointName,
      timestamp: trafficDate * 1000, // microseconds
      method: methodUpperCase,
      service,
      namespace,
      version,
      latency: 0,
      status,
      responseBody: respMap.get(status)?.body,
      responseContentType: respMap.get(status)?.contentType,
      requestBody: datatype?.requestBody,
      requestContentType: datatype?.requestContentType,
      replica: undefined
    })));

    if (traffic) {
      // determine the status of each realtimeData based on the statusRate in the trafficsInfo
      const statuses = this.allocateStatuses(
        traffic.requestCount,
        traffic.statusRate,
        datatype,
      );
      rlDataList.push(...statuses.map(status => ({
        uniqueServiceName,
        uniqueEndpointName,
        timestamp: trafficDate * 1000, // microseconds
        method: methodUpperCase,
        service,
        namespace,
        version,
        latency: traffic.latency,
        status,
        responseBody: respMap.get(status)?.body,
        responseContentType: respMap.get(status)?.contentType,
        requestBody: datatype?.requestBody,
        requestContentType: datatype?.requestContentType,
        replica: undefined
      })));
    }
  }

  private createEndpointDependencies(
    trafficDate: number,
    endpointInfoSet: Map<string, TEndpointInfo>,
    dependOnMap: Map<string, Set<string>>,
    dependByMap: Map<string, Set<string>>,
  ): TEndpointDependency[] {
    /*
      Use BFS starting from each endpoint to find all the 'endpoints it depends on' and the 'endpoints that depend on it', 
      calculate the distances between them, and combine this with TEndpointInfo to generate the corresponding TEndpointDependency structures.
    */
    const bfs = <T extends "SERVER" | "CLIENT">(
      start: string,
      graph: Map<string, Set<string>>,
      type: T
    ): {
      endpoint: TEndpointInfo;
      distance: number;
      type: T;
    }[] => {
      const visited = new Set<string>();
      const queue: [string, number][] = [[start, 0]];
      const result: {
        endpoint: TEndpointInfo;
        distance: number;
        type: T;
      }[] = [];

      // console.log("===============================")
      // console.log("start=",start);
      // console.log("graph=",graph);
      // console.log("type=",type)
      // console.log("===============================")

      let head = 0;
      while (head != queue.length) {
        const [curr, distance] = queue[head++];
        if (visited.has(curr)) continue;
        visited.add(curr);

        if (curr !== start) {
          const epInfo = endpointInfoSet.get(curr);
          if (epInfo) {
            result.push({ endpoint: epInfo, distance, type });
          }
        }

        const neighbors = graph.get(curr);
        if (neighbors) {
          for (const next of neighbors) {
            if (!visited.has(next)) {
              queue.push([next, distance + 1]);
            }
          }
        }
      }

      return result;
    };

    const result: TEndpointDependency[] = [];

    for (const [uniqueEndpointName, endpointInfo] of endpointInfoSet.entries()) {
      const dependingOn = bfs(uniqueEndpointName, dependOnMap, "SERVER");
      const dependingBy = bfs(uniqueEndpointName, dependByMap, "CLIENT");

      result.push({
        endpoint: endpointInfo,
        lastUsageTimestamp: trafficDate,
        dependingOn,
        dependingBy,
      });
    }

    return result;
  }

  private allocateStatuses(
    total: number,
    statusRates?: TSimulationStatusRate[],
    datatype?: TSimulationEndpointDatatype
  ): string[] {
    if (total <= 0) return [];
    const responses = datatype?.responses ?? [];
    const defaultStatus = responses.find(r => r.status.startsWith("2"))?.status || "200";

    // If statusRates is not available, prioritize using the 2xx status from datatype; if that's also unavailable, default to '200'
    if (!statusRates || statusRates.length === 0) {
      return Array(total).fill(defaultStatus);
    }
    // Calculate the sum of statusRates
    const totalRate = statusRates.reduce((sum, e) => sum + e.rate, 0);

    if (totalRate < 100) {
      // When the total of all statusRates is less than 100, allocate the remaining rate
      const remainingRate = 100 - totalRate;

      // Find statuses in datatype.responses that are not yet included in statusRates
      const unallocatedStatuses = Array.from(new Set(
        (datatype?.responses ?? [])
          .filter(response => {
            return !statusRates.some(statusRate => statusRate.status === response.status);
          })
          .map(response => response.status) // Only extract the status field
      ));

      if (unallocatedStatuses.length > 0) {
        // Evenly distribute the remainingRate to the unallocated statuses
        const unallocatedRate = remainingRate / unallocatedStatuses.length;

        unallocatedStatuses.forEach(status => {
          statusRates.push({
            status,
            rate: unallocatedRate,
          });
        });
      } else {
        //If all possible statuses have already been allocated, add the remainingRate to defaultStatus
        const defaultStatusRate = statusRates.find(e => e.status === defaultStatus);
        if (defaultStatusRate) {
          defaultStatusRate.rate += remainingRate;
        } else {
          statusRates.push({ status: defaultStatus, rate: remainingRate });
        }
      }
    } else if (totalRate > 100) {
      // If the total rate exceeds 100, scale all rates so that the sum equals 100
      const scale = 100 / totalRate;
      statusRates.forEach(e => {
        e.rate = e.rate * scale;
      });
    }

    // Calculate the floor and fractional part of each status's allocation
    const allocs = statusRates.map(e => {
      const raw = (e.rate / 100) * total;
      const base = Math.floor(raw);
      return { status: e.status, base, frac: raw - base };
    });
    // Assign the floor portion
    let assigned = allocs.reduce((sum, a) => sum + a.base, 0);
    let remain = total - assigned;

    // Distribute the remaining allocations based on the size of the fractional parts
    allocs.sort((a, b) => b.frac - a.frac);
    for (let i = 0; i < remain; i++) {
      allocs[i % allocs.length].base++;
    }

    // Flatten the result into a string array
    return allocs.flatMap(a => Array(a.base).fill(a.status));
  }

}