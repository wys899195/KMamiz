import IRequestHandler from "../entities/TRequestHandler";
import DependencyGraphSimulator from "../classes/Simulator/DependencyGraphSimulator";
import TrafficSimulator from "../classes/Simulator/TrafficSimulator";
import { TGraphData } from "../entities/TGraphData";
import ServiceOperator from "../services/ServiceOperator";
import ImportExportHandler from "../services/ImportExportHandler";
// import { CTaggedSimulationYAML } from "../classes/Cacheable/CTaggedSimulationYAML";
// import DataCache from "../services/DataCache";

export default class SimulationService extends IRequestHandler {
  constructor() {
    super("simulation");

    this.addRoute(
      "post",
      "/yamlToDependency",
      async (req, res) => {
        const { yamlData, showEndpoint } = req.body as { yamlData: string; showEndpoint: boolean };
        const simulator = DependencyGraphSimulator.getInstance();
        const decodedYAMLData = yamlData ? decodeURIComponent(yamlData) : '';
        try {
          const result = simulator.yamlToGraphData(decodedYAMLData);

          const isEmptyYAML = !decodedYAMLData.trim();
          const hasNoYamlFormatError = !result.validationErrorMessage;

          if (isEmptyYAML || hasNoYamlFormatError) {
            if (showEndpoint) {
              return res.status(200).json({ graph: result.graph, message: result.validationErrorMessage });
            } else { //service graph
              return res.status(200).json({ graph: this.toServiceDependencyGraph(result.graph), message: result.validationErrorMessage });
            }

          } else {
            return res.status(400).json({ graph: result.graph, message: result.validationErrorMessage });
          }
        } catch (err) {
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
        const yamlString = DependencyGraphSimulator.getInstance().graphDataToYAML(endpointDependencyGraph);
        res.json(yamlString);

      }
    );

    this.addRoute(
      "post",
      "/retrieveDataByYAML",
      async (req, res) => {
        const { yamlData } = req.body as { yamlData: string };
        const simulator = TrafficSimulator.getInstance();
        const decodedYAMLData = yamlData ? yamlData : '';
        const isEmptyYAML = !decodedYAMLData.trim();
        if (isEmptyYAML) {
          return res.status(201).json({ message: "Received an empty YAML. Skipping data retrieval." });
        } else {
          try {
            //clear simulator data first
            await ImportExportHandler.getInstance().clearData();
            
            //retrieve data from yaml
            const result = simulator.yamlToSimulationData(decodedYAMLData);

            if (result.validationErrorMessage) {
              return res.status(400).json({ message: result.validationErrorMessage });
            } else if (result.convertingErrorMessage) {
              return res.status(500).json({ message: result.convertingErrorMessage });
            } else {
              //update to cache and create historical and aggregatedData
              try {
                ServiceOperator.getInstance().postSimulationRetrieve({
                  rlDataList: result.cbRealtimeDataList,
                  dependencies: result.endpointDependencies,
                  dataType: result.dataType,
                  replicaCount: result.replicaCountList
                });
                ServiceOperator.getInstance().createHistoricalAndAggregatedData();
                return res.status(200).json({ message: "ok" });
              } catch (err) {
                return res.status(500).json({ message: `Error while caching and creating historical and aggregated data:\n${err instanceof Error ? err.message : err}` });
              }
            }
          } catch (err) {
            return res.status(500).json({ graph: null, message: `Error simulate retrive data by YAML:\n${err instanceof Error ? err.message : err}` });
          }
        }

      }
    );

    this.addRoute(
      "get",
      "/generateStaticYaml",
      async (_, res) => {
        try {
          const staticYamlStr = TrafficSimulator.getInstance().generateStaticYamlFromCurrentData();
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

  // getTagsOfDiffData(): { tag: string; time: number }[] {
  //   return DataCache.getInstance()
  //     .get<CTaggedSimulationYAML>("TaggedDiffDatas")
  //     .getTagsWithTime();
  // }

  // addTaggedDiffData(tagged: TTaggedDiffData) {
  //   DataCache.getInstance()
  //     .get<CTaggedSimulationYAML>("TaggedDiffDatas")
  //     .add(tagged);
  // }

  // deleteTaggedDiffData(tag: string) {
  //   DataCache.getInstance()
  //     .get<CTaggedSimulationYAML>("TaggedDiffDatas")
  //     .delete(tag);
  // }

  private toServiceDependencyGraph(endpointGraph: TGraphData): TGraphData {
    const linkSet = new Set<string>();
    endpointGraph.links.forEach((l) => {
      const source = l.source.split("\t").slice(0, 2).join("\t");
      const target = l.target.split("\t").slice(0, 2).join("\t");
      linkSet.add(`${source}\n${target}`);
    });

    const links = [...linkSet]
      .map((l) => l.split("\n"))
      .map(([source, target]) => ({ source, target }));

    const nodes = endpointGraph.nodes.filter((n) => n.id === n.group);
    nodes.forEach((n) => {
      n.linkInBetween = links.filter((l) => l.source === n.id);
      n.dependencies = n.linkInBetween.map((l) => l.target);
    });

    const serviceGraph: TGraphData = {
      nodes,
      links,
    };
    return serviceGraph;
  }

}
