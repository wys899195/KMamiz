import yaml from "js-yaml";
import { CLabelMapping } from "../../classes/Cacheable/CLabelMapping";
import DataCache from "../../services/DataCache";

import {
  TSimulationConfigYAML,
  simulationYAMLSchema,
  TSimulationConfigErrors,
  TSimulationConfigProcessResult,
} from "../../entities/TSimulationConfig";




export default class SimConfigFormatValidator {

  parseAndValidateRawYAML(yamlString: string): TSimulationConfigProcessResult {
    if (!yamlString.trim()) {
      return {
        errorMessage: "",
        parsedConfig: null,
      };
    }
    try {
      const parsedYAML = yaml.load(yamlString) as TSimulationConfigYAML;

      const formatValidationResult = simulationYAMLSchema.safeParse(parsedYAML);
      if (formatValidationResult.success) {
        const validationErrorsInParsedYaml = this.validateParsedYaml(parsedYAML);
        if (validationErrorsInParsedYaml.length > 0) {
          return {
            errorMessage: validationErrorsInParsedYaml.map(e => `• Error at ${e.location}: ${e.message}`).join("\n"),
            parsedConfig: null,
          };
        }
        return {
          errorMessage: "",
          parsedConfig: parsedYAML,
        };
      } else {
        const formatErrorMessage = formatValidationResult.error.errors
          .map((err) => `• ${err.path.join(".")}: ${err.message}`)
          .join("\n");

        return {
          errorMessage: "YAML format error:\n" + formatErrorMessage,
          parsedConfig: null,
        };
      }
    } catch (e) {
      return {
        errorMessage: `An error occurred while parsing and validating the YAML: \n\n${e instanceof Error ? e.message : e}`,
        parsedConfig: null,
      };
    }
  }

  private validateParsedYaml(parsedYAML: TSimulationConfigYAML): TSimulationConfigErrors[] {
    let errorMessage: TSimulationConfigErrors[] = [];

    // check for duplicate service and genegate uniqueServiceName
    errorMessage = this.validateAndAssignServiceIds(parsedYAML);
    if (errorMessage.length) return errorMessage;

    // check for duplicate endpointIds and collect endpointId set
    const { endpointIdValidationErrors, allDefinedEndpointIds } = this.validateEndpointIds(parsedYAML);
    errorMessage = endpointIdValidationErrors;
    if (errorMessage.length) return errorMessage;

    // Validate endpointDependencies settings
    errorMessage = this.validateEndpointDependencies(parsedYAML, allDefinedEndpointIds);
    if (errorMessage.length) return errorMessage;

    // Validate LoadSimulation settings
    errorMessage = this.validateLoadSimulation(parsedYAML, allDefinedEndpointIds);
    if (errorMessage.length) return errorMessage;

    // convert all user defined endpoint id
    errorMessage = this.convertEndpointIdsToUniqueEndpointNames(parsedYAML);
    if (errorMessage.length) return errorMessage;

    return [];
  }

  private validateAndAssignServiceIds(parsedYAML: TSimulationConfigYAML): TSimulationConfigErrors[] {
    const errorMessages: TSimulationConfigErrors[] = [];
    const existingServiceId = new Set<string>();

    parsedYAML.servicesInfo.forEach(namespace =>
      namespace.services.forEach(service =>
        service.versions.forEach(version => {
          // Generate serviceId
          version.version = String(version.version).trim();
          const serviceId = `${service.serviceName}\t${namespace.namespace}\t${version.version}`;

          // Check for duplicates
          if (existingServiceId.has(serviceId)) {
            errorMessages.push({
              location: `servicesInfo > namespace: ${namespace.namespace} > serviceName: ${service.serviceName} > version: ${version.version}`,
              message: `Duplicate service found.`
            });
          } else {
            existingServiceId.add(serviceId);
            version.serviceId = serviceId;
          }
        })
      )
    );
    return errorMessages;
  }

  private validateEndpointIds(parsedYAML: TSimulationConfigYAML): {
    endpointIdValidationErrors: TSimulationConfigErrors[],
    allDefinedEndpointIds: Set<string>,
  } {
    const errors: TSimulationConfigErrors[] = [];
    const allDefinedEndpointIds = new Set<string>();

    parsedYAML.servicesInfo.forEach(ns =>
      ns.services.forEach(svc =>
        svc.versions.forEach(ver =>
          ver.endpoints.forEach(ep => {
            ep.endpointId = String(ep.endpointId).trim();
            if (allDefinedEndpointIds.has(ep.endpointId)) {
              errors.push({
                location: `servicesInfo > namespace: ${ns.namespace} > serviceName: ${svc.serviceName} > version: ${ver.version} > endpointId: ${ep.endpointId}`,
                message: `Duplicate endpointId found.`
              });
            } else {
              allDefinedEndpointIds.add(ep.endpointId);
            }
          })
        )
      )
    );

    return {
      endpointIdValidationErrors: errors,
      allDefinedEndpointIds: allDefinedEndpointIds
    }
  }

  private validateEndpointDependencies(parsedYAML: TSimulationConfigYAML, allDefinedEndpointIds: Set<string>): TSimulationConfigErrors[] {
    // Check that source endpointId is defined in servicesInfo
    // Check that each target endpointId in dependOn is defined in servicesInfo
    // Ensure no endpoint depends on itself
    // Check for duplicate source endpointIds within endpointDependencies
    const errorMessages: TSimulationConfigErrors[] = [];
    const seenSourceEndpointIds = new Set<string>();
    parsedYAML.endpointDependencies?.forEach((dep, index) => {
      dep.endpointId = String(dep.endpointId).trim();
      const location = `endpointDependencies[${index}]`;
      if (!allDefinedEndpointIds.has(dep.endpointId)) {
        errorMessages.push({
          location,
          message: `Source endpointId "${dep.endpointId}" is not defined in servicesInfo.`,
        });
      }
      dep.dependOn.forEach((d, subIndex) => {
        d.endpointId = String(d.endpointId).trim();
        const subLocation = `${location}.dependOn[${subIndex}]`;
        if (!allDefinedEndpointIds.has(d.endpointId)) {
          errorMessages.push({
            location: subLocation,
            message: `Target endpointId "${d.endpointId}" is not defined in servicesInfo.`,
          });
        }

        if (d.endpointId === dep.endpointId) {
          errorMessages.push({
            location: subLocation,
            message: `Endpoint cannot depend on itself ("${dep.endpointId}").`,
          });
        }
      });
    });
    parsedYAML.endpointDependencies?.forEach((dep, index) => {
      const sourceId = String(dep.endpointId).trim();
      const location = `endpointDependencies[${index}]`;

      if (seenSourceEndpointIds.has(sourceId)) {
        errorMessages.push({
          location: location,
          message: `Duplicate source endpointId "${sourceId}" found.`,
        });
      } else {
        seenSourceEndpointIds.add(sourceId);
      }
    });

    return errorMessages;
  }

  private validateLoadSimulation(parsedYAML: TSimulationConfigYAML, allDefinedEndpointIds: Set<string>): TSimulationConfigErrors[] {
    const errorMessages: TSimulationConfigErrors[] = [];
    const seenEndpointIds = new Set<string>();

    parsedYAML.loadSimulation?.endpointMetrics.forEach((m, index) => {
      const endpointMetricId = String(m.endpointId).trim();
      const location = `loadSimulation.endpointMetrics[${index}]`;
      if (!allDefinedEndpointIds.has(endpointMetricId)) {
        errorMessages.push({
          location,
          message: `EndpointId "${endpointMetricId}" is not defined in servicesInfo.`,
        });
      }
    });

    parsedYAML.loadSimulation?.endpointMetrics.forEach((m, index) => {
      const endpointMetricId = String(m.endpointId).trim();
      const location = `loadSimulation.endpointMetrics[${index}]`;
      if (seenEndpointIds.has(endpointMetricId)) {
        errorMessages.push({
          location,
          message: `Duplicate endpointId "${endpointMetricId}" found in endpointMetrics.`,
        });
      } else {
        seenEndpointIds.add(endpointMetricId);
      }
    });

    return errorMessages;
  }

  private convertEndpointIdsToUniqueEndpointNames(parsedYAML: TSimulationConfigYAML): TSimulationConfigErrors[] {
    const errorMessages: TSimulationConfigErrors[] = [];// If earlier validation steps were thorough, errorMessages should be empty.(This is just in case).
    const endpointIdToUniqueNameMap = new Map<string, string>();
    // Generate unique endpointIds and build mapping
    const existingUniqueEndpointNameMappings = this.getExistingUniqueEndpointNameMappings();
    parsedYAML.servicesInfo.forEach((namespace) => {
      namespace.services.forEach((service) => {
        service.versions.forEach((version) => {
          const uniqueServiceName = version.serviceId!;
          version.endpoints.forEach((endpoint) => {
            const originalEndpointId = endpoint.endpointId;
            const method = endpoint.endpointInfo.method.toUpperCase();
            const path = endpoint.endpointInfo.path;
            const newEndpointId = this.generateUniqueEndpointName(
              uniqueServiceName,
              service.serviceName,
              namespace.namespace,
              method,
              path,
              existingUniqueEndpointNameMappings
            );
            endpoint.endpointId = newEndpointId;
            endpointIdToUniqueNameMap.set(originalEndpointId, newEndpointId);
          });
        });
      });
    });

    // Replace endpointIds in endpointDependencies
    parsedYAML.endpointDependencies?.forEach((dep, index) => {
      const originalSourceId = dep.endpointId;
      const mappedSourceId = endpointIdToUniqueNameMap.get(originalSourceId);
      const sourceLocation = `endpointDependencies[${index}].endpointId`;

      if (mappedSourceId) {
        dep.endpointId = mappedSourceId;
      } else {
        // This error should not occur if earlier validation is correctly implemented, but included as a safeguard
        errorMessages.push({
          location: sourceLocation,
          message: `Cannot map source endpointId "${originalSourceId}".`
        });
      }
      dep.dependOn.forEach((d, subIndex) => {
        const originalTargetId = d.endpointId;
        const mappedTargetId = endpointIdToUniqueNameMap.get(originalTargetId);
        const targetLocation = `endpointDependencies[${index}].dependOn[${subIndex}].endpointId`;

        if (mappedTargetId) {
          d.endpointId = mappedTargetId;
        } else {
          errorMessages.push({
            location: targetLocation,
            message: `Cannot map target endpointId "${originalTargetId}".`
          });
        }
      });
    });
    // Replace endpointIds in loadSimulation
    parsedYAML.loadSimulation?.endpointMetrics.forEach((metric, index) => {
      const originalId = metric.endpointId;
      const mappedId = endpointIdToUniqueNameMap.get(originalId);
      const location = `loadSimulation.endpointMetrics[${index}].endpointId`;

      if (mappedId) {
        metric.endpointId = mappedId;
      } else {
        errorMessages.push({
          location,
          message: `Cannot map endpointId "${originalId}".`
        });
      }
    });

    return errorMessages;
  }

  private getExistingUniqueEndpointNameMappings(): Map<string, string> {
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

  private generateUniqueEndpointName(uniqueServiceName: string, serviceName: string, namespace: string, methodUpperCase: string, path: string, existingUniqueEndpointNameMappings: Map<string, string>) {
    const existing = existingUniqueEndpointNameMappings.get(`${uniqueServiceName}\t${methodUpperCase}\t${path}`);

    if (existing) {
      return existing;
    } else {
      const host = `http://${serviceName}.${namespace}.svc.cluster.local`;
      const url = `${host}${path}`; // port default 80
      return `${uniqueServiceName}\t${methodUpperCase}\t${url}`;
    }
  }

  getPathFromUrl(url: string) {
    try {
      return new URL(url).pathname;
    } catch {
      return "/";
    }
  }
}

