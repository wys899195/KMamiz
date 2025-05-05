import IRequestHandler from "../entities/TRequestHandler";
import { CTaggedDiffData } from "../classes/Cacheable/CTaggedDiffData";
import { TTaggedDiffData } from "../entities/TTaggedDiffData";
import DataCache from "../services/DataCache";
import GlobalSettings from "../../src/GlobalSettings";
import KubernetesService from "../services/KubernetesService";
import GraphService from "./GraphService";

export default class DiffComparatorService extends IRequestHandler {
  private graphHandler: GraphService;

  constructor() {
    super("diffComparator");
    this.graphHandler = new GraphService();


    this.addRoute(
      "get",
      "/taggedDependency",
      async (req, res) => {
        const { tag } = req.query as { tag: string };
        const decodedTag = tag && decodeURIComponent(tag);

        res.json(await this.getTaggedDependencyGraphs(decodedTag));
      }
    );
    this.addRoute(
      "get",
      "/diffData/tags",
      async (req, res) => {
        req = req; // to aviod compile error: 'req' is declared but its value is never read"
        res.json(this.getTagsOfDiffData());
      });

    if (!GlobalSettings.SimulatorMode) {
      this.addRoute(
        "post",
        "/diffData/tags",
        async (req, res) => {
          const { tag } = req.body as {
            tag: string;
          };
          if (!tag) res.sendStatus(400);
          else {
            const graphData = await this.graphHandler.getDependencyGraph();
            const cohesionData = this.graphHandler.getServiceCohesion();
            const couplingData = this.graphHandler.getServiceCoupling();
            const instabilityData = this.graphHandler.getServiceInstability();
            console.log("graphData ", JSON.stringify(graphData, null, 2));
            console.log("cohesionData ", JSON.stringify(cohesionData, null, 2));
            console.log("couplingData ", JSON.stringify(couplingData, null, 2));
            console.log("instabilityData ", JSON.stringify(instabilityData, null, 2));
            if (!graphData || !cohesionData || !couplingData || !instabilityData) {
              res.sendStatus(500);
            } else {
              this.addTaggedDiffData({
                tag: tag,
                graphData: graphData,
                cohesionData: cohesionData,
                couplingData: couplingData,
                instabilityData: instabilityData
              });
              res.sendStatus(200);
            }

          }
        });
    } else {
      this.addRoute(
        "post",
        "/diffData/tags",
        async (req, res) => {
          const { tag } = req.body as {
            tag: string;
          };
          if (!tag) res.sendStatus(400);
          else {
            const graphData = await this.graphHandler.getDependencyGraph();
            const cohesionData = this.graphHandler.getServiceCohesion();
            const couplingData = this.graphHandler.getServiceCoupling();
            const instabilityData = this.graphHandler.getServiceInstability();
            console.log("graphData Simulator", JSON.stringify(graphData, null, 2));
            console.log("cohesionData Simulator", JSON.stringify(cohesionData, null, 2));
            console.log("couplingData Simulator", JSON.stringify(couplingData, null, 2));
            console.log("instabilityData Simulator", JSON.stringify(instabilityData, null, 2));
            if (!graphData || !cohesionData || !couplingData || !instabilityData) {
              res.sendStatus(500);
            } else {
              // the kmamiz service which in production mode will append a diffData
              try {
                const productionServiceBaseURL = await KubernetesService.getInstance().getProductionServiceBaseURL();
                const resFromProductionMode = await fetch(`${productionServiceBaseURL}/api/v1/diffComparator/diffData/tagged/tags`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    tag: `[from Simulator] ${tag}`,
                    graphData: graphData,
                    cohesionData: cohesionData,
                    couplingData: couplingData,
                    instabilityData: instabilityData
                  }),
                });
                if (!resFromProductionMode.ok) {
                  const errorText = await resFromProductionMode.text();
                  return res.status(500).json({ message: errorText });
                } else {
                  res.sendStatus(200);
                }
              } catch (err) {
                console.error("Error calling kmamiz:", err);
                res.sendStatus(500);
              }
            }
          }
        });
    }


    if (!GlobalSettings.SimulatorMode) {
      this.addRoute(
        "post",
        "/diffData/tagged/tags",
        async (req, res) => {
          const tagged = req.body as TTaggedDiffData;
          if (!tagged) res.sendStatus(400);
          else {
            console.log("cohesionnnn=", JSON.stringify(tagged.cohesionData, null, 2))
            this.addTaggedDiffData(tagged);
            res.sendStatus(200);
          }
        });
    }

    this.addRoute(
      "delete",
      "/diffData/tags",
      async (req, res) => {
        const { tag } = req.body as {
          tag: string;
        };
        if (!tag) res.sendStatus(400);
        else {
          this.deleteTaggedDiffData(tag);
          res.sendStatus(200);
        }
      });

    this.addRoute("get", "/taggedServiceInsights", async (req, res) => {
      const { tag } = req.query as { tag: string };
      res.json(this.getTaggedServiceInsights(tag));
    });
  }

  async getTaggedDependencyGraphs(tag: string) {
    const diffData = DataCache.getInstance()
      .get<CTaggedDiffData>("TaggedDiffDatas")
      .getDataByTag(tag);

    const endpointGraph = diffData?.graphData || this.graphHandler.getEmptyGraphData();
    const serviceGraph = this.graphHandler.toServiceDependencyGraph(endpointGraph);

    return {
      endpointGraph,
      serviceGraph,
    };
  }

  getTagsOfDiffData():{ tag: string; time: number }[] {
    return DataCache.getInstance()
    .get<CTaggedDiffData>("TaggedDiffDatas")
    .getTagsWithTime();
  }

  addTaggedDiffData(tagged: TTaggedDiffData) {
    DataCache.getInstance()
      .get<CTaggedDiffData>("TaggedDiffDatas")
      .add(tagged);
  }

  deleteTaggedDiffData(tag: string) {
    DataCache.getInstance()
      .get<CTaggedDiffData>("TaggedDiffDatas")
      .delete(tag);
  }
  getTaggedServiceInsights(tag: string) {
    const diffData = DataCache.getInstance()
      .get<CTaggedDiffData>("TaggedDiffDatas")
      .getDataByTag(tag);
  
    return {
      cohesionData: diffData?.cohesionData || [],
      couplingData: diffData?.couplingData || [],
      instabilityData: diffData?.instabilityData || [],
    };
  }
}
