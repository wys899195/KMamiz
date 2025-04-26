import IRequestHandler from "../entities/TRequestHandler";
import DependencyGraphSimulator from "../classes/Simulator/DependencyGraphSimulator";
import TrafficSimulator from "../classes/Simulator/TrafficSimulator";
import { TGraphData } from "../entities/TGraphData";
import ServiceOperator from "../services/ServiceOperator";

export default class SimulationService extends IRequestHandler {
  constructor() {
    super("simulation");

    this.addRoute(
      "post",
      "/yamlToEndpointDependency",
      async (req, res) => {
        const { yamlData } = req.body as { yamlData: string };
        const simulator = DependencyGraphSimulator.getInstance();
        const decodedYAMLData = yamlData ? decodeURIComponent(yamlData) : '';
        try {
          const result = simulator.yamlToGraphData(decodedYAMLData);

          const isEmptyYAML = !decodedYAMLData.trim();
          const hasNoYamlFormatError = !result.validationErrorMessage; 
  
          if (isEmptyYAML || hasNoYamlFormatError){
            return res.status(200).json({ graph: result.graph, message: result.validationErrorMessage });
          } else {
            return res.status(400).json({ graph: result.graph, message: result.validationErrorMessage });
          }
        } catch (err){
          return res.status(500).json({ graph: null, message: "Error converting YAML to graph data:\n" + JSON.stringify(err instanceof Error ? err.message : String(err)) });
        }
      }
    );

    this.addRoute(
      "post",
      "/endpointDependencyToYAML",
      async (req, res) => {
        const endpointDependencyGraph = req.body as TGraphData;
        if (!endpointDependencyGraph) {
          res.json('');
        }
        const simulator = DependencyGraphSimulator.getInstance();
        const yamlString = simulator.graphDataToYAML(endpointDependencyGraph);
        res.json(yamlString);

      }
    );

    this.addRoute(
      "post",
      "/retrieveDataByYAML",
      async (req, res) => {
        const { yamlData } = req.body as { yamlData: string };
        const simulator = TrafficSimulator.getInstance();
        const decodedYAMLData = yamlData ? decodeURIComponent(yamlData) : '';
        const isEmptyYAML = !decodedYAMLData.trim();
        if (isEmptyYAML) {
          return res.status(201).json({ message: "Received an empty YAML. Skipping data retrieval."  });
        } else {
          try {
            //retrieve data from yaml
            const result = simulator.yamlToSimulationRetrieveData(decodedYAMLData);

            if (result.validationErrorMessage) {
              return res.status(400).json({ message: result.validationErrorMessage });
            } else if (result.convertingErrorMessage) {
              return res.status(500).json({ message: result.convertingErrorMessage });
            } else {
              // console.log(`rlDataList = ${JSON.stringify(result.rlDataList,null,2)}\n=======\n`);
              // console.log(`dependencies = ${JSON.stringify(result.endpointDependencies,null,2)}\n=======\n`);
              // console.log(`dataType = ${JSON.stringify(result.dataType,null,2)}\n=======\n`);
              // console.log(`replicaCount = ${JSON.stringify(result.replicaCountList,null,2)}\n=======\n`);
              
              //update to cache and create historical and aggregatedData
              try {
                ServiceOperator.getInstance().postSimulationRetrieve({
                  rlDataList: result.rlDataList,
                  dependencies: result.endpointDependencies,
                  dataType: result.dataType,
                  replicaCount: result.replicaCountList
                });
                ServiceOperator.getInstance().createHistoricalAndAggregatedData();
                return res.status(200).json({ message: "ok" });
              } catch (err) {
                return res.status(500).json({ message: `Error while caching and creating historical and aggregated data:\n${err instanceof Error ? err.message : err}`});
              }
            }
          } catch (err){
            return res.status(500).json({ graph: null, message: `Error simulate retrive data by YAML:\n${err instanceof Error ? err.message : err}`});
          }
        }

      }
    );
  }


}
