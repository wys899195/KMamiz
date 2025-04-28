import yaml from "js-yaml";
import Simulator from './Simulator';
import { TGraphData, TNode, TLink } from "../../entities/TGraphData";
import {
  TSimulationService,
  TSimulationYAML,
  TSimulationEndpoint,
} from "../../entities/TSimulationYAML";

export default class DependencyGraphSimulator extends Simulator {
  private static instance?: DependencyGraphSimulator;
  static getInstance = () => this.instance || (this.instance = new this());

  yamlToGraphData(yamlString: string): {
    validationErrorMessage: string
    graph: TGraphData,
  } {
    const { validationErrorMessage, parsedYAML } = this.validateAndParseYAML(yamlString);
    const rootNode: TNode = {
      id: "null",
      group: "null",
      name: "external requestsS",
      dependencies: [],
      linkInBetween: [],
      usageStatus: "Active",
    };

    if (!parsedYAML) {
      return {
        validationErrorMessage,
        graph: {
          nodes: [rootNode],
          links: []
        },
      };
    }
    const nodes: TNode[] = [];
    const links: TLink[] = [];
    const existLinks = new Set<string>();
    const existLabels = new Set<string>();
    const endpointUniqueIdMap: { [key: string]: string } = {};
    const dependedByMap: Map<string, string[]> = new Map();

    // root node (external)
    nodes.push(rootNode);

    // create endpoint ID mapping and initialize dependedByMap
    parsedYAML.endpointsInfo.forEach((ns) => {
      ns.services.forEach((svc) => {
        const serviceId = `${svc.service}\t${ns.namespace}`;
        svc.versions.forEach((v) => {
          v.endpoints.forEach((ep) => {
            const endpointId = `${serviceId}\t${v.version}\t${ep.endpointInfo.method.toUpperCase()}\t${ep.endpointInfo.path}`;
            endpointUniqueIdMap[String(ep.endpointUniqueId)] = endpointId;
            dependedByMap.set(endpointId, []);
          });
        });
      });
    });

    // create nodes and service-endpoint links
    parsedYAML.endpointsInfo.forEach((ns) => {
      ns.services.forEach((svc) => {
        const serviceId = `${svc.service}\t${ns.namespace}`;
        nodes.push({
          id: serviceId,
          group: serviceId,
          name: serviceId.replace("\t", "."),
          dependencies: [],
          linkInBetween: [],
          usageStatus: "Active",
        });

        svc.versions.forEach((v) => {
          v.endpoints.forEach((ep) => {
            const endpointId = `${serviceId}\t${v.version}\t${ep.endpointInfo.method.toUpperCase()}\t${ep.endpointInfo.path}`;
            const endpointName = `(${v.version}) ${ep.endpointInfo.method.toUpperCase()} ${ep.endpointInfo.path}`;

            if (!existLabels.has(endpointId)) {
              nodes.push({
                id: endpointId,
                group: serviceId,
                name: endpointName,
                dependencies: [],
                linkInBetween: [],
                usageStatus: "Active",
              });
              existLabels.add(endpointId);
            }

            if (!existLinks.has(`${serviceId}\t${endpointId}`)) {
              links.push({ source: serviceId, target: endpointId });
              existLinks.add(`${serviceId}\t${endpointId}`);
            }
          });
        });
      });
    });

    // handle endpointDependencies to create endpoint-endpoint links
    parsedYAML.endpointDependencies.forEach((dep) => {
      const fromId = endpointUniqueIdMap[String(dep.endpointUniqueId)];
      if (!fromId) return;

      dep.dependOn.forEach((targetUniqueId) => {
        const toId = endpointUniqueIdMap[targetUniqueId];
        if (toId) {
          if (!existLinks.has(`${fromId}\t${toId}`)) {
            links.push({ source: fromId, target: toId });
            existLinks.add(`${fromId}\t${toId}`);
          }
          dependedByMap.get(toId)?.push(fromId);
        }
      });
    });

    // link from external root node if the endpoint is not depended on by anyone
    dependedByMap.forEach((dependedBy, endpointId) => {
      if (dependedBy.length === 0) {
        if (!existLinks.has(`null\t${endpointId}`)) {
          links.push({ source: "null", target: endpointId });
          existLinks.add(`null\t${endpointId}`);
        }
      }
    });

    const graph = { nodes, links };
    return {
      validationErrorMessage,
      graph,
    };
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
      const serviceObj: TSimulationService = { service: serviceName, versions: [] };
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
            method,
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
    const dependencyMap = new Map<string, string[]>();
    graph.links.forEach((link) => {
      const sourceId = endpointUniqueIdMap.get(link.source);
      const targetId = endpointUniqueIdMap.get(link.target);

      if (!sourceId || !targetId) return; // skip non-endpoint-to-endpoint links.
      if (!dependencyMap.has(sourceId)) {
        dependencyMap.set(sourceId, []);
      }

      dependencyMap.get(sourceId)!.push(targetId);
    });

    dependencyMap.forEach((dependOn, endpointUniqueId) => {
      yamlObj.endpointDependencies.push({ endpointUniqueId, dependOn });
    });

    return yaml.dump(yamlObj, { lineWidth: -1 });

  }

}

