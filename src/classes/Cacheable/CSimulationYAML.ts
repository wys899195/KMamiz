
import { TSimulationYAML } from "../../entities/TSimulationYAML";
// import Logger from "../../utils/Logger";
import { Cacheable } from "./Cacheable";

export class CSimulationYAML extends Cacheable<TSimulationYAML> {
  static readonly uniqueName = "SimulationYAML";
  constructor(initData?: TSimulationYAML) {
    super("SimulationYamlData", initData);
    this.setInit(async () => {});
    this.setSync(async () => {});
  }

}
