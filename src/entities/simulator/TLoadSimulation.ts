import { TRealtimeData } from "../TRealtimeData";
import { TSimulationEndpointDatatype } from "./TSimConfigServiceInfo";

/* TBaseDataWithResponses */
type TBaseRealtimeData = Omit<
  TRealtimeData,
  'latency' | 'status' | 'responseBody' | 'responseContentType' | 'timestamp' | 'replica'
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

/*The DependOn Map with CallProbability is used for load simulation propagation*/
export type TTargetWithCallProbability = {
  targetEndpointUniqueEndpointName: string;
  callProbability: number;
};

// TDependOnCallProbabilityArray is a two-dimensional array.
// Each element of the outer array represents a group of dependent endpoints.
// The inner array contains the dependent endpoints within that group along with their corresponding call probabilities.
// Calls within the same group are mutually exclusive, meaning only one endpoint is randomly selected to be called.
// If the total call probability in the group is less than 100%, there is a chance that none of the endpoints will be called.
export type TDependOnMapWithCallProbability = Map<string, TTargetWithCallProbability[][]>;
