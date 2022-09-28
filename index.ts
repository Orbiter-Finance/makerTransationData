import { Watch } from "./src/service/watch";
import "dotenv/config";
import { SPV } from "./src/service/spv";
import { Context } from "./src/context";
import { createServer } from "./src/server";
export class Application {
  public ctx: Context = new Context();
  async bootstrap() {
    await this.ctx.init();
    createServer(this.ctx);
    const watch = new Watch(this.ctx);
    watch.start();
    if (this.ctx.isSpv) {
      const spvService = new SPV(this.ctx, Number(process.env["SPV_CHAIN"]));
      spvService.start().catch(error => {
        this.ctx.logger.error("SPV init tree error:", error);
      });
    }
    // watch
    //   .readDBMatch("2022-08-25 00:47:33", "2022-08-31 00:47:33")
    //   .then(result => {
    //     this.ctx.logger.info(`readDBMatch end`, result);
    //   })
    //   .catch((error: any) => {
    //     this.ctx.logger.error(`readDBMatch error`, error);
    //   });
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
