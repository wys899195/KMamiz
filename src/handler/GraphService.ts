import { CEndpointDataType } from "../classes/Cacheable/CEndpointDataType";
import { CLabeledEndpointDependencies } from "../classes/Cacheable/CLabeledEndpointDependencies";
import { CTaggedDiffData } from "../classes/Cacheable/CTaggedDiffData";
import { CLabelMapping } from "../classes/Cacheable/CLabelMapping";
import EndpointDataType from "../classes/EndpointDataType";
import { EndpointDependencies } from "../classes/EndpointDependencies";
import { TLineChartData } from "../entities/TLineChartData";
import { TServiceStatistics } from "../entities/TStatistics";
import { TTaggedDiffData } from "../entities/TTaggedDiffData";

import { TGraphData } from "../entities/TGraphData";
import IRequestHandler from "../entities/TRequestHandler";
import { TServiceCohesion } from "../entities/TServiceCohesion";
import { TTotalServiceInterfaceCohesion } from "../entities/TTotalServiceInterfaceCohesion";
import DataCache from "../services/DataCache";
import ServiceUtils from "../services/ServiceUtils";
import { TRequestInfoChartData } from "../entities/TRequestInfoChartData";
import Logger from "../utils/Logger";
import GlobalSettings from "../../src/GlobalSettings";

export default class GraphService extends IRequestHandler {
  constructor() {
    super("graph");
    this.addRoute(
      "get",
      "/dependency/endpoint/:namespace?",
      async (req, res) => {
        const namespace = req.params["namespace"];
        const graph = await this.getDependencyGraph(
          namespace && decodeURIComponent(namespace)
        );
        if (graph) res.json(graph);
        else res.sendStatus(404);
      }
    );
    this.addRoute(
      "get",
      "/dependency/service/:namespace?",
      async (req, res) => {
        const namespace = req.params["namespace"];
        const graph = await this.getServiceDependencyGraph(
          namespace && decodeURIComponent(namespace)
        );
        if (graph) res.json(graph);
        else res.sendStatus(404);
      }
    );
    this.addRoute(
      "get", 
      "/taggedDependency/endpoint", 
      async (req, res) => {
      const { tag } = req.query as { tag: string };
      const graph = await this.getTaggedDependencyGraph(
        tag && decodeURIComponent(tag)
      );
      if (graph) res.json(graph);
      else res.sendStatus(404);
    });
    this.addRoute(
      "get", 
      "/taggedDependency/service", 
      async (req, res) => {
      const { tag } = req.query as { tag: string };
      const graph = await this.getTaggedServiceDependencyGraph(
        tag && decodeURIComponent(tag)
      );
      if (graph) res.json(graph);
      else res.sendStatus(404);
    });
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
            const graphData = await this.getDependencyGraph();
            const cohesionData = this.getServiceCohesion();
            const couplingData = this.getServiceCoupling();
            const instabilityData = this.getServiceInstability();
            console.log("graphData ",JSON.stringify(graphData ,null,2));
            console.log("cohesionData ",JSON.stringify(cohesionData ,null,2));
            console.log("couplingData ",JSON.stringify(couplingData ,null,2));
            console.log("instabilityData ",JSON.stringify(instabilityData ,null,2));
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
            const graphData = await this.getDependencyGraph();
            const cohesionData = this.getServiceCohesion();
            const couplingData = this.getServiceCoupling();
            const instabilityData = this.getServiceInstability();
            console.log("graphData ",JSON.stringify(graphData ,null,2));
            console.log("cohesionData ",JSON.stringify(cohesionData ,null,2));
            console.log("couplingData ",JSON.stringify(couplingData ,null,2));
            console.log("instabilityData ",JSON.stringify(instabilityData ,null,2));
            if (!graphData || !cohesionData || !couplingData || !instabilityData) {
              res.sendStatus(500);
            } else {
              // the kmamiz service which in production mode will append a diffData
              try {
                const resFromProductionMode = await fetch("http://kmamiz:8080/api/v1/graph/diffData/tagged/tags", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    tag: `(Simulator) ${tag}`,
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
    this.addRoute("get", "/chord/direct/:namespace?", async (req, res) => {
      const namespace = req.params["namespace"];
      res.json(
        await this.getDirectServiceChord(
          namespace && decodeURIComponent(namespace)
        )
      );
    });
    this.addRoute("get", "/chord/indirect/:namespace?", async (req, res) => {
      const namespace = req.params["namespace"];
      res.json(
        await this.getInDirectServiceChord(
          namespace && decodeURIComponent(namespace)
        )
      );
    });
    this.addRoute("get", "/line/:namespace?", async (req, res) => {
      const notBeforeQuery = req.query["notBefore"] as string;
      const notBefore = notBeforeQuery ? parseInt(notBeforeQuery) : undefined;
      const namespace = req.params["namespace"];
      res.json(
        await this.getLineChartData(
          namespace && decodeURIComponent(namespace),
          notBefore
        )
      );
    });
    this.addRoute("get", "/statistics/:namespace?", async (req, res) => {
      const notBeforeQuery = req.query["notBefore"] as string;
      const notBefore = notBeforeQuery ? parseInt(notBeforeQuery) : undefined;
      const namespace = req.params["namespace"];
      res.json(
        await this.getServiceHistoricalStatistics(
          namespace && decodeURIComponent(namespace),
          notBefore
        )
      );
    });
    this.addRoute("get", "/cohesion/:namespace?", async (req, res) => {
      const namespace = req.params["namespace"];
      res.json(
        this.getServiceCohesion(namespace && decodeURIComponent(namespace))
      );
    });
    this.addRoute("get", "/instability/:namespace?", async (req, res) => {
      const namespace = req.params["namespace"];
      res.json(
        this.getServiceInstability(namespace && decodeURIComponent(namespace))
      );
    });
    this.addRoute("get", "/coupling/:namespace?", async (req, res) => {
      const namespace = req.params["namespace"];
      res.json(
        this.getServiceCoupling(namespace && decodeURIComponent(namespace))
      );
    });
    this.addRoute("get", "/taggedCohesion/:namespace?", async (req, res) => {
      const namespace = req.params["namespace"];
      const { tag } = req.query as { tag: string };
      if (tag){
        res.json(
          this.getTaggedServiceCohesion(tag,namespace && decodeURIComponent(namespace))
        );
      }else{
        //default return latest version data
        res.json(
          this.getServiceCohesion(namespace && decodeURIComponent(namespace))
        );
      }

    });
    this.addRoute("get", "/taggedInstability/:namespace?", async (req, res) => {
      const namespace = req.params["namespace"];
      const { tag } = req.query as { tag: string };
      if (tag){
        res.json(
          this.getTaggedServiceInstability(tag,namespace && decodeURIComponent(namespace))
        );
      }else{
        //default return latest version data
        res.json(
          this.getServiceInstability(namespace && decodeURIComponent(namespace))
        );
      }
    });
    this.addRoute("get", "/taggedCoupling/:namespace?", async (req, res) => {
      const namespace = req.params["namespace"];
      const { tag } = req.query as { tag: string };
      if (tag){
        res.json(
          this.getTaggedServiceCoupling(tag,namespace && decodeURIComponent(namespace))
        );
      }else{
        //default return latest version data
        res.json(
          this.getServiceCoupling(namespace && decodeURIComponent(namespace))
        );
      }

    });


    this.addRoute("get", "/requests/:uniqueName", async (req, res) => {
      const notBeforeQuery = req.query["notBefore"] as string;
      const notBefore = notBeforeQuery ? parseInt(notBeforeQuery) : undefined;
      res.json(
        await this.getRequestInfoChartData(
          decodeURIComponent(req.params["uniqueName"]),
          req.query["ignoreServiceVersion"] === "true",
          notBefore
        )
      );
    });


  }

  async getDependencyGraph(namespace?: string) {
    const rootNode: TGraphData = {
      nodes: [
        {
          id: "null",
          group: "null",
          name: "external requests",
          dependencies: [],
          linkInBetween: [],
          usageStatus: "Active"
        }
      ],
      links: []
    }
    return DataCache.getInstance()
      .get<CLabeledEndpointDependencies>("LabeledEndpointDependencies")
      .getData(namespace)
      ?.toGraphData() || rootNode;
  }

  async getServiceDependencyGraph(namespace?: string) {
    const endpointGraph = await this.getDependencyGraph(namespace);
    if (!endpointGraph) return endpointGraph;
    return this.toServiceDependencyGraph(endpointGraph);
  }

  async getTaggedDependencyGraph(tag?: string) {
    const diffData = DataCache.getInstance()
      .get<CTaggedDiffData>("TaggedDiffDatas")
      .getDataByTag(tag);
    
    return diffData?.graphData || this.getDependencyGraph();

  }

  async getTaggedServiceDependencyGraph(tag?: string) {
    const endpointGraph = await this.getTaggedDependencyGraph(tag);
    if (!endpointGraph) return endpointGraph;
    return this.toServiceDependencyGraph(endpointGraph);
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

  async getDirectServiceChord(namespace?: string) {
    const dependencies = DataCache.getInstance()
      .get<CLabeledEndpointDependencies>("LabeledEndpointDependencies")
      .getData(namespace);
    if (!dependencies) return { nodes: [], links: [] };
    const dep = dependencies.toJSON();
    return new EndpointDependencies(
      dep.map((ep) => {
        const dependingOn = ep.dependingOn.filter((d) => d.distance === 1);
        return {
          ...ep,
          dependingOn,
        };
      })
    ).toChordData();
  }

  async getInDirectServiceChord(namespace?: string) {
    return (
      DataCache.getInstance()
        .get<CLabeledEndpointDependencies>("LabeledEndpointDependencies")
        .getData(namespace)
        ?.toChordData() || { nodes: [], links: [] }
    );
  }

  async getLineChartData(
    namespace?: string,
    notBefore?: number
  ): Promise<TLineChartData> {
    const historicalData =
      await ServiceUtils.getInstance().getRealtimeHistoricalData(
        namespace,
        notBefore
      );

    if (historicalData.length === 0) {
      return {
        dates: [],
        metrics: [],
        services: [],
      };
    }

    historicalData.sort((a, b) => a.date.getTime() - b.date.getTime());
    const dates: number[] = [];
    const metrics: [number, number, number, number, number, number][][] = [];
    const services = historicalData[0].services
      .sort((a, b) => a.uniqueServiceName.localeCompare(b.uniqueServiceName))
      .map((s) => `${s.service}.${s.namespace} (${s.version})`);

    historicalData.forEach((h) => {
      dates.push(h.date.getTime());
      h.services.sort((a, b) =>
        a.uniqueServiceName.localeCompare(b.uniqueServiceName)
      );
      const metric = h.services.map(
        (s): [number, number, number, number, number, number] => {
          const requestErrors = s.requestErrors;
          const serverErrors = s.serverErrors;
          const requests = s.requests - requestErrors - serverErrors;
          
          return [
            requests,
            requestErrors,
            serverErrors,
            s.latencyCV,
            s.latencyMean,
            s.risk || 0,
          ];
        }
      );
      metrics.push(metric);
    });

    return {
      dates,
      services,
      metrics,
    };
  }
  
  async getServiceHistoricalStatistics(
    namespace?: string,
    notBefore?: number
  ): Promise<TServiceStatistics[]>  {
    const historicalData =
    await ServiceUtils.getInstance().getRealtimeHistoricalData(
      namespace,
      notBefore
    );
    if (historicalData.length === 0) {
      return []
    }
    var servicesStatisticsDict: Record<string, {
      name: string,
      totalLatencyMean:number,
      totalRequests:number,
      totalServerError:number,
      totalRequestError:number,
      divBase:number,
    }> = {}
    historicalData.forEach((h) => {
      h.services.forEach((si) => {
        if (!(si.uniqueServiceName in servicesStatisticsDict)){
          const [service, namespace, version] = si.uniqueServiceName.split("\t");
          servicesStatisticsDict[si.uniqueServiceName] = {
            name: `${service}.${namespace} (${version})`,
            totalLatencyMean:0,
            totalRequests:0,
            totalServerError:0,
            totalRequestError:0,
            divBase:0
          }
        }
        if(typeof(si.latencyMean) === "number" && isFinite(si.latencyMean)){
          servicesStatisticsDict[si.uniqueServiceName].totalLatencyMean += si.latencyMean;
          servicesStatisticsDict[si.uniqueServiceName].divBase += 1;
        }
        servicesStatisticsDict[si.uniqueServiceName].totalRequests += si.requests;
        servicesStatisticsDict[si.uniqueServiceName].totalRequestError += si.requestErrors;
        servicesStatisticsDict[si.uniqueServiceName].totalServerError += si.serverErrors;
      });
    });
    const servicesStatistics = Object.entries(servicesStatisticsDict)
    .filter(([_, vals]) => vals.divBase !== 0)
    .map(([key, vals]) => ({
        uniqueServiceName:key,
        name:vals.name,
        latencyMean: vals.totalLatencyMean / vals.divBase || 0,
        serverErrorRate: vals.totalServerError / vals.totalRequests || 0,
        requestErrorsRate: vals.totalRequestError / vals.totalRequests || 0,
      })
    );
    return servicesStatistics;
  }

  getServiceCohesion(namespace?: string) {
    const dependencies = DataCache.getInstance()
      .get<CLabeledEndpointDependencies>("LabeledEndpointDependencies")
      .getData(namespace);
    if (!dependencies) return [];

    const dataType = DataCache.getInstance()
      .get<CEndpointDataType>("EndpointDataType")
      .getData()
      .map((e) => {
        const raw = e.toJSON();
        raw.labelName =
          DataCache.getInstance()
            .get<CLabelMapping>("LabelMapping")
            .getData()
            ?.get(raw.uniqueEndpointName) || raw.uniqueEndpointName;
        return new EndpointDataType(raw);
      });

    const dataCohesion = EndpointDataType.GetServiceCohesion(dataType).reduce(
      (map, d) => map.set(d.uniqueServiceName, d),
      new Map<string, TServiceCohesion>()
    );

    const usageCohesions = dependencies.toServiceEndpointCohesion();

    const results = usageCohesions.map(
      (u): TTotalServiceInterfaceCohesion | null => {
        const uniqueServiceName = u.uniqueServiceName;
        const [service, namespace, version] = uniqueServiceName.split("\t");
        const dCohesion = dataCohesion.get(uniqueServiceName);
        if (!dCohesion) {
          Logger.error(
            `Mismatching service cohesion information with unique service: ${uniqueServiceName}`
          );
          return null;
        }
        return {
          uniqueServiceName,
          name: `${service}.${namespace} (${version})`,
          dataCohesion: dCohesion.cohesiveness,
          usageCohesion: u.endpointUsageCohesion,
          totalInterfaceCohesion:
            (dCohesion.cohesiveness + u.endpointUsageCohesion) / 2,
          endpointCohesion: dCohesion.endpointCohesion,
          totalEndpoints: u.totalEndpoints,
          consumers: u.consumers,
        };
      }
    );
    return results
      .filter((r) => !!r)
      .sort((a, b) => a!.name.localeCompare(b!.name));
  }

  getServiceInstability(namespace?: string) {
    const dependencies = DataCache.getInstance()
      .get<CLabeledEndpointDependencies>("LabeledEndpointDependencies")
      .getData(namespace);
    if (!dependencies) return [];
    return dependencies
      .toServiceInstability()
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  getServiceCoupling(namespace?: string) {
    const dependencies = DataCache.getInstance()
      .get<CLabeledEndpointDependencies>("LabeledEndpointDependencies")
      .getData(namespace);
    if (!dependencies) return [];
    return dependencies
      .toServiceCoupling()
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  
  getTaggedServiceCohesion(tag?: string, namespace?: string) {
    const diffData = DataCache.getInstance()
      .get<CTaggedDiffData>("TaggedDiffDatas")
      .getDataByTag(tag);

    return diffData?.cohesionData || this.getServiceCohesion(namespace);
  }

  getTaggedServiceInstability(tag?: string, namespace?: string) {
    const diffData = DataCache.getInstance()
      .get<CTaggedDiffData>("TaggedDiffDatas")
      .getDataByTag(tag);

    return diffData?.instabilityData || this.getServiceInstability(namespace);
  }

  getTaggedServiceCoupling(tag?: string, namespace?: string) {
    const diffData = DataCache.getInstance()
    .get<CTaggedDiffData>("TaggedDiffDatas")
    .getDataByTag(tag);

    return diffData?.couplingData || this.getServiceCoupling(namespace);
  }


  async getRequestInfoChartData(
    uniqueName: string,
    ignoreServiceVersion = false,
    notBefore: number = 86400000
  ) {
    const [service, namespace, version, method, labelName] =
      uniqueName.split("\t");
    const isEndpoint = method && labelName;
    const uniqueServiceName = `${service}\t${namespace}\t${version}`;
    const historicalData =
      await ServiceUtils.getInstance().getRealtimeHistoricalData(
        undefined,
        notBefore
      );
    const filtered = historicalData
      .flatMap((h) => h.services)
      .filter((s) => {
        if (ignoreServiceVersion) {
          return s.service === service && s.namespace === namespace;
        }
        return s.uniqueServiceName === uniqueServiceName;
      });

    const chartData: TRequestInfoChartData = {
      time: [],
      requests: [],
      clientErrors: [],
      serverErrors: [],
      latencyCV: [],
      risks: isEndpoint ? undefined : [],
      totalRequestCount: 0,
      totalClientErrors: 0,
      totalServerErrors: 0,
    };

    filtered.sort((a, b) => a.date.getTime() - b.date.getTime());
    const source = isEndpoint
      ? filtered.map((s) => {
          const endpoint = s.endpoints.find(
            (e) => e.labelName === labelName && e.method === method
          );
          return {
            date: s.date,
            risk: undefined,
            ...endpoint,
          };
        })
      : filtered;

    source.forEach((s) => {
      const clientError = s.requestErrors || 0;
      const serverError = s.serverErrors || 0;
      const request = (s.requests || 0) - serverError - clientError;

      chartData.time.push(s.date.getTime());
      chartData.requests.push(request);
      chartData.clientErrors.push(clientError);
      chartData.serverErrors.push(serverError);
      chartData.latencyCV.push(s.latencyCV || 0);
      if (!isEndpoint) {
        chartData.risks!.push(s.risk || 0);
      }

      chartData.totalRequestCount += request;
      chartData.totalClientErrors += clientError;
      chartData.totalServerErrors += serverError;
    });

    return chartData;
  }


}
