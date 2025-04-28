import yaml from "js-yaml";
import { TSimulationYAML, simulationYAMLSchema } from "../../entities/TSimulationYAML";

export default class Simulator {

  protected validateAndParseYAML(yamlString: string): {
    validationErrorMessage: string,
    parsedYAML: TSimulationYAML | null
  } {
    if (!yamlString.trim()) {
      return {
        validationErrorMessage: "",
        parsedYAML: null,
      };
    }
    try {
      const parsedYAML = yaml.load(yamlString) as TSimulationYAML;

      const validationResult = simulationYAMLSchema.safeParse(parsedYAML);
      if (validationResult.success) {
        this.preprocessParsedYaml(parsedYAML);
        return {
          validationErrorMessage: "",
          parsedYAML: parsedYAML
        };
      } else {
        const formatErrorMessage = validationResult.error.errors
          .map((err) => `• ${err.path.join(".")}: ${err.message}`)
          .join("\n");
        return {
          validationErrorMessage: "YAML format error:\n" + formatErrorMessage,
          parsedYAML: null
        };
      }
    } catch (e) {
      return {
        validationErrorMessage: `An error occurred while parsing YAML \n\n${e instanceof Error ? e.message : e}`,
        parsedYAML: null,
      };
    }
  }

  private preprocessParsedYaml(parsedYAML: TSimulationYAML): void {
    // 1. Convert all status and version fields to strings
    // 2. De-identify requestBody and responseBody in Datatype
    parsedYAML.endpointsInfo.forEach(namespace => {
      namespace.services.forEach(service => {
        service.versions.forEach(version => {
          version.version = String(version.version);
          version.endpoints.forEach(endpoint => {
            if (endpoint.datatype) {
              endpoint.datatype.requestBody = this.deIdentifyJsonBody(endpoint.datatype.requestBody);
              endpoint.datatype.responses.forEach(response => {
                response.responseBody = this.deIdentifyJsonBody(response.responseBody);
                response.status = String(response.status);
              });
            }
          });
        });
      });
    });

    parsedYAML.trafficsInfo?.forEach(traffic => {
      traffic.statusRate?.forEach(statusRate => {
        statusRate.status = String(statusRate.status);
      });
    });
  }

  private deIdentifyJsonBody(value: string): string {
    try {
      const parsed = JSON.parse(value);
      return JSON.stringify(this.deIdentifyObject(parsed));
    } catch (e) {
      // is not a valid json (e.g., Content-Type might be application/x-www-form-urlencoded; charset=UTF-8)
      console.log("oops")
      return value;
    }
  }

  private deIdentifyObject(obj: any): any {
    if (Array.isArray(obj)) {
      return obj.map(item => this.deIdentifyObject(item));
    } else if (typeof obj === 'object' && obj !== null) {
      const newObj: { [key: string]: any } = {};
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          newObj[key] = this.deIdentifyValue(obj[key]);
        }
      }
      return newObj;
    }
    return this.deIdentifyValue(obj);
  }

  private deIdentifyValue(value: any): any {
    if (typeof value === 'number') {
      return 0;
    } else if (typeof value === 'string') {
      return "";
    } else if (value === null) {
      return null;
    } else if (typeof value === 'object') {
      return this.deIdentifyObject(value);
    }
    return value;
  }
}
