import yaml from "js-yaml";
import Simulator from './Simulator';
import { TGraphData } from "../../entities/TGraphData";
import {
  TSimulationService,
  TSimulationYAML,
  TSimulationEndpoint,
  TSimulationDependOn,
  TSimulationEndpointDependency,
  TSimulationNamespace,
} from "../../entities/TSimulationYAML";
import {TRequestType, TRequestTypeUpper} from '../../entities/TRequestType'
import {TEndpointDependency, TEndpointInfo } from "../../entities/TEndpointDependency";
import { EndpointDependencies } from "../EndpointDependencies";

export default class DependencyGraphSimulator extends Simulator {
  private static instance?: DependencyGraphSimulator;
  static getInstance = () => this.instance || (this.instance = new this());

  yamlToGraphData(yamlString: string): {
    validationErrorMessage: string
    graph: TGraphData,
  } {
    const { validationErrorMessage, parsedYAML } = this.validateAndParseYAML(yamlString);

    if (!parsedYAML) {
      return {
        validationErrorMessage,
        graph: new EndpointDependencies([]).toGraphData(), // graph only has external node
      };
    } else {
      const endpointDependencies = this.parsedYamlToEndpointDependency(parsedYAML)
      return {
        validationErrorMessage,
        graph: new EndpointDependencies(endpointDependencies).toGraphData(),
      };
    }
  }
  
  graphDataToYAML(graph: TGraphData): string {
    const yamlObj: TSimulationYAML = { endpointsInfo: [], endpointDependencies: [] };

    const endpointUniqueIdMap = new Map<string, string>();
    const endpointUniqueIdCounterMap: Map<string, number> = new Map();

    const endpointNodes = graph.nodes.filter(
      (node) => node.id !== "null" && node.id.split("\t").length === 5
    );// endpoint node has exactly 5 parts when split by "\t": service, namespace, version, method, path).
    const serviceNodes = graph.nodes.filter(
      (node) => node.id !== "null" && node.id.split("\t").length === 2
    );// service node has exactly 2 parts when split by "\t": service, namespace).

    // auto create endpointUniqueId to each endpoint
    endpointNodes.forEach((node) => {
      const [service, namespace, version, method] = node.id.split("\t");
      const newEndpointIdPrefix = `${namespace}-${service}-${version}-${method.toLowerCase()}-ep`;
      const serialNumber = (endpointUniqueIdCounterMap.get(newEndpointIdPrefix) || 1);
      const newEndpointId = `${newEndpointIdPrefix}-${serialNumber}`;
      endpointUniqueIdCounterMap.set(newEndpointIdPrefix, serialNumber + 1);
      endpointUniqueIdMap.set(node.id, newEndpointId);
    });

    // build endpointsInfo
    serviceNodes.forEach((serviceNode) => {
      const [serviceName, namespaceName] = serviceNode.id.split("\t");

      //find or create the corresponding namespace object
      let nsObj = yamlObj.endpointsInfo.find((ns) => ns.namespace === namespaceName);
      if (!nsObj) {
        nsObj = { namespace: namespaceName, services: [] };
        yamlObj.endpointsInfo.push(nsObj);
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
        const newEndpointId = endpointUniqueIdMap.get(epNode.id)!;
        const endpointObj: TSimulationEndpoint = {
          endpointUniqueId: newEndpointId,
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
      const sourceId = endpointUniqueIdMap.get(link.source);
      const targetId = endpointUniqueIdMap.get(link.target);

      if (!sourceId || !targetId) return; // skip non-endpoint-to-endpoint links.
      if (!dependencyMap.has(sourceId)) {
        dependencyMap.set(sourceId, []);
      }

      dependencyMap.get(sourceId)!.push({
        endpointUniqueId: targetId
      });
    });

    dependencyMap.forEach((dependOn, endpointUniqueId) => {
      yamlObj.endpointDependencies.push({ endpointUniqueId, dependOn });
    });

    return yaml.dump(yamlObj, { lineWidth: -1 });

  }

  buildDependencyMaps(dependencies?: TSimulationEndpointDependency[]): {
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
        fromSet!.add(to.endpointUniqueId);

        // Establish reverse dependency B <- A
        let toSet = dependByMap.get(to.endpointUniqueId);
        if (!toSet) {
          toSet = new Set();
          dependByMap.set(to.endpointUniqueId, toSet);
        }
        toSet!.add(from);
      });
    });

    return { dependOnMap, dependByMap };
  }

  extractEndpointsInfo(
    endpointsInfo: TSimulationNamespace[],
    convertDate: number,
    existingUniqueEndpointNameMappings: Map<string, string>
  ): {
    endpointInfoSet: Map<string, TEndpointInfo>;
  } {

    const endpointInfoSet = new Map<string, TEndpointInfo>();
    const processedUniqueServiceNameSet = new Set<string>();
    
    console.log("existingUniqueEndpointNameMappings = ", JSON.stringify([...existingUniqueEndpointNameMappings.entries()]));
    for (const ns of endpointsInfo) {
      for (const svc of ns.services) {
        for (const ver of svc.versions) {
          const uniqueServiceName = `${svc.serviceName}\t${ns.namespace}\t${ver.version}`;

          // to avoid duplicate processing of the same service
          if (processedUniqueServiceNameSet.has(uniqueServiceName)) continue;
          processedUniqueServiceNameSet.add(uniqueServiceName);

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

            // create TEndpointInfo and insert into endpointInfoSet(used to create endpointDependencies)
            endpointInfoSet.set(ep.endpointUniqueId, {
              uniqueServiceName,
              uniqueEndpointName,
              service: svc.serviceName,
              namespace: ns.namespace,
              version: ver.version,
              labelName: path,
              url:"",
              host:"",
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

  createEndpointDependencies(
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

  private parsedYamlToEndpointDependency(parsedYAML: TSimulationYAML){
    const convertDate = Date.now();

    const existingUniqueEndpointNameMappings = this.getExistingUniqueEndpointNameMappings();
  
    const {
      endpointInfoSet
    } = this.extractEndpointsInfo(
      parsedYAML.endpointsInfo,
      convertDate,
      existingUniqueEndpointNameMappings
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