
import yaml from "js-yaml";
import Simulator from './Simulator';
import DependencyGraphSimulator from './DependencyGraphSimulator';
import {
  TSimulationEndpointDatatype,
  TSimulationNamespace,
  TSimulationEndpointDependency,
  TSimulationResponseBody,
  TSimulationEndpoint,
  TSimulationYAML
} from "../../entities/TSimulationYAML";
import DataCache from "../../services/DataCache";
import { TRealtimeData } from "../../entities/TRealtimeData";
import { TReplicaCount } from "../../entities/TReplicaCount";
import { TEndpointDependency } from "../../entities/TEndpointDependency";
import { TRequestTypeUpper } from "../../entities/TRequestType";
import { TEndpointDataType } from "../../entities/TEndpointDataType";

import { EndpointDependencies } from "../EndpointDependencies";
import { RealtimeDataList } from "../RealtimeDataList";

import { CEndpointDependencies } from "../Cacheable/CEndpointDependencies";
import { CEndpointDataType } from "../Cacheable/CEndpointDataType";
import { CReplicas } from "../Cacheable/CReplicas";


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
    const existingUniqueEndpointNameMappings = this.getExistingUniqueEndpointNameMappings();

    const {
      endpointInfoSet
    } = DependencyGraphSimulator.getInstance().extractEndpointsInfo(
      parsedYAML.endpointsInfo, 
      convertDate,
      existingUniqueEndpointNameMappings
    );

    const {
      sampleRlDataList,
      replicaCountList
    } = this.extractSampleDataAndReplicaCount(
      parsedYAML.endpointsInfo, 
      convertDate,
      existingUniqueEndpointNameMappings
    );

    const {
      dependOnMap,
      dependByMap
    } = DependencyGraphSimulator.getInstance().buildDependencyMaps(parsedYAML.endpointDependencies);

    const endpointDependencies = DependencyGraphSimulator.getInstance().createEndpointDependencies(
      convertDate,
      endpointInfoSet,
      dependOnMap,
      dependByMap,
    );

    try {
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
      Logger.verbose("-detail: ", errMsg);
      return {
        validationErrorMessage: "",
        convertingErrorMessage: `Failed to convert simulationRawData to static data:\n ${errMsg}`,
        endpointDependencies: [],
        dataType: [],
        replicaCountList: [],
      };
    }
  }

  private convertRawToStaticData(
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
    convertDate: number,
    existingUniqueEndpointNameMappings: Map<string, string>
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

            const { path, method } = ep.endpointInfo;
            const methodUpperCase = method.toUpperCase() as TRequestTypeUpper;

            const uniqueEndpointName = this.generateUniqueEndpointName(
              uniqueServiceName,
              svc.serviceName,
              ns.namespace,
              methodUpperCase,
              path,
              existingUniqueEndpointNameMappings
            )
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

    return { sampleRlDataList, replicaCountList };
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
      respMap.set(String(r.status), {
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


  // Retrieve necessary data from kmamiz and convert it into a YAML file that can be used to generate static simulation data
  // (such as software quality metrics, dependency graphs, endpoint data formats, etc.)
  generateStaticYamlFromCurrentData() {
    const existingEndpointDependencies = DataCache.getInstance()
      .get<CEndpointDependencies>("EndpointDependencies")
      .getData()?.toJSON() || [];

    const existingReplicaCountList = DataCache.getInstance()
      .get<CReplicas>("ReplicaCounts")
      .getData() || [];

    const existingDataTypes = DataCache.getInstance()
      .get<CEndpointDataType>("EndpointDataType")
      .getData();


    const { endpointsInfoYaml, endpointUniqueIdMap } = this.buildEndpointsInfoYaml(
      existingDataTypes.map((d) => d.toJSON()),
      existingReplicaCountList
    );
    const endpointDependenciesYaml = this.buildEndpointDependenciesYaml(existingEndpointDependencies, endpointUniqueIdMap);
    const StaticSimulationYaml: TSimulationYAML = {
      endpointsInfo: endpointsInfoYaml,
      endpointDependencies: endpointDependenciesYaml
    }

    return this.formatEmptyJsonBodiesToMultilineYaml(
      yaml.dump(StaticSimulationYaml, { lineWidth: -1 })
    );
  }

  private formatEmptyJsonBodiesToMultilineYaml(rawYamlStr: string): string {
    //improves readability and makes it easier for users to edit the body manually.
    return rawYamlStr.replace(
      /^(\s*)(requestBody|responseBody): '{}'/gm,
      `$1$2: |-\n$1  {\n\n$1  }`
    );
  }

  private buildEndpointsInfoYaml(
    dataType: TEndpointDataType[],
    replicaCountList: TReplicaCount[],
  ): {
    endpointsInfoYaml: TSimulationNamespace[],
    endpointUniqueIdMap: Map<string, string>,
  } {
    const namespacesMap: Record<string, TSimulationNamespace> = {};
    const endpointUniqueIdCounterMap = new Map<string, number>();
    const endpointUniqueIdMap = new Map<string, string>(); // key: uniqueEndpointName, value: endpointUniqueId

    // merge schemas by uniqueEndpointName
    const endpointMap = new Map<string, TEndpointDataType>();
    for (const dt of dataType) {
      const key = dt.uniqueEndpointName;
      if (!endpointMap.has(key)) {
        endpointMap.set(key, {
          uniqueServiceName: dt.uniqueServiceName,
          uniqueEndpointName: dt.uniqueEndpointName,
          service: dt.service,
          namespace: dt.namespace,
          version: dt.version,
          method: dt.method,
          schemas: []
        });
      }
      endpointMap.get(key)!.schemas.push(...dt.schemas);
    }

    for (const type of endpointMap.values()) {
      const {
        uniqueEndpointName,
        service,
        namespace,
        version,
        method,
        schemas
      } = type;

      const url = uniqueEndpointName.split("\t")[4];
      const path = this.getPathFromUrl(url)

      // Initialize namespace
      if (!namespacesMap[namespace]) {
        namespacesMap[namespace] = {
          namespace,
          services: []
        };
      }

      let serviceYaml = namespacesMap[namespace].services.find(
        s => s.serviceName === service
      );
      if (!serviceYaml) {
        serviceYaml = {
          serviceName: service,
          versions: []
        };
        namespacesMap[namespace].services.push(serviceYaml);
      }

      let versionYaml = serviceYaml.versions.find(
        v => v.version === version
      );
      if (!versionYaml) {
        versionYaml = {
          version,
          replica: 1,
          endpoints: []
        };
        serviceYaml.versions.push(versionYaml);
      }

      const responses: TSimulationResponseBody[] = schemas.map(schema => ({
        status: Number(schema.status),
        responseContentType: schema.responseContentType || "",
        responseBody:
          schema.responseContentType === "application/json"
            ? this.convertSampleToUserDefinedType(schema.responseSample || {})
            : this.convertSampleToUserDefinedType({}),
      }));

      const endpointIdPrefix = `${namespace}-${service}-${version}-${method.toLowerCase()}-ep`;
      const serialNumber = (endpointUniqueIdCounterMap.get(endpointIdPrefix) || 1);
      const endpointUniqueId = `${endpointIdPrefix}-${serialNumber}`;
      endpointUniqueIdMap.set(uniqueEndpointName, endpointUniqueId);
      endpointUniqueIdCounterMap.set(endpointIdPrefix, serialNumber + 1);

      const endpoint: TSimulationEndpoint = {
        endpointUniqueId: endpointUniqueId,
        endpointInfo: {
          path,
          method
        },
        datatype: {
          requestContentType: schemas[0]?.requestContentType || "",
          requestBody:
            schemas[0]?.requestContentType === "application/json"
              ? this.convertSampleToUserDefinedType(schemas[0]?.requestSample || {})
              : this.convertSampleToUserDefinedType({}),
          responses
        }
      };
      versionYaml.endpoints.push(endpoint);
    }

    // Update replica counts to endpointsInfoYaml
    for (const replica of replicaCountList) {
      const { uniqueServiceName, replicas, namespace, version } = replica;
      const [serviceName] = uniqueServiceName.split("\t");

      const namespaceYaml = namespacesMap[namespace];
      if (!namespaceYaml) continue;

      const serviceYaml = namespaceYaml.services.find(
        s => s.serviceName === serviceName
      );
      if (!serviceYaml) continue;

      const versionYaml = serviceYaml.versions.find(
        v => v.version === version
      );
      if (!versionYaml) continue;

      versionYaml.replica = replicas;
    }

    return {
      endpointsInfoYaml: Object.values(namespacesMap),
      endpointUniqueIdMap: endpointUniqueIdMap
    };
  }

  private buildEndpointDependenciesYaml(
    endpointDependencies: TEndpointDependency[],
    endpointIdMap: Map<string, string>
  ): TSimulationEndpointDependency[] {
    return endpointDependencies.map(dep => {
      const fromKey = dep.endpoint.uniqueEndpointName;
      const fromId = endpointIdMap.get(fromKey);
      if (!fromId) return null;

      const dependOn = dep.dependingOn
        .filter(d => d.distance === 1) // Each endpoint in yaml only needs to know which endpoints it directly depends on
        .map(d => {
          const toKey = d.endpoint.uniqueEndpointName;
          const toId = endpointIdMap.get(toKey);
          return toId ? { endpointUniqueId: toId } : null;
        })
        .filter((d): d is { endpointUniqueId: string } => d !== null);

      if (dependOn.length === 0) return null;

      return {
        endpointUniqueId: fromId,
        dependOn
      };
    }).filter((d): d is TSimulationEndpointDependency => d !== null);
  }

  // Convert the requestSample in endpointDataType to UserDefinedType in yaml
  private convertSampleToUserDefinedType(obj: any, indentLevel = 0): string {
    if (JSON.stringify(obj) === '{}') return '{}';
    const indent = '  '.repeat(indentLevel);
    const nextIndent = '  '.repeat(indentLevel + 1);

    if (Array.isArray(obj)) {
      if (obj.length > 0) {
        const elementType = this.convertSampleToUserDefinedType(obj[0], indentLevel);
        return `${elementType}[]`;
      } else {
        return 'unknown[]';
      }
    } else if (obj !== null && typeof obj === 'object') {
      const properties: string[] = [];
      const keys = Object.keys(obj);
      if (keys.length === 0) {
        return '';
      }

      // Sort the object's keys in alphabetical order (for easier comparison with the interfaces generated by kmamiz)
      const sortedKeys = keys.sort();

      for (const key of sortedKeys) {
        const type = this.convertSampleToUserDefinedType(obj[key], indentLevel + 1);
        properties.push(`${nextIndent}${key}: ${type}`);
      }

      return `{\n${properties.join(',\n')}\n${indent}}`;
    } else if (typeof obj === 'string') {
      return 'string';
    } else if (typeof obj === 'number') {
      return 'number';
    } else if (typeof obj === 'boolean') {
      return 'boolean';
    } else if (obj === null) {
      return 'null';
    } else {
      return 'unknown';
    }
  }


}