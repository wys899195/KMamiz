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
        const validationResult = simulator.isValidYAMLFormatForDependencySimulation(decodedYAMLData);
        if (!validationResult.isYAMLValid) {
          return res.status(400).json({ graph: null, message: validationResult.message });
        } else {
          try {
            const graph = await simulator.yamlToGraphData(decodedYAMLData);
            return res.status(200).json({ graph: graph, message: validationResult.message });
          } catch (err) {
            return res.status(500).json({ graph: null, message: "Error converting YAML to graph data:\n" + JSON.stringify(err instanceof Error ? err.message : String(err)) });
          }
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
        const yamlString = await simulator.graphDataToYAML(endpointDependencyGraph);
        res.json(yamlString);

      }
    );
  }


}
