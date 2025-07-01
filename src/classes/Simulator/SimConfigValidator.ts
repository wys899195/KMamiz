import yaml from "js-yaml";
import { CLabelMapping } from "../Cacheable/CLabelMapping";
import DataCache from "../../services/DataCache";

import {
  TSimulationConfigYAML,
  simulationConfigYAMLSchema,
  TSimulationConfigErrors,
  TSimulationConfigProcessResult,
  TSimulationEndpointDependency,
} from "../../entities/TSimulationConfig";

export default class SimConfigValidator {

  parseAndValidateRawYAML(yamlString: string): TSimulationConfigProcessResult {
    if (!yamlString.trim()) {
      return {
        errorMessage: "",
        parsedConfig: null,
      };
    }
    try {
      const parsedConfig = yaml.load(yamlString) as TSimulationConfigYAML;

      const formatValidationResult = simulationConfigYAMLSchema.safeParse(parsedConfig);
      if (formatValidationResult.success) {
        const parsedZodResult: TSimulationConfigYAML = formatValidationResult.data;
        const errorMessageDetails = this.validateParsedYaml(parsedZodResult);
        if (errorMessageDetails.length > 0) {
          return {
            errorMessage: [
              "Failed to parse and validate YAML:",
              ...errorMessageDetails.map(e => `At ${e.errorLocation}: ${e.message}`)
            ].join("\n---\n"),
            parsedConfig: null,
          };
        } else {
          //console.log("parsedZodResult (as YAML):\n", yaml.dump(parsedZodResult));
          //console.log("parsedZodResult = ", JSON.stringify(parsedZodResult, null, 2))
          return {
            errorMessage: "",
            parsedConfig: parsedZodResult, // ok
          };
        }

      } else {
        return {
          errorMessage: [
            "Failed to parse and validate YAML:",
            ...formatValidationResult.error.errors.map((e) => {
              const errorLocation = e.path.join(".");
              return errorLocation
                ? `At ${errorLocation}: ${e.message}`
                : e.message;
            })
          ].join("\n---\n"),
          parsedConfig: null,
        };
      }
    } catch (e) {
      return {
        errorMessage: `Failed to parse and validate YAML:\n---\n${e instanceof Error ? e.message : e}`,
        parsedConfig: null,
      };
    }
  }

  private validateParsedYaml(parsedConfig: TSimulationConfigYAML): TSimulationConfigErrors[] {
    // Validate and assign unique service IDs
    // This step generates unique identifiers for each service and checks for duplicate service names.
    const serviceIdErrors = this.validateAndAssignServiceIds(parsedConfig);
    if (serviceIdErrors.length) return serviceIdErrors;

    // Check for duplicate endpoint IDs and collect all defined endpoint IDs
    // These collected IDs will be used for subsequent validation steps.
    const { endpointIdValidationErrors, allDefinedEndpointIds } = this.validateEndpointIds(parsedConfig);
    if (endpointIdValidationErrors.length) return endpointIdValidationErrors;

    // Validate endpoint dependencies
    // Ensures that all referenced endpoints exist and dependencies are correctly defined.
    const dependencyErrors = this.validateEndpointDependenciesFormat(parsedConfig, allDefinedEndpointIds);
    if (dependencyErrors.length) return dependencyErrors;
    const cyclicDependenciesErrors = this.validateCyclicEndpointDependencies(parsedConfig.endpointDependencies);
    if (cyclicDependenciesErrors.length) return cyclicDependenciesErrors;

    // Validate LoadSimulation settings
    // Includes checking service metrics to verify services exist and no duplicates,
    // and validating endpoint metrics for correct endpoint references and duplicates.
    const serviceMetricErrors = this.validateServiceMetrics(parsedConfig);
    const endpointMetricErrors = this.validateEndpointMetrics(parsedConfig, allDefinedEndpointIds);

    const loadSimulationErrors = [
      ...serviceMetricErrors,
      ...endpointMetricErrors,
    ];

    if (loadSimulationErrors.length) return loadSimulationErrors;

    // Assign serviceId to loadSimulation.serviceMetrics' versions based on servicesInfo
    const serviceMetricIdsErrors = this.assignServiceIdsToMetrics(parsedConfig);
    if (serviceMetricIdsErrors.length) return dependencyErrors;

    // Convert all user-defined endpoint IDs to unique endpoint names
    // This prevents conflicts in subsequent processing stages.
    const conversionErrors = this.convertEndpointIdsToUniqueEndpointNames(parsedConfig);
    if (conversionErrors.length) return conversionErrors;

    // If no errors found, return an empty array.
    return [];
  }

  private validateAndAssignServiceIds(parsedConfig: TSimulationConfigYAML): TSimulationConfigErrors[] {
    const errorMessages: TSimulationConfigErrors[] = [];
    const existingServiceId = new Set<string>();

    parsedConfig.servicesInfo.forEach(namespace =>
      namespace.services.forEach(service =>
        service.versions.forEach(version => {
          // Generate serviceId
          const serviceId = `${service.serviceName}\t${namespace.namespace}\t${version.version}`;

          // Check for duplicates
          if (existingServiceId.has(serviceId)) {
            errorMessages.push({
              errorLocation: `servicesInfo > namespace: ${namespace.namespace} > serviceName: ${service.serviceName} > version: ${version.version}`,
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

  private validateEndpointIds(parsedConfig: TSimulationConfigYAML): {
    endpointIdValidationErrors: TSimulationConfigErrors[],
    allDefinedEndpointIds: Set<string>,
  } {
    const errors: TSimulationConfigErrors[] = [];
    const allDefinedEndpointIds = new Set<string>();

    parsedConfig.servicesInfo.forEach(ns =>
      ns.services.forEach(svc =>
        svc.versions.forEach(ver =>
          ver.endpoints.forEach(ep => {
            if (allDefinedEndpointIds.has(ep.endpointId)) {
              errors.push({
                errorLocation: `servicesInfo > namespace: ${ns.namespace} > serviceName: ${svc.serviceName} > version: ${ver.version} > endpointId: ${ep.endpointId}`,
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

  private validateEndpointDependenciesFormat(parsedConfig: TSimulationConfigYAML, allDefinedEndpointIds: Set<string>): TSimulationConfigErrors[] {
    // Check that source endpointId is defined in servicesInfo
    // Check that each target endpointId in dependOn is defined in servicesInfo
    // Ensure no endpoint depends on itself
    // Check for duplicate source endpointIds within endpointDependencies
    const errorMessages: TSimulationConfigErrors[] = [];
    const seenSourceEndpointIds = new Set<string>();
    parsedConfig.endpointDependencies.forEach((dep, index) => {
      const errorLocation = `endpointDependencies[${index}]`;
      if (!allDefinedEndpointIds.has(dep.endpointId)) {
        errorMessages.push({
          errorLocation: errorLocation,
          message: `Source endpointId "${dep.endpointId}" is not defined in servicesInfo.`,
        });
      }
      dep.dependOn.forEach((d, subIndex) => {
        const subLocation = `${errorLocation}.dependOn[${subIndex}]`;
        if (!allDefinedEndpointIds.has(d.endpointId)) {
          errorMessages.push({
            errorLocation: subLocation,
            message: `Target endpointId "${d.endpointId}" is not defined in servicesInfo.`,
          });
        }

        if (d.endpointId === dep.endpointId) {
          errorMessages.push({
            errorLocation: subLocation,
            message: `Endpoint cannot depend on itself ("${dep.endpointId}").`,
          });
        }
      });
    });
    parsedConfig.endpointDependencies.forEach((dep, index) => {
      const sourceId = dep.endpointId;
      const errorLocation = `endpointDependencies[${index}]`;

      if (seenSourceEndpointIds.has(sourceId)) {
        errorMessages.push({
          errorLocation: errorLocation,
          message: `Duplicate source endpointId "${sourceId}" found.`,
        });
      } else {
        seenSourceEndpointIds.add(sourceId);
      }
    });

    return errorMessages;
  }

  private validateCyclicEndpointDependencies(
    endpointDependencies: TSimulationEndpointDependency[],
  ): TSimulationConfigErrors[] {
    // Store all detected error messages
    const errorMessages: TSimulationConfigErrors[] = [];

    // Create a dependency graph using Map,
    // where each endpoint maps to the list of endpoint IDs it depends on
    const dependencyGraph = new Map<string, string[]>();

    // Convert endpointDependencies into a graph structure
    endpointDependencies.forEach(dep => {
      dependencyGraph.set(dep.endpointId, Array.from(new Set(dep.dependOn.map(d => d.endpointId))));
    });

    // Track already reported cycles to avoid duplicate error messages
    const reportedCycles = new Set<string>();

    /**
     * Depth-First Search (DFS) for detecting Cyclic dependencies
     * @param node The current node being visited
     * @param currentPath The current DFS traversal path
     * @param visited A set of nodes visited in the current DFS path
     */
    function dfsForDetectCycle(node: string, currentPath: string[], visited: Set<string>) {
      currentPath.push(node); // Add the current node to the DFS path
      visited.add(node);      // Mark the node as visited (within this DFS path)

      // Get the list of neighboring nodes (dependencies)
      const neighbors = dependencyGraph.get(node) || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          // If the neighbor hasn't been visited in this path, continue DFS
          dfsForDetectCycle(neighbor, currentPath, visited);
        } else {
          // If the neighbor is already in the current path, a cycle is detected
          const cycleStartIndex = currentPath.indexOf(neighbor);
          if (cycleStartIndex !== -1) {
            // Extract the cycle path from the path and complete the loop
            const cyclePath = currentPath.slice(cycleStartIndex).concat(neighbor);

            // Normalize the cycle path using sorted unique nodes to prevent duplicate reports
            const normalizedCycle = [...new Set(cyclePath)].sort().join("->");
            if (!reportedCycles.has(normalizedCycle)) {
              reportedCycles.add(normalizedCycle);
              errorMessages.push({
                errorLocation: `endpointDependencies`,
                message: `Cyclic dependency detected: ${cyclePath.join(" -> ")}`,
              });
            }
          }
        }
      }

      // Backtrack: remove the current node from path and visited set
      currentPath.pop();
      visited.delete(node);
    }

    // Iterate through all nodes and perform DFS to detect cycles
    for (const node of dependencyGraph.keys()) {
      dfsForDetectCycle(node, [], new Set());
    }

    // Return all detected error messages
    return errorMessages;
  }

  private validateServiceMetrics(parsedConfig: TSimulationConfigYAML): TSimulationConfigErrors[] {
    const errorMessages: TSimulationConfigErrors[] = [];

    // service metric
    const definedServiceVersions = new Set<string>();
    parsedConfig.servicesInfo.forEach(ns => {
      ns.services.forEach(svc => {
        svc.versions.forEach(ver => {
          const key = `${svc.serviceName}\t${ver.version}`;
          definedServiceVersions.add(key);
        });
      });
    });

    parsedConfig.loadSimulation?.serviceMetrics.forEach((metric, index) => {
      const errorLocation = `loadSimulation.serviceMetrics[${index}]`;
      metric.versions.forEach((ver, verIndex) => {
        const versionLocation = `${errorLocation}.versions[${verIndex}]`;
        const serviceVersionKey = `${metric.serviceName.trim()}\t${ver.version.trim()}`;

        if (!definedServiceVersions.has(serviceVersionKey)) {
          errorMessages.push({
            errorLocation: versionLocation,
            message: `serviceName "${metric.serviceName}" with version "${ver.version}" is not defined in servicesInfo.`,
          });
        }
      });
    });

    const seenServiceVersions = new Set<string>();
    parsedConfig.loadSimulation?.serviceMetrics.forEach((metric, index) => {
      const errorLocation = `loadSimulation.serviceMetrics[${index}]`;
      metric.versions.forEach((ver, verIndex) => {
        const versionLocation = `${errorLocation}.versions[${verIndex}]`;
        const serviceVersionKey = `${metric.serviceName.trim()}\t${ver.version.trim()}`;

        if (seenServiceVersions.has(serviceVersionKey)) {
          errorMessages.push({
            errorLocation: versionLocation,
            message: `Duplicate serviceName "${metric.serviceName}" with version "${ver.version}" found in serviceMetrics.`,
          });
        } else {
          seenServiceVersions.add(serviceVersionKey);
        }
      });
    });

    return errorMessages;
  }

  private validateEndpointMetrics(parsedConfig: TSimulationConfigYAML, allDefinedEndpointIds: Set<string>): TSimulationConfigErrors[] {
    const errorMessages: TSimulationConfigErrors[] = [];

    // endpoint metric
    const seenEndpointIds = new Set<string>();
    parsedConfig.loadSimulation?.endpointMetrics.forEach((m, index) => {
      const errorLocation = `loadSimulation.endpointMetrics[${index}]`;
      if (!allDefinedEndpointIds.has(m.endpointId)) {
        errorMessages.push({
          errorLocation: errorLocation,
          message: `EndpointId "${m.endpointId}" is not defined in servicesInfo.`,
        });
      }
    });

    parsedConfig.loadSimulation?.endpointMetrics.forEach((m, index) => {
      const errorLocation = `loadSimulation.endpointMetrics[${index}]`;
      if (seenEndpointIds.has(m.endpointId)) {
        errorMessages.push({
          errorLocation: errorLocation,
          message: `Duplicate endpointId "${m.endpointId}" found in endpointMetrics.`,
        });
      } else {
        seenEndpointIds.add(m.endpointId);
      }
    });

    return errorMessages;
  }

  private assignServiceIdsToMetrics(parsedConfig: TSimulationConfigYAML): TSimulationConfigErrors[] {
    const errorMessages: TSimulationConfigErrors[] = [];
    const serviceVersionToIdMap = new Map<string, string>();

    parsedConfig.servicesInfo.forEach(ns => {
      ns.services.forEach(svc => {
        svc.versions.forEach(ver => {
          const key = `${svc.serviceName.trim()}\t${ver.version.trim()}`;
          serviceVersionToIdMap.set(key, ver.serviceId!);
        });
      });
    });

    parsedConfig.loadSimulation?.serviceMetrics.forEach((metric, metricIndex) => {
      metric.versions.forEach((ver, verIndex) => {
        const key = `${metric.serviceName.trim()}\t${ver.version.trim()}`;
        const matchedServiceId = serviceVersionToIdMap.get(key);
        const errorLocation = `loadSimulation.serviceMetrics[${metricIndex}].versions[${verIndex}].serviceId`;

        if (matchedServiceId) {
          ver.serviceId = matchedServiceId;
        } else {
          errorMessages.push({
            errorLocation: errorLocation,
            message: `Cannot map serviceId for serviceName="${metric.serviceName}" and version="${ver.version}".`,
          });
        }
      });
    });

    return errorMessages;
  }

  private convertEndpointIdsToUniqueEndpointNames(parsedConfig: TSimulationConfigYAML): TSimulationConfigErrors[] {
    const errorMessages: TSimulationConfigErrors[] = [];// If earlier validation steps were thorough, errorMessages should be empty.(This is just in case).
    const endpointIdToUniqueNameMap = new Map<string, string>();
    // Generate unique endpointIds and build mapping
    const existingUniqueEndpointNameMappings = this.getExistingUniqueEndpointNameMappings();
    parsedConfig.servicesInfo.forEach((namespace) => {
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
    parsedConfig.endpointDependencies.forEach((dep, index) => {
      const originalSourceId = dep.endpointId;
      const mappedSourceId = endpointIdToUniqueNameMap.get(originalSourceId);
      const sourceLocation = `endpointDependencies[${index}].endpointId`;

      if (mappedSourceId) {
        dep.endpointId = mappedSourceId;
      } else {
        // This error should not occur if earlier validation is correctly implemented, but included as a safeguard
        errorMessages.push({
          errorLocation: sourceLocation,
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
            errorLocation: targetLocation,
            message: `Cannot map target endpointId "${originalTargetId}".`
          });
        }
      });
    });
    // Replace endpointIds in loadSimulation
    parsedConfig.loadSimulation?.endpointMetrics.forEach((metric, index) => {
      const originalId = metric.endpointId;
      const mappedId = endpointIdToUniqueNameMap.get(originalId);
      const errorLocation = `loadSimulation.endpointMetrics[${index}].endpointId`;

      if (mappedId) {
        metric.endpointId = mappedId;
      } else {
        errorMessages.push({
          errorLocation: errorLocation,
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

  private getPathFromUrl(url: string) {
    try {
      return new URL(url).pathname;
    } catch {
      return "/";
    }
  }
}

