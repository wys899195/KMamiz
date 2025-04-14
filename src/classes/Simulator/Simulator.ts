import yaml from "js-yaml";
import Ajv, { ValidateFunction } from "ajv";
import {simulationYAMLSchema} from "../../entities/TSimulationYAML";

export default class Simulator {

  private readonly yamlValidationFunc: ValidateFunction;

  constructor() {
    const ajv = new Ajv();
    this.yamlValidationFunc = ajv.compile(simulationYAMLSchema);
  }

  isValidYAMLFormatForDependencySimulation(yamlString: string):
  {
    isYAMLValid:boolean,
    message:string
  }{
    try {
      const parsed = yaml.load(yamlString);
      if (this.yamlValidationFunc(parsed)) {
        return { isYAMLValid: true, message: "YAML format is correct" };
      } else {
        return { isYAMLValid: false, message: "YAML format error \n\n" + JSON.stringify(this.yamlValidationFunc.errors) };
      }
    } catch (e) {
      return { isYAMLValid: false, message: "An error occurred while parsing YAML \n\n" + e };
    }
  }

}

