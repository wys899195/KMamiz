import { z } from "zod";

export const simulationResponseBodySchema = z.object({
  status: z.number().int().refine(
    (val) => val >= 100 && val <= 599,
    { message: "Invalid status code. Must be 100~599." }
  ).transform((val) => val.toString()),
  responseContentType: z.string(),
  responseBody: z.string(),
}).strict();

export const simulationEndpointDatatypeSchema = z.object({
  requestContentType: z.string(),
  requestBody: z.string(),
  responses: z.array(simulationResponseBodySchema),
}).strict();

export const simulationEndpointInfoSchema = z.object({
  path: z.string(),
  method: z.string(),
}).strict();

export const simulationEndpointSchema = z.object({
  endpointUniqueId: z.preprocess(
    (val) => (typeof val === "number" ? val.toString() : val),
    z.string()
  ),
  endpointInfo: simulationEndpointInfoSchema,
  datatype: simulationEndpointDatatypeSchema.optional(),
}).strict();

export const simulationServiceVersionSchema = z.object({
  version: z.preprocess(
    (val) => (typeof val === "number" ? val.toString() : val),
    z.string()
  ),
  replica: z.number()
    .int({ message: "replica must be an integer." })
    .min(1, { message: "replica (the number of service instances) must be at least 1 to simulate traffic injection." })
    .optional(),
  endpoints: z.array(simulationEndpointSchema),
}).strict();

export const simulationServiceSchema = z.object({
  service: z.string(),
  versions: z.array(simulationServiceVersionSchema),
}).strict();

export const simulationNamespaceSchema = z.object({
  namespace: z.string(),
  services: z.array(simulationServiceSchema),
}).strict();

export const simulationEndpointDependencySchema = z.object({
  endpointUniqueId: z.preprocess(
    (val) => (typeof val === "number" ? val.toString() : val),
    z.string()
  ),
  dependOn: z.array(z.string()),
}).strict();

export const simulationStatusRateSchema = z.object({
  status: z.number().int().refine(
    (val) => val >= 100 && val <= 599,
    { message: "Invalid status code. Must be 100~599." }
  ).transform((val) => val.toString()), 
  rate: z.number().min(0).max(100),
}).strict();

export const simulationTrafficInfoSchema = z.object({
  endpointUniqueId: z.preprocess(
    (val) => (typeof val === "number" ? val.toString() : val),
    z.string()
  ),
  requestCount: z.number()
    .int({ message: "requestCount must be an integer." })
    .min(0, { message: "requestCount cannot be negative." }),
  latency: z.number().min(0, { message: "latency must be zero or greater." }),
  statusRate: z.array(simulationStatusRateSchema).optional(),
}).strict();

export const simulationYAMLSchema = z.object({
  endpointsInfo: z.array(simulationNamespaceSchema),
  endpointDependencies: z.array(simulationEndpointDependencySchema),
  trafficsInfo: z.array(simulationTrafficInfoSchema).optional(),
}).strict();

export type TSimulationResponseBody       = z.infer<typeof simulationResponseBodySchema>;
export type TSimulationEndpointDatatype   = z.infer<typeof simulationEndpointDatatypeSchema>;
export type TSimulationEndpointInfo       = z.infer<typeof simulationEndpointInfoSchema>;
export type TSimulationEndpoint           = z.infer<typeof simulationEndpointSchema>;
export type TSimulationServiceVersion     = z.infer<typeof simulationServiceVersionSchema>;
export type TSimulationService            = z.infer<typeof simulationServiceSchema>;
export type TSimulationNamespace          = z.infer<typeof simulationNamespaceSchema>;
export type TSimulationEndpointDependency = z.infer<typeof simulationEndpointDependencySchema>;
export type TSimulationStatusRate         = z.infer<typeof simulationStatusRateSchema>;
export type TSimulationTrafficInfo        = z.infer<typeof simulationTrafficInfoSchema>;
export type TSimulationYAML               = z.infer<typeof simulationYAMLSchema>;

