import {

  TSimulationConfigYAML,
  TSimulationEndpointDependency,
  TSimulationNamespace,
} from "../../entities/TSimulationConfig";
import { TRequestTypeUpper } from '../../entities/TRequestType'
import { TEndpointDependency, TEndpointInfo } from "../../entities/TEndpointDependency";


export default class SimEndpointDependencyBuilder {
  private static instance?: SimEndpointDependencyBuilder;
  static getInstance = () => this.instance || (this.instance = new this());
  private constructor() { }

  buildEndpointDependenciesBySimConfig(
    parsedConfig: TSimulationConfigYAML,
    simulateDate: number
  ): {
    dependOnMap: Map<string, Set<string>>,
    dependByMap: Map<string, Set<string>>,
    endpointDependencies: TEndpointDependency[]
  } {
    const {
      endpointInfoSet
    } = this.extractEndpointsInfo(
      parsedConfig.servicesInfo,
      simulateDate
    );

    const {
      dependOnMap,
      dependByMap
    } = this.buildDependencyMaps(parsedConfig.endpointDependencies);

    const endpointDependencies = this.createEndpointDependencies(
      simulateDate,
      endpointInfoSet,
      dependOnMap,
      dependByMap,
    );

    return {
      dependOnMap,
      dependByMap,
      endpointDependencies,
    }
  }

  private buildDependencyMaps(dependencies?: TSimulationEndpointDependency[]): {
    dependOnMap: Map<string, Set<string>>;
    dependByMap: Map<string, Set<string>>;
  } {
    const dependOnMap = new Map<string, Set<string>>();
    const dependByMap = new Map<string, Set<string>>();

    dependencies?.forEach(dep => {
      const from = dep.uniqueEndpointName!;
      const toList = dep.dependOn || [];

      let dependOnSet = dependOnMap.get(from);
      if (!dependOnSet) {
        dependOnSet = new Set();
        dependOnMap.set(from, dependOnSet);
      }

      toList.forEach(to => {
        // Establish dependency A -> B
        dependOnSet!.add(to.uniqueEndpointName!);

        // Establish reverse dependency B <- A
        let dependBySet = dependByMap.get(to.uniqueEndpointName!);
        if (!dependBySet) {
          dependBySet = new Set();
          dependByMap.set(to.uniqueEndpointName!, dependBySet);
        }
        dependBySet!.add(from);
      });
    });

    return { dependOnMap, dependByMap };
  }

  private extractEndpointsInfo(
    servicesInfo: TSimulationNamespace[],
    convertDate: number,
  ): {
    endpointInfoSet: Map<string, TEndpointInfo>;
  } {

    const endpointInfoSet = new Map<string, TEndpointInfo>();
    const processedUniqueServiceNameSet = new Set<string>();

    for (const ns of servicesInfo) {
      for (const svc of ns.services) {
        for (const ver of svc.versions) {
          const uniqueServiceName = ver.uniqueServiceName!;

          // to avoid duplicate processing of the same service
          if (processedUniqueServiceNameSet.has(uniqueServiceName)) continue;
          processedUniqueServiceNameSet.add(uniqueServiceName);

          for (const ep of ver.endpoints) {

            const { path, method } = ep.endpointInfo;
            const methodUpperCase = method.toUpperCase() as TRequestTypeUpper;


            // create TEndpointInfo and insert into endpointInfoSet(used to create endpointDependencies)
            endpointInfoSet.set(ep.uniqueEndpointName!, {
              uniqueServiceName,
              uniqueEndpointName: ep.uniqueEndpointName!,
              service: svc.serviceName,
              namespace: ns.namespace,
              version: ver.version,
              labelName: path,
              url: "",
              host: "",
              path,
              port: "",
              method: methodUpperCase,
              clusterName: "cluster.local",
              timestamp: convertDate,
            });
          }
        }
      }
    }
    return { endpointInfoSet };
  }

  private createEndpointDependencies(
    convertDate: number,
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
        lastUsageTimestamp: convertDate,
        dependingOn,
        dependingBy,
      });
    }

    return result;
  }
}