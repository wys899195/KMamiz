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


export type TEndpointPropagationStatsForOneTimeSlot = {
  requestCount: number;
  ownErrorCount: number;        // Number of errors originating from the endpointNode itself
  downstreamErrorCount: number; // Number of errors caused by downstream endpointNodes
  latencyStatsByStatus: Map<string, { mean: number; cv: number }>; //Key: status code, Value: latency statistics (mean and coefficient of variation) for all requests with this status code

};