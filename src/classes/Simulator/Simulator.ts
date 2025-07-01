
import SimulationConfigManager from './SimulationConfigManager';
import DependencyGraphSimulator from './DependencyGraphSimulator';
import LoadSimulationHandler from './LoadSimulationHandler';
import {
  TSimulationEndpointDatatype,
  TSimulationNamespace,
  TSimulationResponseBody,
} from "../../entities/TSimulationConfig";
import DataCache from "../../services/DataCache";
import { TRealtimeData } from "../../entities/TRealtimeData";
import { TReplicaCount } from "../../entities/TReplicaCount";
import { TEndpointDependency } from "../../entities/TEndpointDependency";
import { TRequestTypeUpper } from "../../entities/TRequestType";
import EndpointDataType from '../EndpointDataType';
import { TCombinedRealtimeData } from "../../entities/TCombinedRealtimeData";
import { EndpointDependencies } from "../EndpointDependencies";
import { RealtimeDataList } from "../RealtimeDataList";

import { CEndpointDependencies } from "../Cacheable/CEndpointDependencies";
import Logger from "../../utils/Logger";

type TBaseRealtimeData = Omit<
  TRealtimeData,
  'latency' | 'status' | 'responseBody' | 'responseContentType' | 'timestamp'
>;

type TBaseDataWithResponses = {
  baseData: TBaseRealtimeData,
  responses?: TSimulationEndpointDatatype['responses'],
}

export default class Simulator {
  private static instance?: Simulator;
  static getInstance = () => this.instance || (this.instance = new this());
  private constructor() { };

  generateSimulationDataFromConfig(configYamlString: string): {
    validationErrorMessage: string; // error message when validating YAML format
    convertingErrorMessage: string; // error message when converting to realtime data
    endpointDependencies: TEndpointDependency[];
    dataType: EndpointDataType[];
    basicReplicaCountList: TReplicaCount[];
    realtimeCombinedDataPerTimeSlotMap: Map<string, TCombinedRealtimeData[]>
  } {
    const { errorMessage, parsedConfig } =
      SimulationConfigManager.getInstance().validateAndPrerocessSimConfig(configYamlString);

    if (!parsedConfig) {
      return {
        validationErrorMessage: errorMessage,
        convertingErrorMessage: "",
        endpointDependencies: [],
        dataType: [],
        basicReplicaCountList: [],
        realtimeCombinedDataPerTimeSlotMap: new Map(),
      };
    }

    const simulateDate = Date.now();// The time at the start of the simulation.


    const {
      sampleRealTimeDataList,// to extract simulation data types even without traffic
      basicReplicaCountList,
      baseDataMap: EndpointRealTimeBaseDatas
    } = this.collectSampleRealtimeDataAndReplicaCounts(
      parsedConfig.servicesInfo,
      simulateDate
    );

    const { dependOnMap, endpointDependencies } =
      DependencyGraphSimulator.getInstance().buildEndpointDependencies(
        parsedConfig,
        simulateDate
      )

    let realtimeCombinedDataPerTimeSlotMap: Map<string, TCombinedRealtimeData[]> = new Map();

    if (parsedConfig.loadSimulation && parsedConfig.loadSimulation.endpointMetrics.length > 0) {
      realtimeCombinedDataPerTimeSlotMap =
        LoadSimulationHandler.getInstance().generateCombinedRealtimeDataMap(
          parsedConfig.loadSimulation,
          dependOnMap,
          basicReplicaCountList,
          EndpointRealTimeBaseDatas,
          simulateDate
        )
    }

    try {
      return {
        validationErrorMessage: "",
        convertingErrorMessage: "",
        ...this.convertRawToSimulationData(
          sampleRealTimeDataList,
          endpointDependencies
        ),
        basicReplicaCountList,
        realtimeCombinedDataPerTimeSlotMap
      };
    } catch (err) {
      const errMsg = `${err instanceof Error ? err.message : err}`;
      Logger.error("Failed to convert simulationRawData to simulation data, skipping.");
      Logger.verbose("-detail: ", errMsg);
      return {
        validationErrorMessage: "",
        convertingErrorMessage:
          `Failed to convert simulationRawData to simulation data:\n ${errMsg}`,
        endpointDependencies: [],
        dataType: [],
        basicReplicaCountList: [],
        realtimeCombinedDataPerTimeSlotMap: new Map(),
      };
    }
  }

  private convertRawToSimulationData(
    sampleRealTimeDataList: TRealtimeData[],
    endpointDependencies: TEndpointDependency[],
  ) {
    const sampleCbdata = new RealtimeDataList(sampleRealTimeDataList).toCombinedRealtimeData();
    const dataType = sampleCbdata.extractEndpointDataType();
    const existingDep = DataCache.getInstance()
      .get<CEndpointDependencies>("EndpointDependencies")
      .getData()?.toJSON();
    const newDep = new EndpointDependencies(endpointDependencies);
    const dep = existingDep
      ? new EndpointDependencies(existingDep).combineWith(newDep)
      : newDep;

    return {
      endpointDependencies: dep.toJSON(),
      dataType: dataType,
    }
  }

  private collectSampleRealtimeDataAndReplicaCounts(
    servicesInfo: TSimulationNamespace[],
    simulateDate: number,
  ): {
    sampleRealTimeDataList: TRealtimeData[];
    basicReplicaCountList: TReplicaCount[];
    baseDataMap: Map<string, TBaseDataWithResponses>;
  } {
    const sampleRealTimeDataList: TRealtimeData[] = [];
    const replicaCountList: TReplicaCount[] = [];
    const baseDataMap = new Map<string, TBaseDataWithResponses>();
    const processedUniqueServiceNameSet = new Set<string>();


    for (const ns of servicesInfo) {
      for (const svc of ns.services) {
        for (const ver of svc.versions) {
          const uniqueServiceName = ver.serviceId!;

          // to avoid duplicate processing of the same service
          if (processedUniqueServiceNameSet.has(uniqueServiceName)) continue;
          processedUniqueServiceNameSet.add(uniqueServiceName);

          // create replicaCount
          replicaCountList.push({
            uniqueServiceName,
            service: svc.serviceName,
            namespace: ns.namespace,
            version: ver.version,
            replicas: ver.replica ?? 1,
          });

          for (const ep of ver.endpoints) {
            const { method } = ep.endpointInfo;
            const methodUpperCase = method.toUpperCase() as TRequestTypeUpper;

            const baseData: TBaseRealtimeData = {
              uniqueServiceName,
              uniqueEndpointName: ep.endpointId,
              method: methodUpperCase,
              service: svc.serviceName,
              namespace: ns.namespace,
              version: ver.version,
              requestBody: ep.datatype?.requestBody,
              requestContentType: ep.datatype?.requestContentType,
            };

            baseDataMap.set(ep.endpointId, { baseData, responses: ep.datatype?.responses });

            // collect endpoint sample data (fake realtime data)
            const endpointSampleData = this.generateSampleRealtimeDataForEndpoint(
              simulateDate,
              baseData,
              ep.datatype?.responses
            );
            sampleRealTimeDataList.push(...endpointSampleData);
          }
        }
      }
    }

    return { sampleRealTimeDataList, basicReplicaCountList: replicaCountList, baseDataMap };
  }

  private generateSampleRealtimeDataForEndpoint(
    simulateDate: number,
    baseData: TBaseRealtimeData,
    responses?: TSimulationResponseBody[],
  ): TRealtimeData[] {
    // Create a response map based on datatype
    const respMap = new Map<string, { body: string; contentType: string }>();
    responses?.forEach(r => {
      respMap.set(String(r.status), {
        body: r.responseBody,
        contentType: r.responseContentType
      });
    });
    const sampleStatuses = [...respMap.keys()];

    const endpointSampleData: TRealtimeData[] = sampleStatuses.map(status => ({
      ...baseData,
      latency: 0,
      timestamp: simulateDate * 1000, // microseconds
      status,
      responseBody: respMap.get(status)?.body,
      responseContentType: respMap.get(status)?.contentType,
    }))

    return endpointSampleData;
  }



}
