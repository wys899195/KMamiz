import yaml from "js-yaml";
import Ajv, { JSONSchemaType } from "ajv";
import { TGraphData,TNode,TLink } from "../entities/TGraphData";

type TSimulationResponseBody = {
  status: string;
  responseContentType: string;
  responseBody: string;
};

type TSimulationEndpointDatatype = {
  requestContentType: string;
  requestBody: string;
  responses: TSimulationResponseBody[];
};

type TSimulationEndpointInfo = {
  path: string;
  method: string;
};

type TSimulationEndpoint = {
  endpointUniqueId: string;
  endpointInfo: TSimulationEndpointInfo;
  datatype?: TSimulationEndpointDatatype;
};

type TSimulationServiceVersion = {
  version: string;
  replica?: number;
  endpoints: TSimulationEndpoint[];
};

type TSimulationService = {
  service: string;
  versions: TSimulationServiceVersion[];
};

type TSimulationNamespace = {
  namespace: string;
  services: TSimulationService[];
};

type TSimulationEndpointDependency = {
  endpointUniqueId: string;
  dependOn: string[];
};

type TSimulationRequestErrorRate = {
  status: string;
  rate: number;
};

type TSimulationTrafficInfo = {
  endpointUniqueId: string;
  requestCount: number;
  latency: number;
  requestErrorRate: TSimulationRequestErrorRate[];
};

type TSimulationYaml = {
  endpointsInfo: TSimulationNamespace[];
  endpointDependencies: TSimulationEndpointDependency[];
  trafficsInfo?: TSimulationTrafficInfo[];
};

const simulationResponseBodySchema: JSONSchemaType<TSimulationResponseBody> = {
  type: "object",
  properties: {
    status: { type: "string" },
    responseContentType: { type: "string" },
    responseBody: { type: "string" },
  },
  required: ["status", "responseContentType", "responseBody"],
};

const simulationEndpointDatatypeSchema: JSONSchemaType<TSimulationEndpointDatatype> = {
  type: "object",
  properties: {
    requestContentType: { type: "string" },
    requestBody: { type: "string" },
    responses: {
      type: "array",
      items: simulationResponseBodySchema,
    },
  },
  required: ["requestContentType", "requestBody", "responses"],
};

const simulationEndpointInfoSchema: JSONSchemaType<TSimulationEndpointInfo> = {
  type: "object",
  properties: {
    path: { type: "string" },
    method: { type: "string" },
  },
  required: ["path", "method"],
};

const simulationEndpointSchema: JSONSchemaType<TSimulationEndpoint> = {
  type: "object",
  properties: {
    endpointUniqueId: { type: "string" },
    endpointInfo: simulationEndpointInfoSchema,
    datatype: {
      ...simulationEndpointDatatypeSchema,
      nullable: true,
    },
  },
  required: ["endpointUniqueId", "endpointInfo"],
};

const simulationServiceVersionSchema: JSONSchemaType<TSimulationServiceVersion> = {
  type: "object",
  properties: {
    version: { type: "string" },
    replica: { type: "integer", nullable: true },
    endpoints: {
      type: "array",
      items: simulationEndpointSchema,
    },
  },
  required: ["version", "endpoints"],
};

const simulationServiceSchema: JSONSchemaType<TSimulationService> = {
  type: "object",
  properties: {
    service: { type: "string" },
    versions: {
      type: "array",
      items: simulationServiceVersionSchema,
    },
  },
  required: ["service", "versions"],
};

const simulationNamespaceSchema: JSONSchemaType<TSimulationNamespace> = {
  type: "object",
  properties: {
    namespace: { type: "string" },
    services: {
      type: "array",
      items: simulationServiceSchema,
    },
  },
  required: ["namespace", "services"],
};

const simulationEndpointDependencySchema: JSONSchemaType<TSimulationEndpointDependency> = {
  type: "object",
  properties: {
    endpointUniqueId: { type: "string" },
    dependOn: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["endpointUniqueId", "dependOn"],
};

const simulationRequestErrorRateSchema: JSONSchemaType<TSimulationRequestErrorRate> = {
  type: "object",
  properties: {
    status: { type: "string" },
    rate: { type: "number" },
  },
  required: ["status", "rate"],
};

const simulationTrafficInfoSchema: JSONSchemaType<TSimulationTrafficInfo> = {
  type: "object",
  properties: {
    endpointUniqueId: { type: "string" },
    requestCount: { type: "integer" },
    latency: { type: "integer" },
    requestErrorRate: {
      type: "array",
      items: simulationRequestErrorRateSchema,
    },
  },
  required: ["endpointUniqueId", "requestCount", "latency", "requestErrorRate"],
};

const simulationYamlSchema: JSONSchemaType<TSimulationYaml> = {
  type: "object",
  properties: {
    endpointsInfo: {
      type: "array",
      items: simulationNamespaceSchema,
    },
    endpointDependencies: {
      type: "array",
      items: simulationEndpointDependencySchema,
    },
    trafficsInfo: {
      type: "array",
      items: simulationTrafficInfoSchema,
      nullable: true,
    },
  },
  required: ["endpointsInfo", "endpointDependencies"],
};


export default class DependencyGraphSimulator {
  private readonly _yamlSchemaValidator: Ajv;

  constructor() {
    this._yamlSchemaValidator = new Ajv();
  }

  isValidYamlFormatForDependencySimulation(yamlString: string) {
    try {
      const parsed = yaml.load(yamlString);
      const validate = this._yamlSchemaValidator.compile(simulationYamlSchema);
      if (validate(parsed)) {
        return { valid: true, message: "YAML format is correct" };
      } else {
        return { valid: false, message: "YAML format error: " + JSON.stringify(validate.errors) };
      }
    } catch (e) {
      return { valid: false, message: "An error occurred while parsing YAML: " + e };
    }
  }

  yamlToGraphData(yamlString: string): TGraphData {
    const parsedYaml = yaml.load(yamlString) as TSimulationYaml;

    const nodes: TNode[] = [];
    const links: TLink[] = [];
    const existLinks = new Set<string>();
    const existLabels = new Set<string>();
    const endpointUniqueIdMap: { [key: string]: string } = {};
    const dependedByMap: Map<string, string[]> = new Map();

    // root node (external)
    nodes.push({
      id: "null",
      group: "null",
      name: "external requestsS",
      dependencies: [],
      linkInBetween: [],
      usageStatus: "Active",
    });

    // create endpoint ID mapping and initialize dependedByMap
    parsedYaml.endpointsInfo.forEach((ns) => {
      ns.services.forEach((svc) => {
        const serviceId = `${svc.service}\t${ns.namespace}`;
        svc.versions.forEach((v) => {
          v.endpoints.forEach((ep) => {
            const endpointId = `${serviceId}\t${v.version}\t${ep.endpointInfo.method.toUpperCase()}\t${ep.endpointInfo.path}`;
            endpointUniqueIdMap[ep.endpointUniqueId] = endpointId;
            dependedByMap.set(endpointId, []);
          });
        });
      });
    });

    // create nodes and service-endpoint links
    parsedYaml.endpointsInfo.forEach((ns) => {
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
    parsedYaml.endpointDependencies.forEach((dep) => {
      const fromId = endpointUniqueIdMap[dep.endpointUniqueId];
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

    return { nodes, links };
  }

  graphDataToYaml(graph: TGraphData): string {
    const yamlObj: TSimulationYaml = { endpointsInfo: [], endpointDependencies: [] };

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

