import { THistoricalData } from "../../entities/THistoricalData";
import { HistoricalData } from "../HistoricalData";
import { Cacheable } from "./Cacheable";

export class CSimulatedHistoricalData extends Cacheable<HistoricalData[]> {
  static readonly uniqueName = "SimulatedHistoricalData";
  constructor(initData?: THistoricalData[]) {
    super(
      "SimulatedHistoricalData",
      initData ? initData.map(item => new HistoricalData(item)) : undefined
    );
    console.log("HistoricalData長度", initData ? initData.length : 0)
    this.setInit(async () => { });
    this.setSync(async () => { });
  }

  setData(update: HistoricalData[]): void {
    super.setData(update);
  }

  getData(): HistoricalData[] {
    const data = super.getData() || [];
    return data;
  }

  insertOneData(one: HistoricalData): void {
    const currentData = this.getData();
    this.setData([...currentData, one]);
  }


  
}
