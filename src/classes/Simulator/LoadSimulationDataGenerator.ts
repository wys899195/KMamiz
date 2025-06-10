import {
  TCombinedRealtimeData
} from "../../entities/TCombinedRealtimeData";
import {
  TBaseDataWithResponses,
  TEndpointTrafficStats,
} from "../../entities/TLoadSimulation";
import Utils from "../../utils/Utils";


export default class LoadSimulationDataGenerator {

  generateRealtimeDataFromSimulationResults(
    baseDataMap: Map<string, TBaseDataWithResponses>,
    trafficPropagationResults: Map<string, Map<string, TEndpointTrafficStats>>,
    simulateDate: number
  ): Map<string, TCombinedRealtimeData[]> {
    const realtimeDataPerMinute = new Map<string, TCombinedRealtimeData[]>(); // key: "day-hour-minute"

    for (const [dayHourMinuteKey, minuteStats] of trafficPropagationResults.entries()) {
      // timestamp
      const [dayStr, hourStr, minuteStr] = dayHourMinuteKey.split('-');
      const day = parseInt(dayStr);
      const hour = parseInt(hourStr);
      const minute = parseInt(minuteStr);
      const dayMillis = simulateDate + day * 86400_000;
      const hourMillis = dayMillis + hour * 3600_000;
      const timestampMicro = (hourMillis + minute * 60_000) * 1000;


      const combinedList: TCombinedRealtimeData[] = [];
      for (const [endpointId, stats] of minuteStats.entries()) {
        const baseDataWithResp = baseDataMap.get(endpointId);
        if (!baseDataWithResp) continue;

        const { baseData, responses } = baseDataWithResp;
        const successCount = stats.requestCount - stats.errorCount;
        const errorCount = stats.errorCount;

        if (successCount > 0) {
          const resp2xx = responses?.find(r => r.status.startsWith("2"));
          combinedList.push({
            ...baseData,
            latestTimestamp: timestampMicro,
            requestSchema: undefined,
            responseSchema: undefined,
            responseBody: resp2xx?.responseBody,
            responseContentType: resp2xx?.responseContentType,
            combined: successCount,
            status: resp2xx?.status ?? "200",
            latency: this.computeLatencyCV(stats.maxLatency, successCount),
          });
        }

        if (errorCount > 0) {
          const resp5xx = responses?.find(r => r.status.startsWith("5"));
          combinedList.push({
            ...baseData,
            latestTimestamp: timestampMicro,
            requestSchema: undefined,
            responseSchema: undefined,
            responseBody: resp5xx?.responseBody,
            responseContentType: resp5xx?.responseContentType,
            combined: errorCount,
            status: resp5xx?.status ?? "500",
            latency: this.computeLatencyCV(stats.maxLatency, errorCount),
          });
        }
      }
      realtimeDataPerMinute.set(dayHourMinuteKey, combinedList);
    }
    return realtimeDataPerMinute;
  }

  private computeLatencyCV(
    baseLatency: number,
    count: number
  ): { scaledMean: number; scaledDivBase: number; cv: number; scaleLevel: number } {
    if (count <= 0) return { scaledMean: 0, scaledDivBase: 0, cv: 0, scaleLevel: 0 };

    // Generate jittered latencies
    const latencies: number[] = [];
    for (let i = 0; i < count; i++) {
      // Apply ±10% random fluctuation around baseLatency
      const jittered = Math.round(baseLatency * (0.9 + Math.random() * 0.2));
      latencies.push(jittered);
    }

    // Calculate scaleFactor and scaleLevel based on the range of latencies
    const { scaleFactor, scaleLevel } = this.calculateScaleFactor(latencies);

    // Apply the same scaling factor to all latency samples
    const scaled = latencies.map(l => l / scaleFactor);

    // Compute mean and sum of squares (divBase) on the scaled values
    const sum = scaled.reduce((s, v) => s + v, 0);
    const mean = sum / count;
    const divBase = scaled.reduce((s, v) => s + v * v, 0);

    // Compute variance and coefficient of variation (CV)
    const variance = divBase / count - mean * mean;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;

    return {
      scaledMean: Utils.ToPrecise(mean),
      scaledDivBase: Utils.ToPrecise(divBase),
      cv: Utils.ToPrecise(cv),
      scaleLevel
    };
  }

  private calculateScaleFactor(latencies: number[]): { scaleFactor: number; scaleLevel: number } {
    if (latencies.length === 0) return { scaleFactor: 1, scaleLevel: 0 };
    const minLatency = Math.min(...latencies);
    const maxLatency = Math.max(...latencies);
    if (minLatency <= 0 || maxLatency <= 0) return { scaleFactor: 1, scaleLevel: 0 };
    const minExp = Math.floor(Math.log10(minLatency));
    const maxExp = Math.floor(Math.log10(maxLatency));
    if (maxExp > 0) {
      return { scaleFactor: Math.pow(10, maxExp), scaleLevel: maxExp };
    } else if (minExp < 0) {
      return { scaleFactor: Math.pow(10, minExp), scaleLevel: minExp };
    }
    return { scaleFactor: 1, scaleLevel: 0 };
  }
}