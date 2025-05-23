import { Types } from "mongoose";
import { TRequestTypeUpper } from "./TRequestType";

export type TCombinedRealtimeData = {
  _id?: Types.ObjectId;
  uniqueServiceName: string;
  uniqueEndpointName: string;
  latestTimestamp: number;
  method: TRequestTypeUpper;
  service: string;
  namespace: string;
  version: string;
  latency: {
    scaledMean: number; // = (Original Mean Latency) / 10^scaleLevel
    scaledDivBase: number; // = (Sum of Squared Original Latencies) / 10^(2 * scaleLevel)
    cv: number;
    scaleLevel: number; // Exponent for scaling latency values (by 10^scaleLevel) to prevent numeric overflow in variance calculations
  };
  status: string;
  combined: number;
  responseBody?: any;
  responseSchema?: string;
  responseContentType?: string;
  requestBody?: any;
  requestSchema?: string;
  requestContentType?: string;
  avgReplica?: number;
};
