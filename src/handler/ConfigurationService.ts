import IRequestHandler from "../entities/TRequestHandler";
import GlobalSettings from "../GlobalSettings";
import Logger from "../../src/utils/Logger";


export default class ConfigurationService extends IRequestHandler {
  constructor() {
    super("configuration");
    this.addRoute(
      "get",
      "/config",
      async (_, res) => {
        Logger.info("GlobalSettings.SimulatorMode = ",GlobalSettings.SimulatorMode)
        res.json({ 
          SimulatorMode: GlobalSettings.SimulatorMode
        });
      }
    );
  }


}
