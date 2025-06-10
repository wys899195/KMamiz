import {
  TSimulationConfigProcessResult,
} from "../../entities/TSimulationConfig";
import SimConfigValidator from "./SimConfigValidator";
import SimConfigPreprocessor from "./SimConfigPreprocessor";
import SimConfigGenerator from "./SimConfigGenerator";


export default class SimulationConfigManager {
  private static instance?: SimulationConfigManager;
  static getInstance = () => this.instance || (this.instance = new this());

  private validator: SimConfigValidator;
  private preprocessor: SimConfigPreprocessor;
  private generator: SimConfigGenerator;

  private constructor() {
    this.validator = new SimConfigValidator();
    this.preprocessor = new SimConfigPreprocessor();
    this.generator = new SimConfigGenerator();
  };

  validateAndPrerocessSimConfig(yamlString: string): TSimulationConfigProcessResult {
    // Parse and validate the YAML structure
    const validationResult = this.validator.parseAndValidateRawYAML(yamlString);
    if (validationResult.errorMessage || !validationResult.parsedConfig) {
      return validationResult; // Return early if failed
    }

    // preprocessing endpoint data types
    const epDatatypePreprocessResult = this.preprocessor.preprocessEndpointDataTypeInYaml(validationResult.parsedConfig);
    if (epDatatypePreprocessResult.errorMessage || !epDatatypePreprocessResult.parsedConfig) {
      return epDatatypePreprocessResult; // Return early if failed
    }

    // Add default metrics for any endpoints missing metrics in the parsed YAML config
    const addDefaultMetricsResult = this.preprocessor.addDefaultMetricsForMissingEndpointsInPlace(validationResult.parsedConfig);
    return addDefaultMetricsResult;
  }

  generateStaticSimConfig(): string {
    return this.generator.generateSimConfigFromCurrentStaticData();
  }
}

