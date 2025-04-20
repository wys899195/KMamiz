import yaml from "js-yaml";
import { TSimulationYAML, simulationYAMLSchema } from "../../entities/TSimulationYAML";

export default class Simulator {

  protected validateYAMLFormat(yamlString: string): {
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
        // Convert all status and version fields in parsedYAML to strings
        this.convertStatusAndVersionToString(parsedYAML);
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

  private convertStatusAndVersionToString(parsedYAML: TSimulationYAML): void {
    // Convert all status and version fields in parsedYAML to strings
    parsedYAML.endpointsInfo.forEach(namespace => {
      namespace.services.forEach(service => {
        service.versions.forEach(version => {
          version.version = String(version.version);
          
          version.endpoints.forEach(endpoint => {
            if (endpoint.datatype?.responses) {
              endpoint.datatype.responses.forEach(response => {
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
}

