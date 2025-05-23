import Utils from "../utils/Utils";
import { TRealtimeData } from "../entities/TRealtimeData";
import { TCombinedRealtimeData } from "../entities/TCombinedRealtimeData";
import Logger from "../utils/Logger";
import CombinedRealtimeDataList from "./CombinedRealtimeDataList";

export class RealtimeDataList {
  private readonly _realtimeData: TRealtimeData[];
  constructor(realtimeData: TRealtimeData[]) {
    this._realtimeData = realtimeData;
  }

  toJSON() {
    return this._realtimeData;
  }

  getContainingNamespaces() {
    return new Set(this._realtimeData.map((r) => r.namespace));
  }

  //to avoid standard deviation growing too fast causing overflow
  calculateScaleFactor(latencies: number[]): { scaleFactor: number; scaleLevel: number } {
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

  toCombinedRealtimeData() {
    const uniqueNameMapping = new Map<string, TRealtimeData[]>();
    this._realtimeData.forEach((r) => {
      const id = r.uniqueEndpointName;
      uniqueNameMapping.set(id, (uniqueNameMapping.get(id) || []).concat([r]));
    });

    const combined = [...uniqueNameMapping.values()]
      .map((group): TCombinedRealtimeData[] => {
        const statusMap = new Map<string, TRealtimeData[]>();
        group.forEach((r) => {
          statusMap.set(r.status, (statusMap.get(r.status) || []).concat([r]));
        });
        const sample = group[0];
        const baseSample = {
          uniqueServiceName: sample.uniqueServiceName,
          uniqueEndpointName: sample.uniqueEndpointName,
          service: sample.service,
          namespace: sample.namespace,
          version: sample.version,
          method: sample.method,
        };

        const combinedSubGroup = [...statusMap.entries()].map(
          ([status, subGroup]): TCombinedRealtimeData => {

            const latencies = subGroup.map((r) => r.latency);

            // Scale latency values to avoid overflow in variance calculation when latencies are large
            const { scaleFactor, scaleLevel } = this.calculateScaleFactor(latencies);
            const scaledLatencies = scaleFactor === 1 ? latencies : latencies.map(l => l / scaleFactor);
            const latencyDivBaseScaled = Utils.ToPrecise(
              scaledLatencies.reduce((prev, curr) => prev + curr * curr, 0)
            );
            const latencyMeanScaled = Utils.ToPrecise(
              scaledLatencies.reduce((prev, curr) => prev + curr, 0) / scaledLatencies.length
            );
            const cv = Utils.ToPrecise(
              Math.sqrt(latencyDivBaseScaled / scaledLatencies.length - Math.pow(latencyMeanScaled, 2))
              / latencyMeanScaled
            ) || 0;

            const combined = subGroup.reduce((prev, curr) => {
              const acc = { ...prev };
              acc.requestBody = Utils.MergeStringBody(
                acc.requestBody,
                curr.requestBody
              );
              acc.responseBody = Utils.MergeStringBody(
                acc.responseBody,
                curr.responseBody
              );
              acc.timestamp =
                acc.timestamp > curr.timestamp ? acc.timestamp : curr.timestamp;
              if (acc.replica && curr.replica) acc.replica += curr.replica;
              return acc;
            });
            const { requestBody, requestSchema, responseBody, responseSchema } =
              RealtimeDataList.parseRequestResponseBody(combined);

            return {
              ...baseSample,
              status,
              combined: subGroup.length,
              requestBody,
              requestSchema,
              responseBody,
              responseSchema,
              avgReplica: combined.replica
                ? combined.replica / subGroup.length
                : undefined,
              latestTimestamp: combined.timestamp,
              latency: {
                scaledMean: latencyMeanScaled,
                scaledDivBase: latencyDivBaseScaled,
                cv,
                scaleLevel: scaleLevel,
              },
              requestContentType: combined.requestContentType,
              responseContentType: combined.responseContentType,
            };
          }
        );
        return combinedSubGroup;
      })
      .flat();

    return new CombinedRealtimeDataList(combined);
  }

  static parseRequestResponseBody(data: Partial<TRealtimeData>): {
    requestBody?: unknown;
    requestSchema?: string;
    responseBody?: unknown;
    responseSchema?: string;
  } {
    const result: {
      requestBody?: unknown;
      requestSchema?: string;
      responseBody?: unknown;
      responseSchema?: string;
    } = {};

    if (data.requestContentType === "application/json") {
      try {
        result.requestBody = JSON.parse(data.requestBody!);
        result.requestSchema = Utils.ObjectToInterfaceString(
          result.requestBody
        );
      } catch (e) {
        Logger.verbose(`Not a JSON, skipping: [${data.requestBody}]`);
        result.requestBody = result.requestSchema = undefined;
      }
    }
    if (data.responseContentType === "application/json") {
      try {
        result.responseBody = JSON.parse(data.responseBody!);
        result.responseSchema = Utils.ObjectToInterfaceString(
          result.responseBody
        );
      } catch (e) {
        Logger.verbose(`Not a JSON, skipping: [${data.responseBody}]`);
        result.responseBody = result.responseSchema = undefined;
      }
    }
    return result;
  }
}
