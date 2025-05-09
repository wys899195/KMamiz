require("dotenv").config();
import { LogLevels } from "./utils/Logger";

type Settings = {
  Port: string;
  Timezone: string;
  ApiVersion: string;
  LogLevel: LogLevels;
  KubeApiHost: string;
  IsRunningInKubernetes: boolean;
  ZipkinUrl: string;
  MongoDBUri: string;
  ExternalDataProcessor: string;
  AggregateInterval: string; // cron expression
  RealtimeInterval: string; // cron expression
  DispatchInterval: string; // cron expression
  EnvoyLogLevel: "info" | "warning" | "error";
  ResetEndpointDependencies: boolean;
  ReadOnlyMode: boolean;
  EnableTestingEndpoints: boolean;
  ServicePort: string;
  ServeOnly: boolean;
  InactiveEndpointThreshold: string;
  DeprecatedEndpointThreshold: string;
  SimulatorMode: boolean;
};

const {
  PORT,
  TZ,
  API_VERSION,
  LOG_LEVEL,
  KUBEAPI_HOST,
  ZIPKIN_URL,
  MONGODB_URI,
  EXTERNAL_DATA_PROCESSOR,
  AGGREGATE_INTERVAL,
  REALTIME_INTERVAL,
  DISPATCH_INTERVAL,
  ENVOY_LOG_LEVEL,
  IS_RUNNING_IN_K8S,
  KUBERNETES_SERVICE_HOST,
  KUBERNETES_SERVICE_PORT,
  RESET_ENDPOINT_DEPENDENCIES,
  READ_ONLY_MODE,
  ENABLE_TESTING_ENDPOINTS,
  SERVICE_PORT,
  SERVE_ONLY,
  INACTIVE_ENDPOINT_THRESHOLD,
  DEPRECATED_ENDPOINT_THRESHOLD,
  SIMULATOR_MODE,
} = process.env;

const GlobalSettings: Settings = {
  Port: PORT || "3000",
  Timezone: TZ || "Asia/Taipei",
  ApiVersion: API_VERSION || "1",
  LogLevel: (LOG_LEVEL as LogLevels | undefined) || "info",
  KubeApiHost: KUBEAPI_HOST || "http://127.0.0.1:8080",
  IsRunningInKubernetes: IS_RUNNING_IN_K8S === "true",
  ZipkinUrl: ZIPKIN_URL || "http://localhost:9411",
  MongoDBUri:
    MONGODB_URI || "mongodb://admin:admin@localhost:27017/?authSource=admin",
  ExternalDataProcessor: EXTERNAL_DATA_PROCESSOR || "",
  // default: every 5 minutes
  AggregateInterval: AGGREGATE_INTERVAL || "*/5 * * * *",
  // default: every 5 seconds
  RealtimeInterval: REALTIME_INTERVAL || "0/5 * * * *",
  // default: every 30 seconds
  DispatchInterval: DISPATCH_INTERVAL || "0/30 * * * *",
  EnvoyLogLevel:
    (ENVOY_LOG_LEVEL as "info" | "warning" | "error" | undefined) || "info",
  ResetEndpointDependencies: RESET_ENDPOINT_DEPENDENCIES === "true",
  ReadOnlyMode: READ_ONLY_MODE === "true",
  EnableTestingEndpoints: ENABLE_TESTING_ENDPOINTS === "true",
  ServicePort: SERVICE_PORT || PORT || "3000",
  ServeOnly: SERVE_ONLY === "true",
  InactiveEndpointThreshold: INACTIVE_ENDPOINT_THRESHOLD || "",
  DeprecatedEndpointThreshold: DEPRECATED_ENDPOINT_THRESHOLD || "",
  SimulatorMode: SIMULATOR_MODE === "true",
};

if (
  GlobalSettings.IsRunningInKubernetes &&
  KUBERNETES_SERVICE_HOST &&
  KUBERNETES_SERVICE_PORT
) {
  GlobalSettings.KubeApiHost = `https://${KUBERNETES_SERVICE_HOST}:${KUBERNETES_SERVICE_PORT}`;
}

export default GlobalSettings;
