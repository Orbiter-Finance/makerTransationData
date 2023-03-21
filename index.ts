import { Watch } from "./src/service/watch";
import "dotenv/config";
import { SPV } from "./src/service/spv";
import { Context } from "./src/context";
import { createServer } from "./src/server";
import utc from "dayjs/plugin/utc";
import dayjs from "dayjs";
dayjs.extend(utc);
export class Application {
  public ctx: Context = new Context();
  async bootstrap() {
    await this.ctx.init();
    createServer(this.ctx);
    const watch = new Watch(this.ctx);
    await watch.start();
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
