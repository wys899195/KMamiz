import IRequestHandler from "../entities/TRequestHandler";
import DependencyGraphSimulator from "../classes/DependencyGraphSimulator";

import { TGraphData } from "../entities/TGraphData";


export default class SimulationService extends IRequestHandler {
  constructor() {
    super("simulation");

    this.addRoute(
      "post",
      "/yamlToDependency",
      async (req, res) => {
        const { yamlData } = req.body as { yamlData: string };
        const simulator = new DependencyGraphSimulator();
        const decodedYamlData = yamlData ? decodeURIComponent(yamlData) : '';
        const validationResult = simulator.isValidYamlFormatForDependencySimulation(decodedYamlData);
        if (!validationResult.valid) {
          return res.status(400).json({ message: validationResult.message });
        }
        const graph = await simulator.yamlToGraphData(decodedYamlData);

        if (graph) {
          res.json(graph);
        } else {
          res.sendStatus(404);
        }
      }
    );

    this.addRoute(
      "post",
      "/endpointDependencyToYaml",
      async (req, res) => {
        const endpointDependencyGraph = req.body as TGraphData;
        if (!endpointDependencyGraph) {
          res.json('');
        }
        const simulator = new DependencyGraphSimulator();
        const yamlString = await simulator.graphDataToYaml(endpointDependencyGraph);
        res.json(yamlString);

      }
    );
  }


}
