import { SPV } from "./../../service/spv";
import { isEmpty } from "orbiter-chaincore/src/utils/core";
import { Context } from "../../context";
import Router from "koa-router";
import dayjs from "dayjs";
import { Op } from "sequelize";

export async function getTransferTransactions(ctx: Router.RouterContext) {
  const queryType = ctx.params["type"] || "all";
  const spvCtx = ctx.state["spvCtx"] as Context;
  const query = ctx.request.query;
  const page = Number(query["page"]) || 1;
  const pageSize = Number(query["pageSize"]) || 10;
  const filterAddress = query["replyAccount"];
  const where: any = {
    replyAccount: filterAddress,
  };
  if (isEmpty(query) || isEmpty(query["replyAccount"])) {
    return (ctx.body = {
      errno: 1000,
      errmsg: "Missing parameter",
    });
  }
  if (query["status"]) {
    where["status"] = Number(query["status"]);
  }
  switch (queryType) {
    case "in":
      where["to"] = filterAddress;
      break;
    case "out":
      where["from"] = filterAddress;
      break;
    case "appealable":
      where["from"] = filterAddress;
      where["side"] = 0;
      where["status"] = 1;
      where["timestamp"] = {
        [Op.lte]: dayjs()
          .subtract(spvCtx.config.makerTransferTimeout, "m")
          .toDate(),
      };
      break;
  }
  const result: any =
    (await spvCtx.models.transaction.findAndCountAll({
      raw: true,
      attributes: [
        "hash",
        "from",
        "to",
        "chainId",
        "symbol",
        "value",
        "status",
        "nonce",
        "timestamp",
        "makerId",
        "lpId",
        "tokenAddress",
        "extra",
      ],
      limit: pageSize,
      offset: pageSize * (page - 1),
      where,
    })) || {};
  for (const row of result.rows) {
    row.ebcId = 1;
    row.expectValue = row.value;
    delete row.extra;
  }
  result["page"] = page;
  result["pageSize"] = pageSize;
  ctx.body = {
    errno: 0,
    data: result,
  };
}
export async function getDelayTransferProof(ctx: Router.RouterContext) {
  const query = ctx.request.query;
  if (isEmpty(query) || isEmpty(query["chainId"]) || isEmpty(query["txid"])) {
    return (ctx.body = {
      errno: 1000,
      errmsg: "Missing parameter chainId or txid",
    });
  }
  const spvCtx = ctx.state["spvCtx"] as Context;
  const tx = await spvCtx.models.transaction.findOne({
    raw: true,
    where: {
      chainId: Number(query["chainId"]),
      side: 1,
      hash: query["txid"],
    },
  });
  if (isEmpty(tx) || !tx) {
    return (ctx.body = {
      errno: 1000,
      data: tx,
      errmsg: `${query["txid"]} Tx Not Found`,
    });
  }
  const extra: any = tx.extra || {};
  const ebcid = extra.ebcId || 0;
  const respAmount = tx.value;
  // respAmount = tx.value
  const hash = SPV.getTreeTxHash(
    tx.chainId,
    tx.hash,
    tx.from,
    tx.to,
    tx.nonce,
    tx.value,
    tx.tokenAddress,
    dayjs(tx.timestamp).unix(),
    respAmount,
    ebcid,
  );
  const delayedPayment = SPV.tree[String(query["chainId"])].delayedPayment;
  if (!delayedPayment) {
    return (ctx.body = {
      errno: 0,
      data: [],
      errmsg: "non-existent",
    });
  }
  const proof = delayedPayment.getHexProof(Buffer.from(hash));
  ctx.body = {
    errno: 0,
    data: proof,
    errmsg: "",
  };
}

export async function getUncollectedPaymentProof(ctx: Router.RouterContext) {
  const query = ctx.request.query;
  if (isEmpty(query) || isEmpty(query["chainId"]) || isEmpty(query["txid"])) {
    return (ctx.body = {
      errno: 1000,
      errmsg: "Missing parameter chainId or txid",
    });
  }
  const spvCtx = ctx.state["spvCtx"] as Context;
  const tx = await spvCtx.models.transaction.findOne({
    raw: true,
    where: {
      chainId: Number(query["chainId"]),
      side: 0,
      hash: query["txid"],
    },
  });
  if (isEmpty(tx) || !tx) {
    return (ctx.body = {
      errno: 1000,
      data: tx,
      errmsg: `${query["txid"]} Tx Not Found`,
    });
  }
  const extra: any = tx.extra || {};
  const ebcid = extra.ebcId || 0;
  const respAmount = tx.value;
  // respAmount = tx.value
  const hash = SPV.getTreeTxHash(
    tx.chainId,
    tx.hash,
    tx.from,
    tx.to,
    tx.nonce,
    tx.value,
    tx.tokenAddress,
    dayjs(tx.timestamp).unix(),
    respAmount,
    ebcid,
  );
  if (!SPV.tree[String(query["chainId"])]) {
    return (ctx.body = {
      errno: 0,
      data: [],
      errmsg: "non-existent",
    });
  }
  const uncollectedPayment =
    SPV.tree[String(query["chainId"])].uncollectedPayment;
  if (!uncollectedPayment) {
    return (ctx.body = {
      errno: 0,
      data: [],
      errmsg: "non-existent",
    });
  }

  const proof = uncollectedPayment.getHexProof(Buffer.from(hash));
  ctx.body = {
    errno: 0,
    data: proof,
    errmsg: "",
  };
}
