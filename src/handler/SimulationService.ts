import IRequestHandler from "../entities/TRequestHandler";
import DependencyGraphSimulator from "../classes/Simulator/DependencyGraphSimulator";

import { TGraphData } from "../entities/TGraphData";


export default class SimulationService extends IRequestHandler {
  constructor() {
    super("simulation");

    this.addRoute(
      "post",
      "/yamlToDependency",
      async (req, res) => {
        const { yamlData } = req.body as { yamlData: string };
        const simulator = DependencyGraphSimulator.getInstance();
        const decodedYAMLData = yamlData ? decodeURIComponent(yamlData) : '';
        try {
          console.log("start .yamlToGraphData")
          const result = simulator.yamlToGraphData(decodedYAMLData);
          console.log("end .yamlToGraphData")

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
  }


}
