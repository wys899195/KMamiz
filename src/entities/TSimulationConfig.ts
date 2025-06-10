import { requestType } from "./TRequestType";

import { z } from "zod";

/**** Yaml format checking ****/
const endpointIdSchema = z.preprocess(
  (val) => (typeof val === "number" ? val.toString() : val),
  z.string()
    .refine(s => s.trim().length > 0, { message: "endpointId cannot be empty." })
    .transform(s => s.trim())
);
const versionSchema = z.preprocess(
  (val) => (typeof val === "number" ? val.toString() : val),
  z.string()
    .refine(s => s.trim().length > 0, { message: "version cannot be empty." })
    .transform(s => s.trim())
);
const statusCodeSchema = z.union([
  z.number().int().refine((val) => val >= 100 && val <= 599, {
    message: "Invalid status. It must be between 100 and 599.",
  }),
  z.string().refine((val) => {
    const num = Number(val);
    return Number.isInteger(num) && num >= 100 && num <= 599;
  }, {
    message: "Invalid status. It must be an integer string between 100 and 599.",
  }),
]).transform((val) => String(val));
export const simulationResponseBodySchema = z.object({
  status: statusCodeSchema,
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
  endpointId: endpointIdSchema,
  endpointInfo: simulationEndpointInfoSchema,
  datatype: simulationEndpointDatatypeSchema.optional(),
}).strict();

export const simulationServiceVersionSchema = z.object({
  serviceId: z.string().optional(),  // Users do not need to provide this; it will be populated by the system later.
  version: versionSchema,
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
  endpointId: endpointIdSchema,
  callRate: z.number().refine(
    (val) => val >= 0 && val <= 100,
    { message: "Invalid callRate. It must be between 0 and 100." }
  ).optional(),
}).strict();

export const simulationEndpointDependencySchema = z.object({
  endpointId: endpointIdSchema,
  dependOn: z.array(simulationDependOnSchema),
}).strict();


export const loadSimulationConfigSchema = z.object({
  simulationDurationInDays: z.number()
    .int({ message: "simulationDurationInDays must be an integer." })
    .min(1, { message: "simulationDurationInDays must be at least 1." })
    .max(7, { message: "simulationDurationInDays cannot exceed 7." }),
  // TODO: May expand with additional config options such as chaosMonkeyEnabled, errorRateAmplificationFactor, etc.
}).strict();

export const simulationServiceVersionMetricSchema = z.object({
  serviceId: z.string().optional(),   // Users do not need to provide this; it will be populated by the system later.
  version: versionSchema,
  capacityPerReplica: z.number()
    .int({ message: "capacityPerReplica must be an integer." })
    .min(1, { message: "capacityPerReplica must be at least 1." })
    .optional()
    .default(1),
}).strict();

export const simulationServiceMetricSchema = z.object({
  serviceName: z.string().min(1, { message: "serviceName cannot be empty." }),
  versions: z.array(simulationServiceVersionMetricSchema),
}).strict();

export const simulationEndpointMetricSchema = z.object({
  endpointId: endpointIdSchema,
  latencyMs: z
    .number()
    .min(0, { message: "latencyMs must be zero or greater." })
    .optional().default(0),
  errorRatePercentage: z
    .number()
    .refine((val) => val >= 0 && val <= 100, {
      message: "Invalid errorRate. It must be between 0 and 100.",
    })
    .optional().default(0),
  expectedExternalDailyRequestCount: z
    .number()
    .int({ message: "expectedExternalDailyRequestCount must be an integer." })
    .min(0, { message: "expectedExternalDailyRequestCount cannot be negative." })
    .optional().default(0),
  fallbackEnabled: z
    .boolean()
    .optional().default(false),

}).strict();

export const loadSimulationSchema = z.object({
  config: loadSimulationConfigSchema.optional(),
  serviceMetrics: z.array(simulationServiceMetricSchema),
  endpointMetrics: z.array(simulationEndpointMetricSchema),
}).strict();

export const simulationConfigYAMLSchema = z.object({
  servicesInfo: z.array(simulationNamespaceSchema),
  endpointDependencies: z.array(simulationEndpointDependencySchema),
  loadSimulation: loadSimulationSchema.optional(),
}).strict();


// servicesInfo
export type TSimulationResponseBody = z.infer<typeof simulationResponseBodySchema>;
export type TSimulationEndpointDatatype = z.infer<typeof simulationEndpointDatatypeSchema>;
export type TSimulationEndpointInfo = z.infer<typeof simulationEndpointInfoSchema>;
export type TSimulationEndpoint = z.infer<typeof simulationEndpointSchema>;
export type TSimulationServiceVersion = z.infer<typeof simulationServiceVersionSchema>;
export type TSimulationService = z.infer<typeof simulationServiceSchema>;
export type TSimulationNamespace = z.infer<typeof simulationNamespaceSchema>;

// endpointDependencies
export type TSimulationDependOn = z.infer<typeof simulationDependOnSchema>;
export type TSimulationEndpointDependency = z.infer<typeof simulationEndpointDependencySchema>;

//  Load Simulation config
export type TLoadSimulationConfig = z.infer<typeof loadSimulationConfigSchema>;
export type TSimulationServiceVersionMetric = z.infer<typeof simulationServiceVersionMetricSchema>;
export type TSimulationServiceMetric = z.infer<typeof simulationServiceMetricSchema>;
export type TSimulationEndpointMetric = z.infer<typeof simulationEndpointMetricSchema>;
export type TLoadSimulation = z.infer<typeof loadSimulationSchema>;


export type TSimulationConfigYAML = z.infer<typeof simulationConfigYAMLSchema>;



/**** Simulation config related type ****/
export type TSimulationConfigErrors = {
  errorLocation: string;   // Description of where the error occurred
  message: string;
}
export type TSimulationConfigProcessResult = {
  errorMessage: string;
  parsedConfig: TSimulationConfigYAML | null;  // Parsed YAML object if successful, else null
}

export type BodyInputType = "sample" | "typeDefinition" | "empty" | "unknown";