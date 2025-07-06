import {

  TSimulationConfigErrors,
  TSimulationEndpointDependency,
  TServiceInfoDefinitionContext,
} from "../../../entities/TSimulationConfig";

export default class SimConfigEndpointDependenciesPreprocessor {
  preprocess(
    endpointDependenciesConfig: TSimulationEndpointDependency[],
    serviceInfoDefinitionContext: TServiceInfoDefinitionContext,
  ): TSimulationConfigErrors[] {
    const assignUniqueEndpointNameErrors = this.assignUniqueEndpointName(
      endpointDependenciesConfig,
      serviceInfoDefinitionContext
    );
    if (assignUniqueEndpointNameErrors.length) return assignUniqueEndpointNameErrors;

    // If no errors found, return an empty array.
    return [];
  }

  // Assign uniqueEndpointName to each endpoint for later use
  private assignUniqueEndpointName(
    endpointDependenciesConfig: TSimulationEndpointDependency[],
    serviceInfoDefinitionContext: TServiceInfoDefinitionContext,
  ): TSimulationConfigErrors[] {
    // errorMessages is here only as a safeguard.
    // If the previous validations were correctly implemented, this error should not occur
    const errorMessages: TSimulationConfigErrors[] = [];

    endpointDependenciesConfig.forEach((source, sourceIndex) => {
      source.uniqueEndpointName =
        serviceInfoDefinitionContext.endpointIdToUniqueNameMap.get(source.endpointId);
      if (!source.uniqueEndpointName) {
        const sourceLocation = `endpointDependencies[${sourceIndex}].endpointId`;
        errorMessages.push({
          errorLocation: sourceLocation,
          message: `Failed to assign uniqueEndpointName: endpointId "${source.endpointId}" does not exist in the mapping. (This is unexpected system error!!)`
        });
      }
      source.dependOn.forEach((target, targetIndex) => {
        target.uniqueEndpointName =
          serviceInfoDefinitionContext.endpointIdToUniqueNameMap.get(target.endpointId);
        if (!target.uniqueEndpointName) {
          const targetLocation = `endpointDependencies[${sourceIndex}].dependOn[${targetIndex}].endpointId`;
          errorMessages.push({
            errorLocation: targetLocation,
            message: `Failed to assign uniqueEndpointName: endpointId "${target.endpointId}" does not exist in the mapping. (This is unexpected system error!!)`
          });
        }
      });
    });
    return errorMessages;
  }


}