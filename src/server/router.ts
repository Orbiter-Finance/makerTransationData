// import { isEmpty } from 'orbiter-chaincore/src/utils/core';
// import { Context } from './../context';
import * as controllers from "./controllers/index";
import Router from "koa-router";
const router = new Router();
router.get("/", ctx => {
  ctx.body = "welcome";
});
router.get("/getDelayTransferProof", controllers.getDelayTransferProof);
router.get(
  "/getUncollectedPaymentProof",
  controllers.getUncollectedPaymentProof,
);
// router.get('/getUncollectedPaymentProof', (ctx) => {
//   // const spvCtx = ctx.state['spvCtx'] as Context;
//   const query = ctx.request.query;
//   if (isEmpty(query) || isEmpty(query['chainId'] || isEmpty(query['txid']))) {
//     return ctx.body = { errno: 1000, errmsg: "Missing parameter chainId or txid" };
//   }
//   ctx.body = 'welcome';
// });
export default router;
