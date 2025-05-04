
import Simulator from './Simulator';
import DependencyGraphSimulator from './DependencyGraphSimulator';
import {
  TSimulationEndpointDatatype,
  TSimulationNamespace,
} from "../../entities/TSimulationYAML";

import { TRealtimeData } from "../../entities/TRealtimeData";
import { TReplicaCount } from "../../entities/TReplicaCount";
import { TEndpointDependency } from "../../entities/TEndpointDependency";
import { TRequestTypeUpper } from "../../entities/TRequestType";
import { TEndpointDataType } from "../../entities/TEndpointDataType";

import { EndpointDependencies } from "../EndpointDependencies";
import { RealtimeDataList } from "../RealtimeDataList";

import { CEndpointDependencies } from "../Cacheable/CEndpointDependencies";
import DataCache from "../../services/DataCache";

import Logger from "../../utils/Logger";

export default class StaticSimulator extends Simulator {
  private static instance?: StaticSimulator;
  static getInstance = () => this.instance || (this.instance = new this());

  yamlToSimulationStaticData(yamlString: string): {
    validationErrorMessage: string; // error message when validating YAML format
    convertingErrorMessage: string; // error message when converting to realtime data
    endpointDependencies: TEndpointDependency[];
    dataType: TEndpointDataType[]
    replicaCountList: TReplicaCount[];
  } {
    const { validationErrorMessage, parsedYAML } = this.validateAndParseYAML(yamlString);

    if (!parsedYAML) {
      return {
        validationErrorMessage: validationErrorMessage,
        convertingErrorMessage: "",
        endpointDependencies: [],
        dataType: [],
        replicaCountList: [],
      };
    }

    const convertDate = Date.now();
    const {
      endpointInfoSet
    } = DependencyGraphSimulator.getInstance().extractEndpointsInfo(parsedYAML.endpointsInfo,convertDate);

    const {
      sampleRlDataList,
      replicaCountList
    } = this.extractSampleDataAndReplicaCount(parsedYAML.endpointsInfo,convertDate);

    const {
      dependOnMap,
      dependByMap
    } = DependencyGraphSimulator.getInstance().buildDependencyMaps(parsedYAML.endpointDependencies);
    console.log(dependOnMap)

    const endpointDependencies = DependencyGraphSimulator.getInstance().createEndpointDependencies(
      convertDate,
      endpointInfoSet,
      dependOnMap,
      dependByMap,
    );

    try {
      console.log(sampleRlDataList)
      return {
        validationErrorMessage: "",
        convertingErrorMessage: "",
        ...this.convertRawToStaticData(
          sampleRlDataList,
          endpointDependencies
        ),
        replicaCountList: replicaCountList,
      };
    } catch (err) {
      const errMsg = `${err instanceof Error ? err.message : err}`;
      Logger.error("Failed to convert simulationRawData to static data, skipping.");
      Logger.verbose("-detail: ",errMsg);
      return {
        validationErrorMessage: "",
        convertingErrorMessage: `Failed to convert simulationRawData to static data:\n ${errMsg}`,
        endpointDependencies: [],
        dataType: [],
        replicaCountList: [],
      };
    }
  }

  convertRawToStaticData(
    sampleRlDataList: TRealtimeData[],
    endpointDependencies: TEndpointDependency[],
  ) {
    const sampleCbdata = new RealtimeDataList(sampleRlDataList).toCombinedRealtimeData();
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
      dataType: dataType.map((d) => d.toJSON()),
    }
  }

  private extractSampleDataAndReplicaCount(
    endpointsInfo: TSimulationNamespace[],
    convertDate: number
  ): {
    sampleRlDataList: TRealtimeData[];
    replicaCountList: TReplicaCount[];
  } {
    const sampleRlDataList: TRealtimeData[] = []; // to extract static data types even without traffic
    const replicaCountList: TReplicaCount[] = [];
    const processedUniqueServiceNameSet = new Set<string>();

    for (const ns of endpointsInfo) {
      for (const svc of ns.services) {
        for (const ver of svc.versions) {
          const uniqueServiceName = `${svc.serviceName}\t${ns.namespace}\t${ver.version}`;

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
            const host = `http://${svc.serviceName}.${ns.namespace}.svc.cluster.local`;
            const { path, method } = ep.endpointInfo;
            const url = `${host}${path}`; // port default 80
            const methodUpperCase = method.toUpperCase() as TRequestTypeUpper;
            const uniqueEndpointName = `${uniqueServiceName}\t${methodUpperCase}\t${url}`;

            // create a realtimeData
            this.collectEndpointRealtimeData(
              sampleRlDataList,
              uniqueServiceName,
              uniqueEndpointName,
              ns.namespace,
              svc.serviceName,
              ver.version,
              methodUpperCase,
              convertDate,
              ep.datatype,
            );
          }
        }
      }
    }

    return { sampleRlDataList, replicaCountList};
  }

  private collectEndpointRealtimeData(
    sampleRlDataList: TRealtimeData[],
    uniqueServiceName: string,
    uniqueEndpointName: string,
    namespace: string,
    service: string,
    version: string,
    methodUpperCase: TRequestTypeUpper,
    convertDate: number,
    datatype?: TSimulationEndpointDatatype,
  ) {
    // Create a response map based on datatype
    const respMap = new Map<string, { body: string; contentType: string }>();
    datatype?.responses?.forEach(r => {
      respMap.set(r.status, {
        body: r.responseBody,
        contentType: r.responseContentType
      });
    });
    const sampleStatuses = [...respMap.keys()];

    sampleRlDataList.push(...sampleStatuses.map(status => ({
      uniqueServiceName,
      uniqueEndpointName,
      timestamp: convertDate * 1000, // microseconds
      method: methodUpperCase,
      service,
      namespace,
      version,
      latency: 0,
      status,
      responseBody: respMap.get(status)?.body,
      responseContentType: respMap.get(status)?.contentType,
      requestBody: datatype?.requestBody,
      requestContentType: datatype?.requestContentType,
      replica: undefined
    })));
  }

}