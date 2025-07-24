/**
 * Endpoint Fault Injection
 * 
 * Represents faults that can be targeted to specific endpoints or services.
 * This includes increaseLatency, increaseErrorRate,or injectTraffic.
 */
export class EndpointFault {
  private _increaseLatency: number;
  private _increaseErrorRatePercent: number;
  private _increseRequestCount: number;
  private _requestMultiplier: number;
  constructor(
    increaseLatency: number = 0,
    increaseErrorRatePercent: number = 0,
    increseRequestCount: number = 0,
    requestMultiplier: number = 0
  ) {
    this._increaseLatency = Math.max(0, increaseLatency);
    this._increaseErrorRatePercent = Math.min(Math.max(0, increaseErrorRatePercent), 100);
    this._increseRequestCount = Math.max(0, increseRequestCount);
    this._requestMultiplier = Math.max(0, requestMultiplier);
  }

  setIncreaseLatency(next: number) {
    this._increaseLatency = Math.max(0, next);
  }
  setIncreaseErrorRatePercent(next: number) {
    this._increaseErrorRatePercent = Math.min(Math.max(0, next), 100);
  }
  setIncreseRequestCount(next: number) {
    this._increseRequestCount = Math.max(0, next);
  }
  setRequestMultiplier(next: number) {
    this._requestMultiplier = Math.max(0, next);
  }

  getIncreaseLatency() {
    return this._increaseLatency;
  }
  getIncreaseErrorRatePercent() {
    return this._increaseErrorRatePercent;
  }
  getIncreseRequestCount(): number {
    return this._increseRequestCount;
  }
  getRequestMultiplier(): number {
    return this._requestMultiplier;
  }
}

/**
 * Service Fault Injection
 * 
 * Represents faults that target the service level, such as reduceInstance.
 */
export class ServiceFault {
  private _reducedReplicaCount: number;

  constructor(
    reducedReplicaCount: number = 0,
  ) {
    this._reducedReplicaCount = Math.max(0, reducedReplicaCount);
  }

  setReducedReplicaCount(next: number) {
    this._reducedReplicaCount = Math.max(0, next);
  }

  getReducedReplicaCount() {
    return this._reducedReplicaCount;
  }

}
