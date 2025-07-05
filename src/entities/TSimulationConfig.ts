import { requestType } from "./TRequestType";

import { z } from "zod";

/**** Yaml format checking ****/

// Users do not need to provide uniqueServiceName; it will be populated by the system later.
const uniqueServiceNameNotProvided = (data: { uniqueServiceName?: string }) => data.uniqueServiceName === undefined;
const uniqueServiceNameRefineOptions = {
  message: "uniqueServiceName is a system-generated field and should not be provided.",
  path: ["uniqueServiceName"],
};
const uniqueEndpointNameNotProvided = (data: { uniqueEndpointName?: string }) => data.uniqueEndpointName === undefined;
const uniqueEndpointNameRefineOptions = {
  message: "uniqueEndpointName is a system-generated field and should not be provided.",
  path: ["uniqueEndpointName"],
};



const fallbackStrategies = [
  "failIfAnyDependentFail",
  "failIfAllDependentFail",
  "ignoreDependentFail",
] as const;
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
  uniqueEndpointName: z.string().optional(),// Users do not need to provide this.
  endpointId: endpointIdSchema,
  endpointInfo: simulationEndpointInfoSchema,
  datatype: simulationEndpointDatatypeSchema.optional(),
}).strict().refine(uniqueEndpointNameNotProvided, uniqueEndpointNameRefineOptions);

export const simulationServiceVersionSchema = z.object({
  uniqueServiceName: z.string().optional(),// Users do not need to provide this.
  version: versionSchema,
  replica: z.number()
    .int({ message: "replica must be an integer." })
    .min(0, { message: "replica (the number of service instances) must be at least 0 to simulate injection." })
    .default(1),
  endpoints: z.array(simulationEndpointSchema),
}).strict().refine(uniqueServiceNameNotProvided, uniqueServiceNameRefineOptions);

export const simulationServiceSchema = z.object({
  serviceName: z.string().min(1, { message: "service name cannot be empty." }),
  versions: z.array(simulationServiceVersionSchema),
}).strict();

export const simulationNamespaceSchema = z.object({
  namespace: z.string(),
  services: z.array(simulationServiceSchema),
}).strict();

export const simulationDependOnSchema = z.object({
  uniqueEndpointName: z.string().optional(),// Users do not need to provide this.
  endpointId: endpointIdSchema,
  callRate: z.number().refine(
    (val) => val >= 0 && val <= 100,
    { message: "Invalid callRate. It must be between 0 and 100." }
  ).optional(),//TODO
}).strict().refine(uniqueEndpointNameNotProvided, uniqueEndpointNameRefineOptions);

export const simulationEndpointDependencySchema = z.object({
  uniqueEndpointName: z.string().optional(),// Users do not need to provide this.
  endpointId: endpointIdSchema,
  dependOn: z.array(simulationDependOnSchema),
}).strict().refine(uniqueEndpointNameNotProvided, uniqueEndpointNameRefineOptions);


export const loadSimulationConfigSchema = z.object({
  simulationDurationInDays: z.number()
    .int({ message: "simulationDurationInDays must be an integer." })
    .min(1, { message: "simulationDurationInDays must be at least 1." })
    .max(7, { message: "simulationDurationInDays cannot exceed 7." })
    .default(1),
  mutationRatePercentage: z
    .number()
    .refine((val) => val >= 0 && val <= 100, {
      message: "Invalid mutationRatePercentage. It must be between 0 and 100.",
    }).default(25),
  // TODO: May expand with additional config options such as chaosMonkeyEnabled, errorRateAmplificationFactor, etc.
}).strict().default({
  simulationDurationInDays: 1,
  mutationRatePercentage: 25,
});

export const simulationServiceVersionMetricSchema = z.object({
  uniqueServiceName: z.string().optional(),// Users do not need to provide this.
  version: versionSchema,
  capacityPerReplica: z.number()
    .int({ message: "capacityPerReplica must be an integer." })
    .min(1, { message: "capacityPerReplica must be at least 1." })
    .default(1),
}).strict().refine(uniqueServiceNameNotProvided, uniqueServiceNameRefineOptions);

export const simulationServiceMetricSchema = z.object({
  serviceName: z.string().min(1, { message: "serviceName cannot be empty." }),
  versions: z.array(simulationServiceVersionMetricSchema),
}).strict();

export const simulationNamespaceServiceMetricsSchema = z.object({
  namespace: z.string(),
  services: z.array(simulationServiceMetricSchema),
}).strict();

const endpointDelaySchema = z.object({
  latencyMs: z.number().min(0, { message: "latencyMs must be zero or greater." }).default(0),
  jitterMs: z.number().min(0, { message: "jitterMs must be zero or greater." }).default(0),
}).strict().default({
  latencyMs: 0,
  jitterMs: 0,
});

export const simulationEndpointMetricSchema = z.object({
  uniqueEndpointName: z.string().optional(),// Users do not need to provide this.
  endpointId: endpointIdSchema,
  delay: endpointDelaySchema,
  errorRatePercent: z
    .number()
    .refine((val) => val >= 0 && val <= 100, {
      message: "Invalid errorRate. It must be between 0 and 100.",
    })
    .default(0),
  expectedExternalDailyRequestCount: z
    .number()
    .int({ message: "expectedExternalDailyRequestCount must be an integer." })
    .min(0, { message: "expectedExternalDailyRequestCount cannot be negative." })
    .default(0),
  fallbackStrategy: z.enum(fallbackStrategies).default(fallbackStrategies[0]),
}).strict().refine(uniqueEndpointNameNotProvided, uniqueEndpointNameRefineOptions);



const faultTimeSchema = z.object({
  day: z.number().int().min(1).max(7),
  startHour: z.number().int().min(0).max(23),
  durationHours: z.number().int().min(1),
});

const faultTargetServiceSchema = z.object({
  serviceName: z.string().min(1, { message: "serviceName cannot be empty." }),
  namespace: z.string().min(1, { message: "namespace cannot be empty." }),
  version: versionSchema.optional(),  // If not specified, applies to all versions of the service
}).strict();

const faultTargetEndpointSchema = z.object({
  uniqueEndpointName: z.string().optional(),// Users do not need to provide this.
  endpointId: endpointIdSchema,
}).strict().refine(uniqueEndpointNameNotProvided, uniqueEndpointNameRefineOptions);

const increaseLatencyFaultSchema = z.object({
  type: z.literal("increase-latency"),
  targets: z.object({
    services: z.array(faultTargetServiceSchema).default([]),
    endpoints: z.array(faultTargetEndpointSchema).default([]),
  }).strict(),
  time: faultTimeSchema,
  increaseLatencyMs: z
    .number()
    .min(0, { message: "increaseLatencyMs must be zero or greater." })
}).strict();

const increaseErrorRateFaultSchema = z.object({
  type: z.literal("increase-error-rate"),
  targets: z.object({
    services: z.array(faultTargetServiceSchema).default([]),
    endpoints: z.array(faultTargetEndpointSchema).default([]),
  }).strict(),
  time: faultTimeSchema,
  increaseErrorRatePercent: z
    .number()
    .refine((val) => val >= 0 && val <= 100, {
      message: "Invalid errorRate. It must be between 0 and 100.",
    })
}).strict();

const reduceInstanceFaultSchema = z.object({
  type: z.literal("reduce-instance"),
  targets: z.object({
    services: z.array(faultTargetServiceSchema).default([]),
  }).strict(),
  time: faultTimeSchema,
  reduceCount: z.number().int().min(1),
}).strict();

export const faultsSchema = z.array(
  z.discriminatedUnion("type", [
    increaseLatencyFaultSchema,
    increaseErrorRateFaultSchema,
    reduceInstanceFaultSchema,
  ])
);


export const loadSimulationSchema = z.object({
  config: loadSimulationConfigSchema,
  serviceMetrics: z.array(simulationNamespaceServiceMetricsSchema),
  endpointMetrics: z.array(simulationEndpointMetricSchema),
  faults: faultsSchema.optional(),
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
export type TSimulationNamespaceServiceMetrics = z.infer<typeof simulationNamespaceServiceMetricsSchema>;
export type TSimulationEndpointDelay = z.infer<typeof endpointDelaySchema>;
export type TSimulationEndpointMetric = z.infer<typeof simulationEndpointMetricSchema>;
export type TSimulationFaults = z.infer<typeof faultsSchema>;
export type TLoadSimulationSettings = z.infer<typeof loadSimulationSchema>;


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

export type TFallbackStrategy = typeof fallbackStrategies[number];