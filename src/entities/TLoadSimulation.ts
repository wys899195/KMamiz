import { TRealtimeData } from "./TRealtimeData";
import {
  TSimulationEndpointDatatype,
} from "./TSimulationConfig";

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

/* Fault Injection */
export class Fault {
  private _increaseLatency: number;
  private _increaseErrorRatePercent: number;

  constructor(
    latency: number = 0,
    errorRate: number = 0
  ) {
    this._increaseLatency = Math.max(0, latency);
    this._increaseErrorRatePercent = Math.min(Math.max(0, errorRate), 100);
  }

  setIncreaseLatency(nextIncreaseLatency: number) {
    this._increaseLatency = Math.max(0, nextIncreaseLatency);
  }
  setIncreaseErrorRatePercent(nextErrorRate: number) {
    this._increaseErrorRatePercent = Math.min(Math.max(0, nextErrorRate), 100);
  }

  getIncreaseLatency() {
    return this._increaseLatency;
  }
  getIncreaseErrorRatePercent() {
    return this._increaseErrorRatePercent;
  }
}