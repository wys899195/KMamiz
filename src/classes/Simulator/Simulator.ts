import yaml from "js-yaml";
import { TSimulationYAML, simulationYAMLSchema } from "../../entities/TSimulationYAML";
import { CLabelMapping } from "../../classes/Cacheable/CLabelMapping";
import DataCache from "../../services/DataCache";

type BodyInputType = "sample" | "typeDefinition" | "empty" | "unknown";

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
        const preprocessErrors = this.preprocessParsedYaml(parsedYAML);
        if (preprocessErrors.length > 0) {
          return {
            validationErrorMessage: "Preprocessing errors:\n" + preprocessErrors.map(e => `• ${e}`).join("\n"),
            parsedYAML: null,
          };
        }
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

  private preprocessParsedYaml(parsedYAML: TSimulationYAML): string[] {
    // 1. Convert all version fields to strings
    // 2. De-identify requestBody and responseBody in Datatype
    const errorMessages: string[] = [];
    parsedYAML.endpointsInfo.forEach(namespace => {
      namespace.services.forEach(service => {
        service.versions.forEach(version => {
          version.version = String(version.version);
          version.endpoints.forEach(endpoint => {
            endpoint.endpointId = String(endpoint.endpointId);
            if (endpoint.datatype) {
              if (endpoint.datatype.requestContentType == "application/json") {
                const result = this.preprocessJsonBody(endpoint.datatype.requestBody);
                if (!result.isSuccess) {
                  errorMessages.push(`Invalid requestBody in endpoint ${endpoint.endpointId}: ${result.warningMessage}`);
                } else {
                  endpoint.datatype.requestBody = result.processedBodyString;
                }
              }
              endpoint.datatype.responses.forEach(response => {
                if (response.responseContentType === "application/json") {
                  const result = this.preprocessJsonBody(response.responseBody);
                  if (!result.isSuccess) {
                    errorMessages.push(`Invalid responseBody(status:${response.status}) in endpoint ${endpoint.endpointId}: ${result.warningMessage}`);
                  } else {
                    response.responseBody = result.processedBodyString;
                  }
                }
              });
            }
          });
        });
      });
    });

    parsedYAML.endpointDependencies?.forEach(dep => {
      dep.endpointId = String(dep.endpointId);
      dep.dependOn.forEach(d => {
        d.endpointId = String(d.endpointId);
      });
    });

    if (parsedYAML.trafficSimulation) {
      parsedYAML.trafficSimulation.endpointMetrics.forEach(m => {
        m.endpointId = String(m.endpointId);
      });
    }

    return errorMessages;
  }


  private preprocessJsonBody(bodyString: string): {
    isSuccess: boolean,
    processedBodyString: string,
    warningMessage: string
  } {
    const inputType: BodyInputType = this.classifyBodyInputType(bodyString);
    // case 1: user provides a sample, de-identify it.
    // case 2: user provides a type definition, convert it to JSON first.
    // if it preprocess fails, user will be asked to re-input it.
    try {
      let parsedBody: any;

      if (inputType === "sample") {
        parsedBody = JSON.parse(bodyString);
      } else if (inputType === "typeDefinition") {
        const jsonStr = this.convertUserDefinedTypeToJson(bodyString);
        parsedBody = JSON.parse(jsonStr);
      } else if (inputType === "empty") {
        parsedBody = {};
      } else {
        return { // unknown input, will call user to re-input
          isSuccess: false,
          processedBodyString: '',
          warningMessage: "Unrecognized format. Please provide a valid JSON sample or a type definition using only primitive types like string, number, or boolean (e.g., { name: string, age: number })."
        };
      }
      const processedBody = inputType === "sample" ?
        this.deIdentifyJsonSample(parsedBody) :
        this.deIdentifyJsonTypeDefinition(parsedBody);
      return {
        isSuccess: true,
        processedBodyString: JSON.stringify(processedBody),
        warningMessage: ""
      };

    } catch (e) {
      return {
        isSuccess: false,
        processedBodyString: '',
        warningMessage: `Failed to process input. Make sure it is valid JSON or a type definition using only primitive types like string, number, or boolean (e.g., { name: string, age: number }). err: ${e instanceof Error ? e.message : e}`,
      };
    }
  }
  private classifyBodyInputType(input: string): BodyInputType {
    if (this.isJsonSample(input)) return "sample";
    if (this.isTypeDefinition(input)) return "typeDefinition";
    if (input.trim() === '') return "empty";
    return "unknown";
  }
  private isJsonSample(input: string): boolean {
    try {
      const parsed = JSON.parse(input);
      return typeof parsed === 'object' && parsed !== null;
    } catch (e) {
      return false;
    }
  }
  private isTypeDefinition(input: string): boolean {
    const trimmed = input.trim();
    return !this.isJsonSample(input) && /:\s*(string|number|boolean|null|any|\{|\[)/i.test(trimmed);
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
  //(for convert User Defined Type To Json)Parse object properties
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
  //(for convert User Defined Type To Json)Parse a single property
  private parseProperty(input: string): string {
    // Split property name and type
    const colonIndex = input.indexOf(':');
    if (colonIndex === -1) return input;

    const propertyName = input.substring(0, colonIndex).trim();
    const propertyType = input.substring(colonIndex + 1).trim();

    return `"${propertyName}": ${this.parseType(propertyType)}`;
  }
  //(for convert User Defined Type To Json)Parse type definition
  private parseType(type: string): string {
    // Extract array notations and base type
    let arrayNotations = '';
    let baseType = type;

    while (baseType.endsWith('[]')) {
      arrayNotations = '[]' + arrayNotations;
      baseType = baseType.substring(0, baseType.length - 2);
    }

    // If baseType is 'any' and has array notations, build nested empty arrays
    if (baseType === 'any' && arrayNotations) {
      let emptyArray = '[]';
      const depth = arrayNotations.length / 2;  // number of []
      for (let i = 1; i < depth; i++) {
        emptyArray = `[${emptyArray}]`;
      }
      return emptyArray;
    }

    // Handle object type (nested) ...
    if (baseType.startsWith('{') && baseType.endsWith('}')) {
      let result = this.convertUserDefinedTypeToJson(baseType);
      for (let i = 0; i < arrayNotations.length / 2; i++) {
        result = `[${result}]`;
      }
      return result;
    }

    // Handle other primitives with arrays
    if (arrayNotations) {
      let result = `"${baseType}"`;
      for (let i = 0; i < arrayNotations.length / 2; i++) {
        result = `[${result}]`;
      }
      return result;
    }

    // Default primitive
    return `"${type}"`;
  }
  private deIdentify(
    input: any,
    isTypeDefinition: boolean
  ): any {
    if (Array.isArray(input)) {
      return input.map(item => this.deIdentify(item, isTypeDefinition));
    } else if (input !== null && typeof input === 'object') {
      const newObj: any = {};
      for (const key in input) {
        newObj[key] = this.deIdentify(input[key], isTypeDefinition);
      }
      return newObj;
    } else {
      if (isTypeDefinition) {
        if (input === "string") return ""; // Replace "string" with empty string
        if (input === "number") return 0; // Replace "number" with 0
        if (input === "boolean") return false; // Replace "boolean" with false
        return null;// Default case (e.g., if the user inputs "strings" instead of "string", it will be parsed as null)
      } else {
        if (typeof input === 'string') return "";
        if (typeof input === 'number') return 0;
        if (typeof input === 'boolean') return false;
        return null;
      }
    }
  }
  private deIdentifyJsonTypeDefinition(obj: any): any {
    return this.deIdentify(obj, true);
  }
  private deIdentifyJsonSample(input: any): any {
    return this.deIdentify(input, false);
  }


  protected getExistingUniqueEndpointNameMappings(): Map<string, string> {
    const entries = DataCache.getInstance()
      .get<CLabelMapping>("LabelMapping")
      .getData()
      ?.entries();
    const mapping = new Map<string, string>();
    if (!entries) return mapping;
    for (const [uniqueEndpointName] of entries) {
      // try to remove the host part from the URL in uniqueEndpointName
      const parts = uniqueEndpointName.split("\t");
      if (parts.length != 5) continue;
      const url = parts[4];
      const path = this.getPathFromUrl(url);
      parts[4] = path;
      const key = parts.join("\t");
      mapping.set(key, uniqueEndpointName);
    }
    return mapping;
  }
  protected generateUniqueEndpointName(uniqueServiceName: string, serviceName: string, namespace: string, methodUpperCase: string, path: string, existingUniqueEndpointNameMappings: Map<string, string>) {
    const existing = existingUniqueEndpointNameMappings.get(`${uniqueServiceName}\t${methodUpperCase}\t${path}`);

    if (existing) {
      return existing;
    } else {
      const host = `http://${serviceName}.${namespace}.svc.cluster.local`;
      const url = `${host}${path}`; // port default 80
      return `${uniqueServiceName}\t${methodUpperCase}\t${url}`;
    }
  }

  protected getPathFromUrl(url: string) {
    try {
      return new URL(url).pathname;
    } catch {
      return "/";
    }
  }
}
