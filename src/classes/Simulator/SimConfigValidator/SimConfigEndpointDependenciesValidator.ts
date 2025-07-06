import {

  TSimulationConfigErrors,
  TSimulationEndpointDependency,
  TServiceInfoDefinitionContext,
} from "../../../entities/TSimulationConfig";

export default class SimConfigEndpointDependenciesValidator {
  validate(
    endpointDependenciesConfig: TSimulationEndpointDependency[],
    serviceInfoDefinitionContext: TServiceInfoDefinitionContext
  ): TSimulationConfigErrors[] {
    const undefinedEndpointIdsErrors = this.checkUndefinedEndpointIds(endpointDependenciesConfig, serviceInfoDefinitionContext);
    if (undefinedEndpointIdsErrors.length) return undefinedEndpointIdsErrors;

    const duplicatedEndpointIdErrors = this.checkDuplicatedEndpointIdDefinitions(endpointDependenciesConfig);
    if (duplicatedEndpointIdErrors.length) return duplicatedEndpointIdErrors;

    const cyclicDependenciesErrors = this.checkCyclicEndpointDependencies(endpointDependenciesConfig);
    if (cyclicDependenciesErrors.length) return cyclicDependenciesErrors;

    // If no errors found, return an empty array.
    return [];
  }

  //Check that both source endpointIds and all target endpointIds in dependOn are defined in servicesInfo.
  private checkUndefinedEndpointIds(
    endpointDependenciesConfig: TSimulationEndpointDependency[],
    serviceInfoDefinitionContext: TServiceInfoDefinitionContext,
  ): TSimulationConfigErrors[] {
    const errorMessages: TSimulationConfigErrors[] = [];
    endpointDependenciesConfig.forEach((dep, index) => {
      const errorLocation = `endpointDependencies[${index}]`;
      if (!serviceInfoDefinitionContext.allDefinedEndpointIds.has(dep.endpointId)) {
        errorMessages.push({
          errorLocation: errorLocation,
          message: `Source endpointId "${dep.endpointId}" is not defined in servicesInfo.`,
        });
      }
      dep.dependOn.forEach((d, subIndex) => {
        const subLocation = `${errorLocation}.dependOn[${subIndex}]`;
        if (!serviceInfoDefinitionContext.allDefinedEndpointIds.has(d.endpointId)) {
          errorMessages.push({
            errorLocation: subLocation,
            message: `Target endpointId "${d.endpointId}" is not defined in servicesInfo.`,
          });
        }
      });
    });

    return errorMessages;
  }
  // Check for duplicate source endpointIds within endpointDependencies
  private checkDuplicatedEndpointIdDefinitions(
    endpointDependenciesConfig: TSimulationEndpointDependency[],
  ): TSimulationConfigErrors[] {
    const errorMessages: TSimulationConfigErrors[] = [];
    const seenSourceEndpointIds = new Set<string>();

    endpointDependenciesConfig.forEach((dep, index) => {
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

    // The reason why checking target endpointIds is unnecessary is because this issue 
    // can be avoided later during the construction of the dependOnMap(targets stored in Set).

    return errorMessages;
  }
  // Check for cyclic dependency issues (including self-dependencies)
  private checkCyclicEndpointDependencies(
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

}