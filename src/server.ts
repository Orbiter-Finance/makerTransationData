import { Context } from "./context";
import Koa2 from "koa";
import router from "./server/router";
import fs from "fs";
import path from "path";
import { getFormatDate } from "./utils/oldUtils";
export function createServer(spvCtx: Context) {
  const app = new Koa2();
  app.use(async (ctx, next) => {
    ctx.state.spvCtx = spvCtx;
    try {
      await next();
    } catch (error: any) {
      console.error(error);
      return (ctx.body = {
        errno: 1000,
        errmsg: error["message"],
      });
    }
  });
  app.use(router.routes());
  const port = process.env["PORT"] || 3000;
  app.listen(port, () => {
    console.log(`Api Service Start: http://127.0.0.1:${port}`);
    fs.writeFileSync(
      path.join(__dirname, "../bootInfo.txt"),
      `Time: ${getFormatDate(
        new Date().valueOf(),
      )}\nService: http://127.0.0.1:${port}`,
    );
  });
  return app;
}
