import { TaggedDiffDataModel } from "../../entities/schema/TaggedDiffData";
import { TTaggedDiffData} from "../../entities/TTaggedDiffData";
import MongoOperator from "../../services/MongoOperator";
import Logger from "../../utils/Logger";
import { Cacheable } from "./Cacheable";

export class CTaggedDiffData extends Cacheable<TTaggedDiffData[]> {
  static readonly uniqueName = "TaggedDiffDatas";
  constructor(initData?: TTaggedDiffData[]) {
    super("TaggedDiffDatas", initData);
    this.setInit(async () => {
      this.setData(
        await MongoOperator.getInstance().findAll(TaggedDiffDataModel)
      );
    });
    this.setSync(async () => {
      const tagged = this.getData();
      const toDelete = await MongoOperator.getInstance().findAll(
        TaggedDiffDataModel
      );

      try {
        await MongoOperator.getInstance().insertMany(
          tagged,
          TaggedDiffDataModel
        );
        await MongoOperator.getInstance().delete(
          toDelete.map((t) => t._id!),
          TaggedDiffDataModel
        );
      } catch (ex) {
        Logger.error(`Error saving ${this.name}, skipping.`);
        Logger.verbose("", ex);
      }
    });
  }

  getData(tag?: string): TTaggedDiffData[] {
    const data = super.getData();
    if (!data) return [];
    if (!tag) return data;
    return data.filter((d) => d.tag === tag);
  }

  add(taggedData: TTaggedDiffData) {
    const existing = this.getData(taggedData.tag);
    if (existing.length > 0) {
      return;
    } else {
      taggedData.time = Date.now();
      const data = this.getData();
      this.setData(data.concat(taggedData));
    }
  }

  delete(tag: string) {
    const data = this.getData();
    this.setData(
      data.filter((d) => d.tag !== tag)
    );
  }
}
