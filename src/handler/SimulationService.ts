import { Response } from "express";
import IRequestHandler from "../entities/TRequestHandler";
import Simulator from "../classes/Simulator/Simulator";
import SimulationConfigManager from "../classes/Simulator/SimulationConfigManager";
import ServiceOperator from "../services/ServiceOperator";
import ImportExportHandler from "../services/ImportExportHandler";
// import { CTaggedSimulationYAML } from "../classes/Cacheable/CTaggedSimulationYAML";
// import DataCache from "../services/DataCache";

type TStartSimulationResponse = {
  message: string,
  simulateDate: number,
}

export default class SimulationService extends IRequestHandler {
  constructor() {
    super("simulation");
    this.addRoute(
      "post",
      "/startSimulation",
      async (req, res: Response<TStartSimulationResponse>) => {
        const { simConfigYAML } = req.body as { simConfigYAML: string };
        const simulator = Simulator.getInstance();
        const decodedYAMLData = simConfigYAML ? simConfigYAML : '';
        const isEmptyYAML = !decodedYAMLData.trim();
        const simulateDate = Date.now();// The time at the start of the simulation.

        if (isEmptyYAML) {
          return res.status(201).json({
            message: "Received an empty YAML. Skipping data retrieval.",
            simulateDate: simulateDate,
          });
        } else {
          try {
            //clear simulator data first
            await ImportExportHandler.getInstance().clearData();

            //retrieve data from yaml
            const result = simulator.generateSimulationDataFromConfig(decodedYAMLData, simulateDate);
            if (result.validationErrorMessage) {
              return res.status(400).json({
                message: result.validationErrorMessage,
                simulateDate: simulateDate,
              });
            } else if (result.convertingErrorMessage) {
              return res.status(500).json({
                message: result.convertingErrorMessage,
                simulateDate: simulateDate,
              });
            } else {
              //update to cache and create historical and aggregatedData
              try {
                ServiceOperator.getInstance().updateStaticSimulateDataToCache({
                  dependencies: result.endpointDependencies,
                  dataTypes: result.dataType,
                  replicaCounts: result.basicReplicaCountList
                });

                await ServiceOperator.getInstance().updateDynamicSimulateData({
                  realtimeDataMap: result.realtimeCombinedDataPerTimeSlotMap
                });
                return res.status(201).json({
                  message: "ok",
                  simulateDate: simulateDate,
                });
              } catch (err) {
                return res.status(500).json({
                  message: `Error while caching and creating historical and aggregated data:\n---\n${err instanceof Error ? err.message : err}`,
                  simulateDate: simulateDate,
                });
              }
            }
          } catch (err) {
            return res.status(500).json({
              message: `Error simulate retrive data by YAML:\n---\n${err instanceof Error ? err.message : err}`,
              simulateDate: simulateDate,
            });
          }
        }

      }
    );

    this.addRoute(
      "get",
      "/generateStaticSimConfig",
      async (_, res) => {
        try {
          const staticYamlStr = SimulationConfigManager.getInstance().generateStaticSimConfig();
          return res.status(200).json({
            staticYamlStr: staticYamlStr,
            message: "ok"
          });
        } catch (err) {
          return res.status(500).json({
            staticYamlStr: '',
            message: `Error while trying to generate static Simulation Yaml:\n${err instanceof Error ? err.message : err}`
          });
        }
      }
    );
  }

}
