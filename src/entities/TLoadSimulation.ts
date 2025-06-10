import { TRealtimeData } from "./TRealtimeData";
import {
  TSimulationEndpointDatatype,
} from "./TSimulationConfig";

/* TBaseDataWithResponses */
type TBaseRealtimeData = Omit<
  TRealtimeData,
  'latency' | 'status' | 'responseBody' | 'responseContentType' | 'timestamp'
>;

export type TBaseDataWithResponses = {
  baseData: TBaseRealtimeData,
  responses?: TSimulationEndpointDatatype['responses'],
}



/* TTrafficSimulationResult */
// Represents request statistics for a specific endpoint during a particular minutes
export type TEndpointTrafficStats = {
  requestCount: number;
  errorCount: number;
  maxLatency: number;
};