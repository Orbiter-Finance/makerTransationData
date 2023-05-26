import "dotenv/config";
import { Watch } from "./src/service/watch";
import { Context } from "./src/context";
import { logRecord } from "./src/utils/logger";
import utc from "dayjs/plugin/utc";
import dayjs from "dayjs";
dayjs.extend(utc);
export class Application {
  public ctx: Context = new Context();
  async bootstrap() {
    await this.ctx.init();
    await this.ctx.mq.connect();
    // process
    const watch = new Watch(this.ctx);
    await watch.start();
  }
}
const app = new Application();
app.bootstrap().catch(error => {
  logRecord(app.ctx, "start app error",false, error)
});
process.on("uncaughtException", (err: Error) => {
  logRecord(app.ctx, "Global Uncaught exception:",false, err);
});
process.on("unhandledRejection", (err: Error) => {
  logRecord(
    app.ctx,
    "There are failed functions where promise is not captured：",
    false,
    err,
    );
});
