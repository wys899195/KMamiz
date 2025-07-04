import {
  TSimulationConfigErrors,
  TSimulationNamespace,
} from "../../../entities/TSimulationConfig";
import SimulatorUtils from "../SimulatorUtils";
export default class SimConfigServicesInfoValidator {
  validate(
    servicesInfoConfig: TSimulationNamespace[]
  ): TSimulationConfigErrors[] {
    const duplicateServiceErrors = this.checkDuplicateServiceDefinitions(servicesInfoConfig);
    if (duplicateServiceErrors.length) return duplicateServiceErrors;

    const duplicateEndpointIdErrors = this.checkDuplicateEndpointIdsDefinitions(servicesInfoConfig);
    if (duplicateEndpointIdErrors.length) return duplicateEndpointIdErrors;

    // If no errors found, return an empty array.
    return [];
  }

  private checkDuplicateServiceDefinitions(
    servicesInfoConfig: TSimulationNamespace[]
  ): TSimulationConfigErrors[] {
    const errorMessages: TSimulationConfigErrors[] = [];
    const existingUniqueServiceName = new Set<string>();

    servicesInfoConfig.forEach(ns =>
      ns.services.forEach(svc =>
        svc.versions.forEach(ver => {
          const uniqueServiceName = SimulatorUtils.generateUniqueServiceName(svc.serviceName, ns.namespace, ver.version);

          // Check for duplicates
          if (existingUniqueServiceName.has(uniqueServiceName)) {
            errorMessages.push({
              errorLocation: `servicesInfo > namespace: ${ns.namespace} > serviceName: ${svc.serviceName} > version: ${ver.version}`,
              message: `Duplicate service found.`
            });
          } else {
            existingUniqueServiceName.add(uniqueServiceName);
          }
        })
      )
    );
    return errorMessages;
  }

  private checkDuplicateEndpointIdsDefinitions(
    servicesInfoConfig: TSimulationNamespace[]
  ): TSimulationConfigErrors[] {
    const errorMessages: TSimulationConfigErrors[] = [];
    const allDefinedEndpointIds = new Set<string>();

    servicesInfoConfig.forEach(ns =>
      ns.services.forEach(svc =>
        svc.versions.forEach(ver =>
          ver.endpoints.forEach(ep => {
            if (allDefinedEndpointIds.has(ep.endpointId)) {
              errorMessages.push({
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

    return errorMessages;
  }
}