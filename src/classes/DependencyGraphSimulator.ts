import yaml from "js-yaml";
import Ajv, { JSONSchemaType } from "ajv";
import { TGraphData,TNode,TLink } from "../entities/TGraphData";


type TGraphSimulationYamlEndpoint = {
  path: string;
  method: string;
  endpointUniqueId: string;
  dependOn: string[];
};

type TGraphSimulationYamlVersion = {
  version: string;
  endpoints: TGraphSimulationYamlEndpoint[];
};

type TGraphSimulationYamlService = {
  service: string;
  versions: TGraphSimulationYamlVersion[];
};

type TGraphSimulationYamlNamespace = {
  namespace: string;
  services: TGraphSimulationYamlService[];
};

type TGraphSimulationYaml = {
  namespaces: TGraphSimulationYamlNamespace[];
};

const GraphSimulationYamlSchema:JSONSchemaType<TGraphSimulationYaml> = {
  type: "object",
  properties: {
    namespaces: {
      type: "array",
      items: {
        type: "object",
        properties: {
          namespace: { type: "string" },
          services: {
            type: "array",
            items: {
              type: "object",
              properties: {
                service: { type: "string" },
                versions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      version: { type: "string" },
                      endpoints: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            path: { type: "string" },
                            method: { type: "string" },
                            endpointUniqueId: { type: "string" },
                            dependOn: {
                              type: "array",
                              items: { type: "string" }
                            }
                          },
                          required: ["path", "method", "endpointUniqueId", "dependOn"]
                        }
                      }
                    },
                    required: ["version", "endpoints"]
                  }
                }
              },
              required: ["service", "versions"]
            }
          }
        },
        required: ["namespace", "services"]
      }
    }
  },
  required: ["namespaces"]
};


export default class DependencyGraphSimulator {
  private readonly _yamlSchemaValidator: Ajv;

  constructor() {
    this._yamlSchemaValidator = new Ajv();
  }


  isValidYamlFormatForDependencySimulation(yamlString: string) {
    try {
      const parsed = yaml.load(yamlString);
      const validate = this._yamlSchemaValidator.compile(GraphSimulationYamlSchema);
      if (validate(parsed)) {
        return { valid: true, message: "YAML format is correct" };
      } else {
        return { valid: false, message: "YAML format error: " + JSON.stringify(validate.errors) };
      }
    } catch (e) {
      return { valid: false, message: "An error occurred while parsing YAML: " + e }; 
    }
  }

  yamlToGraphData(yamlString: string):TGraphData {
    const parsedYaml = yaml.load(yamlString) as any;
  
    const nodes: TNode[] = [];
    const links: TLink[] = [];
    const existLinks = new Set<string>();
    const existLabels = new Set<string>();
    const endpointUniqueIdMap: { [key: string]: string } = {};
    const dependedByMap: Map<string, string[]> = new Map(); 
  
    // Root node (external)
    nodes.push({
      id: "null",
      group: "null",
      name: "external requestsS",
      dependencies: [],
      linkInBetween: [],
      usageStatus: "Active",
    });
  
    parsedYaml.namespaces.forEach((ns:any) => {
      ns.services.forEach((svc:any) => {
        svc.versions.forEach((v:any) => {
          v.endpoints.forEach((ep:any) => {
            const serviceId = `${svc.service}\t${ns.namespace}`;
            const endpointId = `${serviceId}\t${v.version}\t${ep.method.toUpperCase()}\t${ep.path}`;
            
            // Store the mapping of endpointUniqueId to endpointId
            if (!endpointUniqueIdMap.hasOwnProperty(ep.endpointUniqueId)) {
              endpointUniqueIdMap[ep.endpointUniqueId] = endpointId;
            }

            // Ensure each endpoint has an empty array in dependedByMapping.  
            dependedByMap.set(endpointId, []);
          });
        });
      });
    });
  
  
    // Process each namespace, service, and endpoint
    parsedYaml.namespaces.forEach((ns:any) => {
      ns.services.forEach((svc:any) => {
        // Create service node
        const serviceId = `${svc.service}\t${ns.namespace}`;
        nodes.push({
          id: serviceId,
          group: serviceId,
          name: serviceId.replace("\t", "."),
          dependencies: [],
          linkInBetween: [],
          usageStatus: "Active",
        });
        svc.versions.forEach((v:any) => {
          v.endpoints.forEach((ep:any) => {
            const endpointId = `${serviceId}\t${v.version}\t${ep.method.toUpperCase()}\t${ep.path}`;
            const endpointName = `(${v.version}) ${ep.method.toUpperCase()} ${ep.path}`;
  
            // Create endpoint node
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
  
            // service to endpoint links
            if (!existLinks.has(`${serviceId}\t${endpointId}`)) {
              links.push({
                source: serviceId,
                target: endpointId,
              });
              existLinks.add(`${serviceId}\t${endpointId}`);
            }
  
            // Process dependencies (dependOn)
            ep.dependOn.forEach((depId: string) => {
              const depEndpointId = endpointUniqueIdMap[depId];
  
              if (depEndpointId) {
                // endpoint to endpoint links
                if (!existLinks.has(`${endpointId}\t${depEndpointId}`)) {
                  links.push({
                    source: endpointId,
                    target: depEndpointId,
                  });
                  existLinks.add(`${endpointId}\t${depEndpointId}`);
                }
                // If depEndpointId exists in dependedByMapping, push endpointId into its array
                dependedByMap.get(depEndpointId)?.push(endpointId);
              } 
            });
          });
        });
      });
    });

    // Create links to root node
    dependedByMap.forEach((dependedBy, endpointId) => {
      if (dependedBy.length === 0) {
        if (!existLinks.has(`null\t${endpointId}`)) {
          links.push({
            source: "null",
            target: endpointId,
          });
          existLinks.add(`null\t${endpointId}`);
        }
      }
    });
  
    // Return the constructed graph data
    return { nodes, links };
  }

  graphDataToYaml(graph: TGraphData): string {
    const yamlObj: TGraphSimulationYaml = { namespaces: [] };

    const endpointUniqueIdMap = new Map<string, string>();
    const endpointUniqueIdCounterMap: Map<string, number> = new Map();

    const endpointNodes = graph.nodes.filter(
      (node) => node.id !== "null" && node.id.split("\t").length === 5
    );// endpoint node has exactly 5 parts when split by "\t": service, namespace, version, method, path).
    const serviceNodes = graph.nodes.filter(
      (node) => node.id !== "null" && node.id.split("\t").length === 2
    );// service node has exactly 2 parts when split by "\t": service, namespace).

    endpointNodes.forEach((node) => {
      const [service, namespace, version, method] = node.id.split("\t");
      const newEndpointIdPrefix = `ns-${namespace}-svc-${service}-${version}-ep-${method.toLowerCase()}`;
      const serialNumber = (endpointUniqueIdCounterMap.get(newEndpointIdPrefix) || 1);
      const newEndpointId = `${newEndpointIdPrefix}-${serialNumber}`;
      endpointUniqueIdCounterMap.set(newEndpointIdPrefix, serialNumber + 1);
      endpointUniqueIdMap.set(node.id, newEndpointId);
    });
  
    serviceNodes.forEach((serviceNode) => {
      const [serviceName, namespaceName] = serviceNode.id.split("\t");
  
      // Find or create the corresponding namespace object
      let nsObj = yamlObj.namespaces.find((ns) => ns.namespace === namespaceName);
      if (!nsObj) {
        nsObj = { namespace: namespaceName, services: [] };
        yamlObj.namespaces.push(nsObj);
      }
  
      // Create service object
      const serviceObj:TGraphSimulationYamlService = { service: serviceName, versions: [] };
      nsObj.services.push(serviceObj);
  
      // Get all endpoint nodes under this service
      const endpointsForService = endpointNodes.filter(
        (epNode) => epNode.group === serviceNode.id
      );

      const versionMap = new Map<string, { version: string; endpoints: TGraphSimulationYamlEndpoint[] }>();
      endpointsForService.forEach((epNode) => {
        const [, , version, method, path] = epNode.id.split("\t");
        const newEndpointId = endpointUniqueIdMap.get(epNode.id)!;
        const endpointObj: TGraphSimulationYamlEndpoint = {
          path,
          method,
          endpointUniqueId: newEndpointId,
          dependOn: [] as string[],
        };
    
        if (!versionMap.has(version)) {
          versionMap.set(version, { version, endpoints: [] });
        }
        versionMap.get(version)!.endpoints.push(endpointObj);
      });
    
      // Add version data to the service object
      serviceObj.versions = Array.from(versionMap.values());
    });
  
    // Based on the GraphData's links, fill in the dependOn data
    graph.links.forEach((link) => {
      const sourceParts = link.source.split("\t");
      const targetParts = link.target.split("\t");
      // Check if both source and target are endpoint nodes
      if (sourceParts.length === 5 && targetParts.length === 5) {
        const [sService, sNamespace, sVersion, sMethod, sPath] = sourceParts;
        const targetNewId = endpointUniqueIdMap.get(link.target);
        if (!targetNewId) return;
  
        // Find the corresponding endpoint object based on source node data
        const nsObj = yamlObj.namespaces.find((ns) => ns.namespace === sNamespace);
        if (!nsObj) return;
        const svcObj = nsObj.services.find((svc) => svc.service === sService);
        if (!svcObj) return;
        const verObj = svcObj.versions.find((v) => v.version === sVersion);
        if (!verObj) return;
        const epObj = verObj.endpoints.find((ep) => ep.method === sMethod && ep.path === sPath);
        if (epObj) {
          epObj.dependOn.push(targetNewId);
        }
      }
    });
  
    return yaml.dump(yamlObj);
  }
}
