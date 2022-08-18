import { Watch } from "./src/service/watch";
import "dotenv/config";
import { convertMarketListToFile } from "./src/utils";
import { makerList, makerListHistory } from "./src/maker";
import { SPV } from "./src/service/spv";
import { Context } from "./src/context";
import { TCPInject } from "./src/service/tcpInject";
export class Application {
  public ctx: Context = new Context();
  async bootstrap() {
    this.ctx.makerConfigs = await convertMarketListToFile(
      makerList,
      this.ctx.config.L1L2Mapping,
    );
    const makerConfigsHistory = await convertMarketListToFile(
      makerListHistory,
      this.ctx.config.L1L2Mapping,
    );
    this.ctx.makerConfigs.push(...makerConfigsHistory);
    new TCPInject(this.ctx);
    const watch = new Watch(this.ctx);
    watch.start();
    if (process.argv.includes("--spv")) {
      const spvService = new SPV(this.ctx, 1);
      spvService
        .initTree()
        .then(() => {
          spvService.checkTree();
        })
        .catch(error => {
          this.ctx.logger.error("SPV init tree error:", error);
        });
    }
  }
}
const app = new Application();
app.bootstrap().catch(error => {
  console.error("start app error", error);
});
process.on("uncaughtException", (err: Error) => {
  console.error("Global Uncaught exception:", err);
});
process.on("unhandledRejection", (err: Error) => {
  console.error(
    "There are failed functions where promise is not captured：",
    err,
  );
});
