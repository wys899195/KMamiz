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
type TEndpointTrafficStats = {
  requestCount: number;
  errorCount: number;
  maxLatency: number;
};

// Request statistics for all endpoints in a specific minute
// (key: endpoint ID, value: statistics for that endpoint)
type TMinuteTrafficStatsMap = Map<string, TEndpointTrafficStats>;

// Request statistics for all minutes in a specific hour
// (key: minute of the hour (0–59), value: TMinuteTrafficStatsMap for that minute)
type THourlyTrafficStatsMap = Map<number, TMinuteTrafficStatsMap>;

// Request statistics for 24 hours in a specific day 
// (key: hour of the day (0–23), value: HourlyStatsMap for that hour)
type TDailyTrafficStatsMap = Map<number, THourlyTrafficStatsMap>;

// Simulation results for all dates in the simulation period of a single run 
// (key: day index (0 ~ simulationDurationInDays -1), value: DailyStatsMap for that day)
export type TTrafficSimulationResult = Map<number, TDailyTrafficStatsMap>;