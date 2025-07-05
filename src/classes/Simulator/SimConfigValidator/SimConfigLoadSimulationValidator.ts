import {

  TSimulationConfigErrors,
  TLoadSimulationSettings,
} from "../../../entities/TSimulationConfig";

export default class SimConfigLoadSimulationValidator {

  validate(
    loadSimulationSettings: TLoadSimulationSettings,
    allAssignedUniqueServiceNames: Set<string>,
    allDefinedEndpointIds: Set<string>,
  ): TSimulationConfigErrors[] {
    const serviceMetricErrors = this.validateServiceMetrics(
      loadSimulationSettings,
      allAssignedUniqueServiceNames
    );
    const endpointMetricErrors = this.validateEndpointMetrics(loadSimulationSettings, allDefinedEndpointIds);
    const loadSimulationValidationErrors = [
      ...serviceMetricErrors,
      ...endpointMetricErrors,
    ];

    if (loadSimulationValidationErrors.length) return loadSimulationValidationErrors;

    // If no errors found, return an empty array.
    return [];
  }

  private validateServiceMetrics(
    loadSimulationSettings: TLoadSimulationSettings,
    allAssignedUniqueServiceNames: Set<string>
  ): TSimulationConfigErrors[] {
    const errorMessages: TSimulationConfigErrors[] = [];

    loadSimulationSettings.serviceMetrics.forEach((namespace, nsIndex) => {
      namespace.services.forEach((service, svcIndex) => {
        const serviceLocation = `loadSimulation.serviceMetrics[${nsIndex}].services[${svcIndex}]`;
        service.versions.forEach((version, verIndex) => {
          const versionLocation = `${serviceLocation}.versions[${verIndex}]`;
          const uniqueServiceName = `${service.serviceName.trim()}\t${namespace.namespace.trim()}\t${version.version.trim()}`

          if (!allAssignedUniqueServiceNames.has(uniqueServiceName)) {
            errorMessages.push({
              errorLocation: versionLocation,
              message: `service "${service.serviceName}" in namespace "${namespace}" with version "${version.version}" is not defined in servicesInfo.`,
            });
          } else {
            //assign uniqueServiceName
            version.uniqueServiceName = uniqueServiceName;
          }
        })
      })
    });

    const seenServiceVersions = new Set<string>();
    loadSimulationSettings.serviceMetrics.forEach((namespace, nsIndex) => {
      namespace.services.forEach((service, svcIndex) => {
        const serviceLocation = `loadSimulation.serviceMetrics[${nsIndex}].services[${svcIndex}]`;

        service.versions.forEach((version, verIndex) => {
          const versionLocation = `${serviceLocation}.versions[${verIndex}]`;
          const uniqueServiceName = `${service.serviceName.trim()}\t${namespace.namespace.trim()}\t${version.version.trim()}`
          if (seenServiceVersions.has(uniqueServiceName)) {
            errorMessages.push({
              errorLocation: versionLocation,
              message: `Duplicate service "${service.serviceName}" in namespace "${namespace}" with version "${version.version}" found in serviceMetrics.`,
            });
          } else {
            seenServiceVersions.add(uniqueServiceName);
          }
        });
      });
    });

    return errorMessages;
  }

  private validateEndpointMetrics(loadSimulationSettings: TLoadSimulationSettings, allDefinedEndpointIds: Set<string>): TSimulationConfigErrors[] {
    const errorMessages: TSimulationConfigErrors[] = [];

    // endpoint metric
    const seenEndpointIds = new Set<string>();
    loadSimulationSettings.endpointMetrics.forEach((m, index) => {
      const errorLocation = `loadSimulation.endpointMetrics[${index}]`;
      if (!allDefinedEndpointIds.has(m.endpointId)) {
        errorMessages.push({
          errorLocation: errorLocation,
          message: `EndpointId "${m.endpointId}" is not defined in servicesInfo.`,
        });
      }
    });

    loadSimulationSettings.endpointMetrics.forEach((m, index) => {
      const errorLocation = `loadSimulation.endpointMetrics[${index}]`;
      if (seenEndpointIds.has(m.endpointId)) {
        errorMessages.push({
          errorLocation: errorLocation,
          message: `Duplicate endpointId "${m.uniqueEndpointName}" found in endpointMetrics.`,
        });
      } else {
        seenEndpointIds.add(m.endpointId);
      }
    });

    return errorMessages;
  }

}