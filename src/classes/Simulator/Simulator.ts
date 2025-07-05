
import SimulationConfigManager from './SimulationConfigManager';
import SimEndpointDependencyBuilder from './SimEndpointDependencyBuilder';
import LoadSimulationHandler from './LoadSimulationHandler';
import {
  TSimulationEndpointDatatype,
  TSimulationNamespace,
  TSimulationResponseBody,
  TLoadSimulationSettings,
} from "../../entities/TSimulationConfig";
import { Fault } from '../../entities/TLoadSimulation';
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
      SimulationConfigManager.getInstance().handleSimConfig(configYamlString);

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
      SimEndpointDependencyBuilder.getInstance().buildEndpointDependenciesBySimConfig(
        parsedConfig,
        simulateDate
      )

    let realtimeCombinedDataPerTimeSlotMap: Map<string, TCombinedRealtimeData[]> = new Map();

    const loadSimulationSettings = parsedConfig.loadSimulation;

    if (loadSimulationSettings && loadSimulationSettings.endpointMetrics.length > 0) { //loadSimulationSettings.endpointMetrics.length > 0 means there is traffic.

      const allFaultRecords = this.generateAllFaultRecords(parsedConfig.servicesInfo, loadSimulationSettings, basicReplicaCountList);


      realtimeCombinedDataPerTimeSlotMap =
        LoadSimulationHandler.getInstance().generateCombinedRealtimeDataMap(
          loadSimulationSettings,
          dependOnMap,
          basicReplicaCountList,
          EndpointRealTimeBaseDatas,
          allFaultRecords,
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
    const basicReplicaCountList: TReplicaCount[] = [];
    const baseDataMap = new Map<string, TBaseDataWithResponses>();
    const processedUniqueServiceNameSet = new Set<string>();


    for (const ns of servicesInfo) {
      for (const svc of ns.services) {
        for (const ver of svc.versions) {
          const uniqueServiceName = ver.uniqueServiceName!;

          // to avoid duplicate processing of the same service
          if (processedUniqueServiceNameSet.has(uniqueServiceName)) continue;
          processedUniqueServiceNameSet.add(uniqueServiceName);

          // create replicaCount
          basicReplicaCountList.push({
            uniqueServiceName,
            service: svc.serviceName,
            namespace: ns.namespace,
            version: ver.version,
            replicas: ver.replica,
          });

          for (const ep of ver.endpoints) {
            const { method } = ep.endpointInfo;
            const methodUpperCase = method.toUpperCase() as TRequestTypeUpper;

            const baseData: TBaseRealtimeData = {
              uniqueServiceName,
              uniqueEndpointName: ep.uniqueEndpointName!,
              method: methodUpperCase,
              service: svc.serviceName,
              namespace: ns.namespace,
              version: ver.version,
              requestBody: ep.datatype?.requestBody,
              requestContentType: ep.datatype?.requestContentType,
            };

            baseDataMap.set(ep.uniqueEndpointName!, { baseData, responses: ep.datatype?.responses });

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

    return { sampleRealTimeDataList, basicReplicaCountList, baseDataMap };
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


  private generateAllFaultRecords(servicesInfo: TSimulationNamespace[], loadSimulationSettings: TLoadSimulationSettings, basicReplicaCountList: TReplicaCount[]) {
    /*
      allFaultRecords:
        -key:"day-hour-minute" 
        -value:
          -key:uniqueEndpointName
          -value:Fault object
    */
    const allFaultRecords = new Map<string, Map<string, Fault>>();

    const simulationDurationInDays = loadSimulationSettings.config.simulationDurationInDays;

    for (let day = 0; day < simulationDurationInDays; day++) {
      for (let hour = 0; hour < 24; hour++) {
        const timeSlotKey = `${day}-${hour}-0`;
        const faultRecordsInThisTimeslot = new Map<string, Fault>();
        allFaultRecords.set(timeSlotKey, faultRecordsInThisTimeslot)
      }
    }

    const replicaCountPerTimeSlot = new Map<string, Map<string, number>>();
    for (let day = 0; day < simulationDurationInDays; day++) {
      for (let hour = 0; hour < 24; hour++) {
        const timeSlotKey = `${day}-${hour}-0`;
        const replicaCountMapInThisTimeslot = new Map<string, number>(
          basicReplicaCountList.map(item => [item.uniqueServiceName, item.replicas])
        )
        replicaCountPerTimeSlot.set(timeSlotKey, replicaCountMapInThisTimeslot)
      }
    }

    //TODO:歷每個fault 將對應時段的故障注入到allFaultRecords
    const allEndpointsByService = new Map<string, string[]>(); // key: `${namespace}:${serviceName}:${version}` → uniqueEndpointName[]

    // 建立 service → endpoints 快取
    servicesInfo.forEach(ns => {
      ns.services.forEach(svc => {
        svc.versions.forEach(ver => {
          const key = `${ns.namespace}:${svc.serviceName}:${ver.version}`;
          allEndpointsByService.set(key, ver.endpoints.map(e => e.uniqueEndpointName!));
        });
      });
    });

    loadSimulationSettings.faults?.forEach(fault => {
      const isLatency = fault.type === 'increase-latency';
      const isErrorRate = fault.type === 'increase-error-rate';
      const isReduceInstance = fault.type === 'reduce-instance'
      if (isLatency || isErrorRate) {
        const { day, startHour, durationHours } = fault.time;
        const latency = isLatency ? fault.increaseLatencyMs ?? 0 : 0;
        const errorRate = isErrorRate ? fault.increaseErrorRatePercent ?? 0 : 0;

        const affecteduniqueEndpointNames = new Set<string>();

        // 處理 targets.services
        fault.targets?.services?.forEach(service => {
          const ns = service.namespace;
          const svc = service.serviceName;
          const ver = service.version;

          // version 有指定：精準找出
          if (ver) {
            const key = `${ns}:${svc}:${ver}`;
            const endpointList = allEndpointsByService.get(key);
            if (endpointList) {
              endpointList.forEach(eid => affecteduniqueEndpointNames.add(eid));
            }
          } else {
            // version 沒指定：抓所有版本
            for (const [key, eids] of allEndpointsByService.entries()) {
              const [kNs, kSvc, _] = key.split(':');
              if (kNs === ns && kSvc === svc) {
                eids.forEach(eid => affecteduniqueEndpointNames.add(eid));
              }
            }
          }
        });

        // 處理 targets.endpoints
        fault.targets?.endpoints?.forEach(ep => {
          affecteduniqueEndpointNames.add(ep.uniqueEndpointName!);
        });

        // 注入到每個時段
        for (let h = 0; h < durationHours; h++) {
          const currentHour = startHour + h;
          const actualDay = day + Math.floor(currentHour / 24) - 1;
          const actualHour = currentHour % 24;
          const timeSlotKey = `${actualDay}-${actualHour}-0`;
          const timeSlotMap = allFaultRecords.get(timeSlotKey);
          if (!timeSlotMap) continue;

          affecteduniqueEndpointNames.forEach(uniqueEndpointName => {
            let faultObj = timeSlotMap.get(uniqueEndpointName);
            if (!faultObj) {
              faultObj = new Fault();
              timeSlotMap.set(uniqueEndpointName, faultObj);
            }
            if (isLatency) {
              faultObj.setIncreaseLatency(latency);
            }
            if (isErrorRate) {
              faultObj.setIncreaseErrorRatePercent(errorRate);
            }
          });
        }
      }
      else if (isReduceInstance) {
        const reduceCount = fault.reduceCount ?? 0;

        const day = fault.time.day;
        const startHour = fault.time.startHour;
        const durationHours = fault.time.durationHours;
        const timeSlotKeys: string[] = [];
        for (let h = 0; h < durationHours; h++) {
          const totalHour = startHour + h;
          const actualDay = day + Math.floor(totalHour / 24) - 1;
          const actualHour = totalHour % 24;

          const timeSlotKey = `${actualDay}-${actualHour}-0`;
          timeSlotKeys.push(timeSlotKey);
        }

        //TODO


        fault.targets?.services?.forEach(service => {
          const ns = service.namespace;
          const svc = service.serviceName;
          const ver = service.version;

          const day = fault.time.day;
          const startHour = fault.time.startHour;
          const durationHours = fault.time.durationHours;

          const timeSlotKeys: string[] = [];
          for (let h = 0; h < durationHours; h++) {
            const totalHour = startHour + h;
            const actualDay = day + Math.floor(totalHour / 24) - 1;
            const actualHour = totalHour % 24;

            const timeSlotKey = `${actualDay}-${actualHour}-0`;
            timeSlotKeys.push(timeSlotKey);
          }



          const affectedServiceVersionKeys = new Set<string>();
          fault.targets?.services?.forEach(service => {
            const ns = service.namespace ?? '';
            const svc = service.serviceName;
            const ver = service.version;

            if (ver) {
              // 精準指定版本
              affectedServiceVersionKeys.add(`${svc.trim()}\t${ns.trim()}\t${ver.trim()}`);
            } else {
              // 未指定版本 → 加入所有版本（這裡先不篩選，等後續有 replicaCount 再過濾）
              for (const key of replicaCountPerTimeSlot.values().next().value?.keys() ?? []) {
                const [kNs, kSvc] = key.split(':');
                if (kNs === ns && kSvc === svc) {
                  affectedServiceVersionKeys.add(key);
                }
              }
            }
          });

          const matchingKeys: string[] = [];

          if (ver) {
            matchingKeys.push(`${ns}:${svc}:${ver}`);
          } else {
            // 找所有版本
            // 使用任一時間點的 replica map 抽出所有 key（代表所有 service:version）
            const anyReplicaMap = replicaCountPerTimeSlot.values().next().value;
            for (const key of anyReplicaMap?.keys?.() ?? []) {
              const [kNs, kSvc] = key.split(':');
              if (kNs === ns && kSvc === svc) {
                matchingKeys.push(key);
              }
            }
          }

          // 調整對應時段內的 replica 數量
          for (let h = 0; h < durationHours; h++) {
            const currentHour = startHour + h;
            const actualDay = day + Math.floor(currentHour / 24) - 1;
            const actualHour = currentHour % 24;
            const timeSlotKey = `${actualDay}-${actualHour}-0`;
            const replicaMap = replicaCountPerTimeSlot.get(timeSlotKey);
            if (!replicaMap) continue;

            matchingKeys.forEach(uniqueServiceName => {
              const original = replicaMap.get(uniqueServiceName) ?? 0;
              const updated = Math.max(0, original - reduceCount);
              replicaMap.set(uniqueServiceName, updated);
            });
          }
        });

      }


    });

    return allFaultRecords;
  }

}
