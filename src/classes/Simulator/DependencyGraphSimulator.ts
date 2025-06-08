import yaml from "js-yaml";
import SimulationConfigManager from "./SimulationConfigManager";
import { TGraphData } from "../../entities/TGraphData";
import {
  TSimulationService,
  TSimulationConfigYAML,
  TSimulationEndpoint,
  TSimulationDependOn,
  TSimulationEndpointDependency,
  TSimulationNamespace,
} from "../../entities/TSimulationConfig";
import { TRequestType, TRequestTypeUpper } from '../../entities/TRequestType'
import { TEndpointDependency, TEndpointInfo } from "../../entities/TEndpointDependency";
import { EndpointDependencies } from "../EndpointDependencies";

export default class DependencyGraphSimulator {
  private static instance?: DependencyGraphSimulator;
  static getInstance = () => this.instance || (this.instance = new this());
  private constructor() { }

  yamlToGraphData(yamlString: string): {
    errorMessage: string,
    graph: TGraphData,
  } {
    const { errorMessage, parsedConfig } = SimulationConfigManager.getInstance().validateAndPrerocessSimConfig(yamlString);

    if (!parsedConfig) {
      return {
        errorMessage,
        graph: new EndpointDependencies([]).toGraphData(), // graph only has external node
      };
    } else {
      const endpointDependencies = this.parsedYamlToEndpointDependency(parsedConfig)
      return {
        errorMessage,
        graph: new EndpointDependencies(endpointDependencies).toGraphData(),
      };
    }
  }

  graphDataToYAML(graph: TGraphData): string {
    const yamlObj: TSimulationConfigYAML = { servicesInfo: [], endpointDependencies: [] };

    const endpointIdMap = new Map<string, string>();
    const endpointIdCounterMap: Map<string, number> = new Map();

    const endpointNodes = graph.nodes.filter(
      (node) => node.id !== "null" && node.id.split("\t").length === 5
    );// endpoint node has exactly 5 parts when split by "\t": service, namespace, version, method, path).
    const serviceNodes = graph.nodes.filter(
      (node) => node.id !== "null" && node.id.split("\t").length === 2
    );// service node has exactly 2 parts when split by "\t": service, namespace).

    // auto create endpointId to each endpoint
    endpointNodes.forEach((node) => {
      const [service, namespace, version, method] = node.id.split("\t");
      const newEndpointIdPrefix = `${namespace}-${service}-${version}-${method.toLowerCase()}-ep`;
      const serialNumber = (endpointIdCounterMap.get(newEndpointIdPrefix) || 1);
      const newEndpointId = `${newEndpointIdPrefix}-${serialNumber}`;
      endpointIdCounterMap.set(newEndpointIdPrefix, serialNumber + 1);
      endpointIdMap.set(node.id, newEndpointId);
    });

    // build servicesInfo 
    serviceNodes.forEach((serviceNode) => {
      const [serviceName, namespaceName] = serviceNode.id.split("\t");

      //find or create the corresponding namespace object
      let nsObj = yamlObj.servicesInfo.find((ns) => ns.namespace === namespaceName);
      if (!nsObj) {
        nsObj = { namespace: namespaceName, services: [] };
        yamlObj.servicesInfo.push(nsObj);
      }

      // create service object
      const serviceObj: TSimulationService = { serviceName: serviceName, versions: [] };
      nsObj.services.push(serviceObj);

      // get all endpoint nodes under this service
      const endpointsForService = endpointNodes.filter(
        (epNode) => epNode.group === serviceNode.id
      );

      const versionMap = new Map<string, { version: string; endpoints: TSimulationEndpoint[] }>();
      endpointsForService.forEach((epNode) => {
        const [, , version, method, path] = epNode.id.split("\t");
        const newEndpointId = endpointIdMap.get(epNode.id)!;
        const endpointObj: TSimulationEndpoint = {
          endpointId: newEndpointId,
          endpointInfo: {
            path: decodeURIComponent(path),
            method: method as TRequestType,
          },
        };

        if (!versionMap.has(version)) {
          versionMap.set(version, { version, endpoints: [] });
        }
        versionMap.get(version)!.endpoints.push(endpointObj);
      });

      // Add version data to the service object
      serviceObj.versions = Array.from(versionMap.values());
    });


    // build endpointDependencies
    const dependencyMap = new Map<string, TSimulationDependOn[]>();
    graph.links.forEach((link) => {
      const sourceId = endpointIdMap.get(link.source);
      const targetId = endpointIdMap.get(link.target);

      if (!sourceId || !targetId) return; // skip non-endpoint-to-endpoint links.
      if (!dependencyMap.has(sourceId)) {
        dependencyMap.set(sourceId, []);
      }

      dependencyMap.get(sourceId)!.push({
        endpointId: targetId
      });
    });

    dependencyMap.forEach((dependOn, endpointId) => {
      yamlObj.endpointDependencies.push({ endpointId, dependOn });
    });

    return yaml.dump(yamlObj, { lineWidth: -1 });

  }

  buildEndpointDependenciesAndDependOnMap(
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
      const from = dep.endpointId;
      const toList = dep.dependOn || [];

      let fromSet = dependOnMap.get(from);
      if (!fromSet) {
        fromSet = new Set();
        dependOnMap.set(from, fromSet);
      }

      toList.forEach(to => {
        // Establish dependency A -> B
        fromSet!.add(to.endpointId);

        // Establish reverse dependency B <- A
        let toSet = dependByMap.get(to.endpointId);
        if (!toSet) {
          toSet = new Set();
          dependByMap.set(to.endpointId, toSet);
        }
        toSet!.add(from);
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
          const uniqueServiceName = ver.serviceId!;

          // to avoid duplicate processing of the same service
          if (processedUniqueServiceNameSet.has(uniqueServiceName)) continue;
          processedUniqueServiceNameSet.add(uniqueServiceName);

          for (const ep of ver.endpoints) {

            const { path, method } = ep.endpointInfo;
            const methodUpperCase = method.toUpperCase() as TRequestTypeUpper;


            // create TEndpointInfo and insert into endpointInfoSet(used to create endpointDependencies)
            endpointInfoSet.set(ep.endpointId, {
              uniqueServiceName,
              uniqueEndpointName: ep.endpointId,
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

  private parsedYamlToEndpointDependency(parsedYAML: TSimulationConfigYAML) {
    const convertDate = Date.now();
    const {
      endpointInfoSet
    } = this.extractEndpointsInfo(
      parsedYAML.servicesInfo,
      convertDate,
    );

    const {
      dependOnMap,
      dependByMap
    } = this.buildDependencyMaps(parsedYAML.endpointDependencies);

    const endpointDependencies = this.createEndpointDependencies(
      convertDate,
      endpointInfoSet,
      dependOnMap,
      dependByMap,
    );

    return endpointDependencies;

  }
}