import IRequestHandler from "../entities/TRequestHandler";
import DataCache from "../services/DataCache";
import { TEndpointDataType, TEndpointDataSchema } from "../entities/TEndpointDataType";
import { TEndpointLabel } from "../entities/TEndpointLabel";
import { TTaggedInterface } from "../entities/TTaggedInterface";
import { TServiceDisplayInfo } from "../entities/TServiceDisplayInfo";
import { TEndpointDependency } from "../entities/TEndpointDependency";
import { CLabelMapping } from "../classes/Cacheable/CLabelMapping";
import { CUserDefinedLabel } from "../classes/Cacheable/CUserDefinedLabel";
import { CTaggedInterfaces } from "../classes/Cacheable/CTaggedInterfaces";
import { CEndpointDataType } from "../classes/Cacheable/CEndpointDataType";
import { CLabeledEndpointDependencies } from "../classes/Cacheable/CLabeledEndpointDependencies";
import ServiceUtils from "../services/ServiceUtils";
import GlobalSettings from "../GlobalSettings";
import { tgz } from "compressing";
import Logger from "../utils/Logger";
import DispatchStorage from "../services/DispatchStorage";
import ServiceOperator from "../services/ServiceOperator";
import ImportExportHandler from "../services/ImportExportHandler";

export default class DataService extends IRequestHandler {
  constructor() {
    super("data");
    this.addRoute("get", "/aggregate/:namespace?", async (req, res) => {
      const notBeforeQuery = req.query["notBefore"] as string;
      const notBefore = notBeforeQuery ? parseInt(notBeforeQuery) : undefined;
      const filter = decodeURIComponent(req.query["filter"] as string);
      const namespace = req.params["namespace"];
      res.json(
        await this.getAggregatedData(
          namespace && decodeURIComponent(namespace),
          notBefore,
          filter
        )
      );
    });
    this.addRoute("get", "/serviceDisplayInfo", async (req, res) => {
      const filter = decodeURIComponent(req.query["filter"] as string);
      res.json(
        this.getServiceDisplayInfo(
          filter
        )
      );
    });
    this.addRoute("get", "/history/:namespace?", async (req, res) => {
      const notBeforeQuery = req.query["notBefore"] as string;
      const notBefore = notBeforeQuery ? parseInt(notBeforeQuery) : undefined;
      const namespace = req.params["namespace"];
      res.json(
        await this.getHistoricalData(
          namespace && decodeURIComponent(namespace),
          notBefore
        )
      );
    });
    this.addRoute("get", "/datatype/:uniqueLabelName", async (req, res) => {
      const labelName = decodeURIComponent(req.params["uniqueLabelName"]);
      if (!labelName) res.sendStatus(400);
      else {
        const result = await this.getEndpointDataType(labelName);
        if (result) res.json(result);
        else res.sendStatus(404);
      }
    });

    this.registerLabelEndpoints();
    this.registerInterfaceEndpoints();

    this.addRoute("post", "/sync", async (_, res) => {
      await DispatchStorage.getInstance().syncAll();
      res.sendStatus(200);
    });
    this.addRoute("get", "/export", async (_, res) => {
      res.contentType("application/tar+gzip");
      const json = await ImportExportHandler.getInstance().exportData();
      const stream = new tgz.Stream();
      stream.addEntry(Buffer.from(json, "utf8"), {
        relativePath: "KMamiz.cache.json",
      });
      stream.on("end", () => res.end());
      stream.pipe(res);
    });

    if (GlobalSettings.SimulatorMode) {
      this.addRoute("post", "/cloneDataFromProductionService", async (_, res) => {
        const result = await ImportExportHandler.getInstance().cloneDataFromProductionService();
        if (result.isSuccess) {
          res.status(201).json({ message: 'ok' });
        } else {
          res.status(500).json({ message: `Internal Server Error: ${result.message}` });
        }
      });
    }


    if (GlobalSettings.EnableTestingEndpoints) {
      this.registerTestingEndpoints();
    }
  }

  private registerLabelEndpoints() {
    this.addRoute("get", "/label", async (_, res) => {
      res.json(this.getLabelMap());
    });
    this.addRoute("get", "/label/user", async (_, res) => {
      const userLabels = this.getUserDefinedLabel();
      if (userLabels) return res.json(userLabels);
      res.sendStatus(404);
    });
    this.addRoute("post", "/label/user", async (req, res) => {
      const labels = req.body as TEndpointLabel;
      if (!labels?.labels) return res.sendStatus(400);
      this.updateUserDefinedLabel(labels);
      res.sendStatus(201);
    });
    this.addRoute("delete", "/label/user", async (req, res) => {
      const label = req.body as {
        uniqueServiceName: string;
        method: string;
        label: string;
      };
      if (!label) return res.sendStatus(400);
      this.deleteUserDefinedLabel(
        label.uniqueServiceName,
        label.method,
        label.label
      );
      res.sendStatus(204);
    });
  }

  private registerInterfaceEndpoints() {
    this.addRoute("get", "/interface", async (req, res) => {
      const { uniqueLabelName } = req.query as {
        uniqueLabelName: string;
      };
      if (!uniqueLabelName) return res.sendStatus(400);

      const result = DataCache.getInstance()
        .get<CTaggedInterfaces>("TaggedInterfaces")
        .getData(decodeURIComponent(uniqueLabelName));

      res.json(result);
    });
    this.addRoute("post", "/interface", async (req, res) => {
      const tagged = req.body as TTaggedInterface;
      if (!tagged) return res.sendStatus(400);

      DataCache.getInstance()
        .get<CTaggedInterfaces>("TaggedInterfaces")
        .add(tagged);

      res.sendStatus(201);
    });
    this.addRoute("delete", "/interface", async (req, res) => {
      const { uniqueLabelName, userLabel } = req.body as {
        uniqueLabelName: string;
        userLabel: string;
      };
      if (!uniqueLabelName || !userLabel) return res.sendStatus(400);
      const result = this.deleteTaggedInterface(uniqueLabelName, userLabel);
      res.sendStatus(result ? 204 : 400);
    });
  }

  private registerTestingEndpoints() {
    this.addRoute("delete", "/clear", async (_, res) => {
      await ImportExportHandler.getInstance().clearData();
      res.sendStatus(200);
    });
    this.addRoute("post", "/import", async (req, res) => {
      try {
        const chunks: any[] = [];
        const stream = new tgz.UncompressStream();
        stream.on("entry", (_, s) => {
          s.on("data", (chunk: any) => chunks.push(chunk));
          s.on("end", async () => {
            const caches = JSON.parse(
              Buffer.concat(chunks).toString("utf8")
            ) as [string, any][];
            const result = await ImportExportHandler.getInstance().importData(
              caches
            );
            res.sendStatus(result ? 201 : 400);
          });
        });
        req.pipe(stream);
      } catch (err) {
        Logger.error("Error parsing import");
        Logger.plain.verbose("", err);
        res.sendStatus(400);
      }
    });
    this.addRoute("post", "/aggregate", async (_, res) => {
      await ServiceOperator.getInstance().createHistoricalAndAggregatedData();
      res.sendStatus(204);
    });
  }

  async getAggregatedData(
    namespace?: string,
    notBefore?: number,
    filter?: string
  ) {
    const data = await ServiceUtils.getInstance().getRealtimeAggregatedData(
      namespace,
      notBefore
    );
    if (!filter || !data) return data;
    return {
      ...data,
      services: data.services.filter((d) =>
        d.uniqueServiceName.startsWith(filter)
      ),
    };
  }

  getServiceDisplayInfo(
    filter?: string,
  ) {
    const existingLabeledDep: TEndpointDependency[] = DataCache.getInstance()
      .get<CLabeledEndpointDependencies>("LabeledEndpointDependencies")
      .getData()?.toJSON() || [];
    if (existingLabeledDep.length === 0) {
      return [];
    }

    const serviceMap = new Map<string, {
      uniqueServiceName: string;
      service: string;
      namespace: string;
      version: string;
      endpointSet: Set<string>;
    }>();


    for (const dep of existingLabeledDep) {
      const ep = dep.endpoint;

      const key = ep.uniqueServiceName;
      const labelOrPath = ep.labelName || ep.path;
      const endpointKey = `${ep.version}\t${ep.method}\t${labelOrPath}`;

      if (!serviceMap.has(key)) {
        serviceMap.set(key, {
          uniqueServiceName: ep.uniqueServiceName,
          service: ep.service,
          namespace: ep.namespace,
          version: ep.version,
          endpointSet: new Set(),
        });
      }

      serviceMap.get(key)!.endpointSet.add(endpointKey);
    }

    const result: TServiceDisplayInfo[] = [];
    for (const entry of serviceMap.values()) {
      result.push({
        uniqueServiceName: entry.uniqueServiceName,
        service: entry.service,
        namespace: entry.namespace,
        version: entry.version,
        endpointCount: entry.endpointSet.size,
      });
    }
    if (filter) {
      return result.filter((d) => d.uniqueServiceName.startsWith(filter));
    }

    return result;
  }


  async getHistoricalData(namespace?: string, notBefore?: number) {
    return await ServiceUtils.getInstance().getRealtimeHistoricalData(
      namespace,
      notBefore
    );
  }

  async getEndpointDataType(
    uniqueLabelName: string
  ): Promise<TEndpointDataType | null> {
    const [service, namespace, version, method, label] =
      uniqueLabelName.split("\t");
    if (!method || !label) return null;

    const uniqueServiceName = `${service}\t${namespace}\t${version}`;

    const datatype = DataCache.getInstance()
      .get<CLabelMapping>("LabelMapping")
      .getEndpointDataTypesByLabel(
        label,
        uniqueServiceName,
        method,
        DataCache.getInstance()
          .get<CEndpointDataType>("EndpointDataType")
          .getData() || []
      );

    if (datatype.length === 0) return null;
    const merged = datatype.reduce((prev, curr) => prev.mergeSchemaWith(curr));
    return { ...merged.toJSON(), labelName: label };
  }

  async getEndpointDataTypesMap(uniqueLabelNames: string[]): Promise<Record<string, TEndpointDataType>> {
    const endpointDataTypeMap: Record<string, TEndpointDataType> = {};
    for (const uniqueLabelName of uniqueLabelNames) {
      const dataType = await this.getEndpointDataType(uniqueLabelName);
      if (dataType) {
        // Deep copy dataType to avoid modifying the original object in cache
        const clonedDataType: TEndpointDataType = JSON.parse(JSON.stringify(dataType));

        // After merging schemas, keep only the most recent schema (by time) for each unique status
        const latestSchemaMap: Record<string, TEndpointDataSchema> = {};

        for (const schema of clonedDataType.schemas) {
          const existing = latestSchemaMap[schema.status];
          if (!existing || new Date(schema.time).getTime() > new Date(existing.time).getTime()) {
            latestSchemaMap[schema.status] = schema;
          }
        }

        // Remove requestSample and responseSample fields as they are not needed on the frontend
        for (const schema of Object.values(latestSchemaMap)) {
          delete schema.requestSample;
          delete schema.responseSample;
        }

        clonedDataType.schemas = Object.values(latestSchemaMap);
        endpointDataTypeMap[uniqueLabelName] = clonedDataType;
      } else {
        console.error("can not found datatype by name:", uniqueLabelName)
      }
    }
    return endpointDataTypeMap;
  }

  getLabelMap() {
    const entries = DataCache.getInstance()
      .get<CLabelMapping>("LabelMapping")
      .getData()
      ?.entries();
    return entries ? [...entries] : [];
  }

  getUserDefinedLabel() {
    return DataCache.getInstance()
      .get<CUserDefinedLabel>("UserDefinedLabel")
      .getData();
  }

  updateUserDefinedLabel(label: TEndpointLabel) {
    DataCache.getInstance()
      .get<CUserDefinedLabel>("UserDefinedLabel")
      .update(label);
    ServiceUtils.getInstance().updateLabel();
  }

  deleteUserDefinedLabel(
    uniqueServiceName: string,
    method: string,
    label: string
  ) {
    DataCache.getInstance()
      .get<CUserDefinedLabel>("UserDefinedLabel")
      .delete(label, uniqueServiceName, method);
    ServiceUtils.getInstance().updateLabel();
  }

  deleteTaggedInterface(uniqueLabelName: string, userLabel: string) {
    const existing = DataCache.getInstance()
      .get<CTaggedInterfaces>("TaggedInterfaces")
      .getData(uniqueLabelName)
      .find((i) => i.userLabel === userLabel);
    if (!existing || existing.boundToSwagger) return false;

    DataCache.getInstance()
      .get<CTaggedInterfaces>("TaggedInterfaces")
      .delete(uniqueLabelName, userLabel);
    return true;
  }
}
