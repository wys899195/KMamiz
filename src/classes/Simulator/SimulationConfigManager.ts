import {
  TSimulationConfigProcessResult,
  TSimulationConfigYAML,
  simulationConfigYAMLSchema,
  TSimulationConfigErrors,
  TSimulationNamespace,
} from "../../entities/TSimulationConfig";
import SimConfigGenerator from "./SimConfigGenerator";
import yaml from "js-yaml";

import SimConfigServicesInfoValidator from "./SimConfigValidator/SimConfigServicesInfoValidator";
import SimConfigEndpointDependenciesValidator from "./SimConfigValidator/SimConfigEndpointDependenciesValidator";
import SimConfigLoadSimulationValidator from "./SimConfigValidator/SimConfigLoadSimulationValidator";

import SimConfigServicesInfoPreprocessor from "./SimConfigPreprocessor/SimConfigServicesInfoPreprocessor";
import SimConfigEndpointDependenciesPreprocessor from "./SimConfigPreprocessor/SimConfigEndpointDependenciesPreprocessor";
import SimConfigLoadSimulationPreprocessor from "./SimConfigPreprocessor/SimConfigLoadSimulationPreprocessor";


export default class SimulationConfigManager {
  private static instance?: SimulationConfigManager;
  static getInstance = () => this.instance || (this.instance = new this());

  // validators
  private servicesInfoValidator: SimConfigServicesInfoValidator;
  private endpointDependenciesValidator: SimConfigEndpointDependenciesValidator;
  private loadSimulationValidator: SimConfigLoadSimulationValidator;

  // preprocessors
  private servicesInfoPreprocessor: SimConfigServicesInfoPreprocessor;
  private endpointDependenciesPreprocessor: SimConfigEndpointDependenciesPreprocessor;
  private loadSimulationPreprocessor: SimConfigLoadSimulationPreprocessor;

  // generator
  private generator: SimConfigGenerator;

  private constructor() {
    //validators
    this.servicesInfoValidator = new SimConfigServicesInfoValidator();
    this.endpointDependenciesValidator = new SimConfigEndpointDependenciesValidator();
    this.loadSimulationValidator = new SimConfigLoadSimulationValidator();

    // preprocessors
    this.servicesInfoPreprocessor = new SimConfigServicesInfoPreprocessor();
    this.endpointDependenciesPreprocessor = new SimConfigEndpointDependenciesPreprocessor();
    this.loadSimulationPreprocessor = new SimConfigLoadSimulationPreprocessor();

    // generator
    this.generator = new SimConfigGenerator();
  };

  handleSimConfig(yamlString: string): TSimulationConfigProcessResult {

    if (!yamlString.trim()) {
      return {
        errorMessage: "",
        parsedConfig: null,
      };
    }
    try {
      // parse YAML
      const parsedConfig = yaml.load(yamlString) as TSimulationConfigYAML;

      // zod schema validation
      const schemaValidationResult = simulationConfigYAMLSchema.safeParse(parsedConfig);
      if (!schemaValidationResult.success) {
        return {
          errorMessage: [
            "Failed to parse simulation configuration file:",
            ...schemaValidationResult.error.errors.map((e) => {
              const errorLocation = e.path.join(".");
              return errorLocation
                ? `At ${errorLocation}: ${e.message}`
                : e.message;
            })
          ].join("\n---\n"),
          parsedConfig: null,
        };
      }

      // validate and preprocess details
      const validationAndPreprocessingErrors: TSimulationConfigErrors[] = this.validationAndPreprocessing(parsedConfig);
      if (validationAndPreprocessingErrors.length) {
        return {
          errorMessage: [
            "Failed to validate and preprocess simulation configuration file:",
            ...validationAndPreprocessingErrors.map(e => `At ${e.errorLocation}: ${e.message}`)
          ].join("\n---\n"),
          parsedConfig: null,
        };
      };

      // success
      return {
        errorMessage: "",
        parsedConfig: parsedConfig,
      }
    } catch (e) {
      return {
        errorMessage: `Failed to handle simulation configuration file(Unexpected error occurred):\n---\n${e instanceof Error ? e.message : e}`,
        parsedConfig: null,
      };
    }
  }


  private validationAndPreprocessing(parsedConfig: TSimulationConfigYAML): TSimulationConfigErrors[] {
    // validate and preprocess servicesInfo
    let errorMessages: TSimulationConfigErrors[] = [];
    errorMessages = this.servicesInfoValidator.validate(parsedConfig.servicesInfo);
    if (errorMessages.length) return errorMessages;
    errorMessages = this.servicesInfoPreprocessor.preprocess(parsedConfig.servicesInfo);
    if (errorMessages.length) return errorMessages;

    // Provide the service and endpoint information defined in servicesInfo for validating endpointDependencies and loadSimulation. 
    const endpointIdUniqueNameMap = this.getEndpointIdToUniqueNameMap(parsedConfig.servicesInfo);
    const allDefinedEndpointIds = new Set(endpointIdUniqueNameMap.keys());
    const allAssignedUniqueServiceNames = this.getAllAssignedUniqueServiceNameSet(parsedConfig.servicesInfo);

    // validate and preprocess endpointDependencies
    errorMessages = this.endpointDependenciesValidator.validate(parsedConfig.endpointDependencies, allDefinedEndpointIds);
    if (errorMessages.length) return errorMessages;
    errorMessages = this.endpointDependenciesPreprocessor.preprocess(parsedConfig.endpointDependencies, endpointIdUniqueNameMap)
    if (errorMessages.length) return errorMessages;

    // validate and preprocess loadSimulation
    if (parsedConfig.loadSimulation) {
      errorMessages = this.loadSimulationValidator.validate(parsedConfig.loadSimulation, allAssignedUniqueServiceNames, allDefinedEndpointIds);
      if (errorMessages.length) return errorMessages;
      errorMessages = this.loadSimulationPreprocessor.preprocess(parsedConfig.loadSimulation, endpointIdUniqueNameMap, allDefinedEndpointIds);
      if (errorMessages.length) return errorMessages;
    }
    // If no errors found, return an empty array.
    return [];
  }

  private getEndpointIdToUniqueNameMap(servicesInfoConfig: TSimulationNamespace[]) {
    // key: endpointId, value: uniqueEndpointName
    const endpointIdUniqueNameMap = new Map<string, string>();

    servicesInfoConfig.forEach(ns =>
      ns.services.forEach(svc =>
        svc.versions.forEach(ver =>
          ver.endpoints.forEach(ep => {
            if (!endpointIdUniqueNameMap.has(ep.endpointId)) {
              endpointIdUniqueNameMap.set(ep.endpointId, ep.uniqueEndpointName!);
            }
          })
        )
      )
    );
    return endpointIdUniqueNameMap;
  }
  private getAllAssignedUniqueServiceNameSet(servicesInfoConfig: TSimulationNamespace[]) {
    const definedUniqueServiceName = new Set<string>();
    servicesInfoConfig.forEach(ns => {
      ns.services.forEach(svc => {
        svc.versions.forEach(ver => {
          definedUniqueServiceName.add(ver.uniqueServiceName!);
        });
      });
    });
    return definedUniqueServiceName;
  }


  generateStaticSimConfig(): string {
    return this.generator.generateSimConfigFromCurrentStaticData();
  }
}

