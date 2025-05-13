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
    // 1. Convert all version fields to strings
    // 2. De-identify requestBody and responseBody in Datatype
    parsedYAML.endpointsInfo.forEach(namespace => {
      namespace.services.forEach(service => {
        service.versions.forEach(version => {
          version.version = String(version.version);
          version.endpoints.forEach(endpoint => {
            if (endpoint.datatype) {
              if (endpoint.datatype.requestContentType == "application/json") {
                endpoint.datatype.requestBody = this.preprocessJsonBody(endpoint.datatype.requestBody);
              }
              endpoint.datatype.responses.forEach(response => {
                if (response.responseContentType == "application/json") {
                  response.responseBody = this.preprocessJsonBody(response.responseBody);
                }
              });
            }
          });
        });
      });
    });

  }


  private preprocessJsonBody(bodyString: string): string {
    try {
      const jsonStr = this.convertUserDefinedTypeToJson(bodyString);
      const parsedBody = JSON.parse(jsonStr);
      const processedBody = this.deIdentify(parsedBody);
      return JSON.stringify(processedBody);
    } catch (e) {
      return ''
    }

  }

  //Convert TypeScript-like type definitions (interface-style structures) into JSON format string.
  private convertUserDefinedTypeToJson(input: string): string {
    // Remove extra whitespace for easier processing
    input = input.replace(/\s+/g, ' ').trim();

    // Parse the full object if wrapped in braces
    if (input.startsWith('{') && input.endsWith('}')) {
      // Remove outermost curly braces
      input = input.substring(1, input.length - 1).trim();

      // Parse properties and build JSON string
      const result = this.parseProperties(input);
      return `{${result}}`;
    }

    return input;
  }

  //(for convertUserDefinedTypeToJson)Parse object properties
  private parseProperties(input: string): string {
    const properties: string[] = [];
    let currentProperty = '';
    let depth = 0;

    // Analyze character by character to properly handle nesting
    for (let i = 0; i < input.length; i++) {
      const char = input[i];

      if (char === '{' || char === '[') depth++;
      else if (char === '}' || char === ']') depth--;

      if (char === ',' && depth === 0) {
        // Found a property delimiter
        if (currentProperty.trim()) {
          properties.push(this.parseProperty(currentProperty.trim()));
        }
        currentProperty = '';
      } else {
        currentProperty += char;
      }
    }

    /// Handle the last property
    if (currentProperty.trim()) {
      properties.push(this.parseProperty(currentProperty.trim()));
    }

    return properties.join(', ');
  }

  //(for convertUserDefinedTypeToJson)Parse a single property
  private parseProperty(input: string): string {
    // Split property name and type
    const colonIndex = input.indexOf(':');
    if (colonIndex === -1) return input;

    const propertyName = input.substring(0, colonIndex).trim();
    const propertyType = input.substring(colonIndex + 1).trim();

    return `"${propertyName}": ${this.parseType(propertyType)}`;
  }

  //(for convertUserDefinedTypeToJson)Parse type definition
  private parseType(type: string): string {

    // Handle array type - extract array notations first
    let arrayNotations = '';
    let baseType = type;

    // Extract all array markers and get base type
    while (baseType.endsWith('[]')) {
      arrayNotations = '[]' + arrayNotations;
      baseType = baseType.substring(0, baseType.length - 2);
    }

    // Handle object type (which may also have array markers)
    if (baseType.startsWith('{') && baseType.endsWith('}')) {
      let result = this.convertUserDefinedTypeToJson(baseType);

      // Wrap with array brackets if array notations exist
      for (let i = 0; i < arrayNotations.length / 2; i++) {
        result = `[${result}]`;
      }

      return result;
    }

    // Handle primitive types with array notation
    if (arrayNotations) {
      let result = `"${baseType}"`;

      // Add nesting level for arrays
      for (let i = 0; i < arrayNotations.length / 2; i++) {
        result = `[${result}]`;
      }

      return result;
    }

    // Default case
    return `"${type}"`;
  }

  // after convertUserDefinedTypeToJson,execute deIdentify
  private deIdentify(obj: any): any {
    if (Array.isArray(obj)) {
      return obj.map(item => this.deIdentify(item));
    } else if (obj !== null && typeof obj === 'object') {
      const newObj: any = {};
      for (const key in obj) {
        newObj[key] = this.deIdentify(obj[key]);
      }
      return newObj;
    } else if (obj === "string") {
      return ""; // Replace "string" with empty string
    } else if (obj === "number") {
      return 0; // Replace "number" with 0
    } else if (obj === "boolean") {
      return false; // Replace "boolean" with false
    } else {
      return null;  // Default case (e.g., if the user inputs "strings" instead of "string", it will be parsed as null)
    }

  }
}