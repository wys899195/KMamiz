import { requestType } from "./TRequestType";

import { z } from "zod";

export const simulationResponseBodySchema = z.object({
  status: z.number().int().refine(
    (val) => val >= 100 && val <= 599,
    { message: "Invalid status. It must be between 100 and 599." }
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
  path: z.string().min(1, { message: "path cannot not be empty." }),
  method: z.enum(requestType),
}).strict();

export const simulationEndpointSchema = z.object({
  endpointUniqueId: z.preprocess(
    (val) => (typeof val === "number" ? val.toString() : val),
    z.string().min(1, { message: "endpointUniqueId cannot be empty." })
  ),
  endpointInfo: simulationEndpointInfoSchema,
  datatype: simulationEndpointDatatypeSchema.optional(),
}).strict();

export const simulationServiceVersionSchema = z.object({
  version: z.preprocess(
    (val) => (typeof val === "number" ? val.toString() : val),
    z.string().min(1, { message: "service name cannot be empty." })
  ),
  replica: z.number()
    .int({ message: "replica must be an integer." })
    .min(1, { message: "replica (the number of service instances) must be at least 1 to simulate injection." })
    .optional(),
  endpoints: z.array(simulationEndpointSchema),
}).strict();

export const simulationServiceSchema = z.object({
  serviceName: z.string().min(1, { message: "service name cannot be empty." }),
  versions: z.array(simulationServiceVersionSchema),
}).strict();

export const simulationNamespaceSchema = z.object({
  namespace: z.string(),
  services: z.array(simulationServiceSchema),
}).strict();

export const simulationDependOnSchema = z.object({
  endpointUniqueId: z.preprocess(
    (val) => (typeof val === "number" ? val.toString() : val),
    z.string().min(1, { message: "endpointUniqueId cannot be empty." })
  ),
  callRate: z.number().refine(
    (val) => val >= 0 && val <= 100,
    { message: "Invalid errorRate. It must be between 0 and 100." }
  ).optional(),
});


export const simulationEndpointDependencySchema = z.object({
  endpointUniqueId: z.preprocess(
    (val) => (typeof val === "number" ? val.toString() : val),
    z.string().min(1, { message: "endpointUniqueId cannot be empty." })
  ),
  dependOn: z.array(simulationDependOnSchema),
})
  .strict();


export const simulationEndpointMetricSchema = z.object({
  endpointUniqueId: z.preprocess(
    (val) => (typeof val === "number" ? val.toString() : val),
    z.string().min(1, { message: "endpointUniqueId cannot be empty." })
  ),
  latencyMs: z.number().min(0, { message: "latencyMs must be zero or greater." }),
  errorRate: z.number().refine(
    (val) => val >= 0 && val <= 100,
    { message: "Invalid errorRate. It must be between 0 and 100." }
  ).optional(),
  requestCount: z.number()
    .int({ message: "requestCount must be an integer." })
    .min(0, { message: "requestCount cannot be negative." }).optional(),
}).strict();

export const simulationYAMLSchema = z.object({
  endpointsInfo: z.array(simulationNamespaceSchema),
  endpointDependencies: z.array(simulationEndpointDependencySchema),
  endpointMetrics: z.array(simulationEndpointMetricSchema).optional(),
}).strict();

export type TSimulationResponseBody = z.infer<typeof simulationResponseBodySchema>;
export type TSimulationEndpointDatatype = z.infer<typeof simulationEndpointDatatypeSchema>;
export type TSimulationEndpointInfo = z.infer<typeof simulationEndpointInfoSchema>;
export type TSimulationEndpoint = z.infer<typeof simulationEndpointSchema>;
export type TSimulationServiceVersion = z.infer<typeof simulationServiceVersionSchema>;
export type TSimulationService = z.infer<typeof simulationServiceSchema>;
export type TSimulationNamespace = z.infer<typeof simulationNamespaceSchema>;
export type TSimulationDependOn = z.infer<typeof simulationDependOnSchema>;
export type TSimulationEndpointDependency = z.infer<typeof simulationEndpointDependencySchema>;
export type TSimulationEndpointMetric = z.infer<typeof simulationEndpointMetricSchema>;
export type TSimulationYAML = z.infer<typeof simulationYAMLSchema>;

