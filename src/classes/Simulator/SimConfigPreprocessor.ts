import { TSimulationConfigProcessResult as TSimulationConfigProcessResult } from "../../entities/TSimulationConfig";
import SimConfigFormatValidator from "./SimConfigFormatValidator";
import SimConfigEndpointDataTypePreprocessor from "./SimConfigEndpointDataTypePreprocessor";


export default class SimConfigPreprocessor {
  private validator: SimConfigFormatValidator;
  private epDatatypePreprocessor: SimConfigEndpointDataTypePreprocessor;

  constructor() {
    this.validator = new SimConfigFormatValidator();
    this.epDatatypePreprocessor = new SimConfigEndpointDataTypePreprocessor();
  }

  validateAndPrerocessSimConfig(yamlString: string):TSimulationConfigProcessResult {
    
    // Parse and validate the YAML structure
    const validationResult = this.validator.parseAndValidateRawYAML(yamlString);
    if (validationResult.errorMessage || !validationResult.parsedConfig) {
      return validationResult; // Return early if format validation failed
    }

    // preprocessing endpoint data types
    const epDatatypePreprocessResult = this.epDatatypePreprocessor.preprocessEndpointDataTypeInYaml(validationResult.parsedConfig);
    return epDatatypePreprocessResult;
  }

  getPathFromUrl(url: string){
    return this.validator.getPathFromUrl(url);
  }
}

