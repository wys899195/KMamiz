import { JSONSchemaType } from "ajv";

export type TSimulationResponseBody = {
  status: string;
  responseContentType: string;
  responseBody: string;
};

export type TSimulationEndpointDatatype = {
  requestContentType: string;
  requestBody: string;
  responses: TSimulationResponseBody[];
};

export type TSimulationEndpointInfo = {
  path: string;
  method: string;
};

export type TSimulationEndpoint = {
  endpointUniqueId: string;
  endpointInfo: TSimulationEndpointInfo;
  datatype?: TSimulationEndpointDatatype;
};

export type TSimulationServiceVersion = {
  version: string;
  replica?: number;
  endpoints: TSimulationEndpoint[];
};

export type TSimulationService = {
  service: string;
  versions: TSimulationServiceVersion[];
};

export type TSimulationNamespace = {
  namespace: string;
  services: TSimulationService[];
};

export type TSimulationEndpointDependency = {
  endpointUniqueId: string;
  dependOn: string[];
};

export type TSimulationRequestErrorRate = {
  status: string;
  rate: number;
};

export type TSimulationTrafficInfo = {
  endpointUniqueId: string;
  requestCount: number;
  latency: number;
  requestErrorRate: TSimulationRequestErrorRate[];
};

export type TSimulationYAML = {
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

export const simulationYAMLSchema: JSONSchemaType<TSimulationYAML> = {
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
