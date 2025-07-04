import {

  TSimulationConfigErrors,
  TSimulationEndpointDependency,
} from "../../../entities/TSimulationConfig";

export default class SimConfigEndpointDependenciesPreprocessor {
  preprocess(
    endpointDependenciesConfig: TSimulationEndpointDependency[],
    endpointIdToUniqueNameMap: Map<string, string>, // key: endpointId, value: UniqueEndpointName
  ): TSimulationConfigErrors[] {
    const assignUniqueEndpointNameErrors = this.assignUniqueEndpointName(endpointDependenciesConfig, endpointIdToUniqueNameMap);
    if (assignUniqueEndpointNameErrors.length) return assignUniqueEndpointNameErrors;

    // If no errors found, return an empty array.
    return [];
  }

  // Assign uniqueEndpointName to each endpoint for later use
  private assignUniqueEndpointName(
    endpointDependenciesConfig: TSimulationEndpointDependency[],
    endpointIdToUniqueNameMap: Map<string, string>,
  ): TSimulationConfigErrors[] {
    // If the previous validations were correctly implemented, this error should not occur
    // this is here only as a safeguard.
    const errorMessages: TSimulationConfigErrors[] = [];

    endpointDependenciesConfig.forEach((source, sourceIndex) => {
      source.uniqueEndpointName = endpointIdToUniqueNameMap.get(source.endpointId)!;
      if (!source.uniqueEndpointName) {
        const sourceLocation = `endpointDependencies[${sourceIndex}].endpointId`;
        errorMessages.push({
          errorLocation: sourceLocation,
          message: `Failed to assign uniqueEndpointName: endpointId "${source.endpointId}" does not exist in the mapping. (This is unexpected system error!!)`
        });
      }
      source.dependOn.forEach((target, targetIndex) => {
        target.uniqueEndpointName = endpointIdToUniqueNameMap.get(target.endpointId)!;
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