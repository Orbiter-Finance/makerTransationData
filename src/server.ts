import { Context } from "./context";
import Koa2 from "koa";
import router from "./server/router";
export function createServer(spvCtx: Context) {
  const app = new Koa2();
  app.use(async (ctx, next) => {
    ctx.state.spvCtx = spvCtx;
    await next();
  });
  app.use(router.routes());
  const port = process.env["PORT"] || 3000;
  app.listen(port, () => {
    console.log(`Api Service Start: http://127.0.0.1:${port}`);
  });
  return app;
}
