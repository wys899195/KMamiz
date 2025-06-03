import {
  TSimulationConfigProcessResult,
} from "../../entities/TSimulationConfig";
import SimConfigValidator from "./SimConfigValidator";
import SimConfigEndpointDataTypePreprocessor from "./SimConfigPreprocessor";


export default class SimulationConfigManager {
  private static instance?: SimulationConfigManager ;
  static getInstance = () => this.instance || (this.instance = new this());
  private constructor() {};

  validateAndPrerocessSimConfig(yamlString: string): TSimulationConfigProcessResult {
    // Parse and validate the YAML structure
    const validationResult = SimConfigValidator.getInstance().parseAndValidateRawYAML(yamlString);
    if (validationResult.errorMessage || !validationResult.parsedConfig) {
      return validationResult; // Return early if format validation failed
    }

    // preprocessing endpoint data types
    const epDatatypePreprocessResult = SimConfigEndpointDataTypePreprocessor.getInstance().preprocessEndpointDataTypeInYaml(validationResult.parsedConfig);
    return epDatatypePreprocessResult;
  }
}

