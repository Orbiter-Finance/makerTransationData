import { SPV } from "./../../service/spv";
import { isEmpty } from "orbiter-chaincore/src/utils/core";
import { Context } from "../../context";
import Router from "koa-router";
import dayjs from "dayjs";

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
      // where["timestamp"] = {
      //   [Op.lte]: dayjs()
      //     .subtract(1, "s")
      //     .subtract(spvCtx.config.makerTransferTimeout, "m")
      //     .toDate(),
      // };
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
        "side",
        "status",
        "memo",
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
    row.ebcId = row.extra.ebcId;
    row.expectValue = row.expectValue;
    row.expectSafetyCode = 0;
    row.timestamp = dayjs(row.timestamp).utc().unix();
    if (row.side === 0) {
      row.expectSafetyCode = row.nonce;
    }
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
  const fromChain = query["fromChain"];
  const fromTxId = query["fromTxId"];
  const toTxId = query["toTxId"];
  if (
    isEmpty(query) ||
    isEmpty(fromChain) ||
    isEmpty(fromTxId) ||
    isEmpty(toTxId)
  ) {
    return (ctx.body = {
      errno: 1000,
      errmsg: "Missing parameter chainId or txid",
    });
  }
  const spvCtx = ctx.state["spvCtx"] as Context;
  // valid is exists
  const fromTx = await spvCtx.models.transaction.findOne({
    raw: true,
    where: {
      chainId: Number(fromChain),
      side: 0,
      status: 98,
      hash: fromTxId,
    },
  });
  if (isEmpty(fromTx) || !fromTx) {
    return (ctx.body = {
      errno: 1000,
      errmsg: "From Transaction does not exist",
    });
  }

  if (fromTx.status != 98) {
    return (ctx.body = {
      errno: 1000,
      errmsg: "Incorrect transaction status",
    });
  }

  const toChain = Number(fromTx?.memo);
  const toTx = await spvCtx.models.transaction.findOne({
    raw: true,
    where: {
      chainId: Number(toChain),
      side: 1,
      hash: toTxId,
    },
  });
  if (isEmpty(toTx) || !toTx) {
    return (ctx.body = {
      errno: 1000,
      data: toTx,
      errmsg: "To Transaction does not exist",
    });
  }

  // get
  const mtTx = await spvCtx.models.maker_transaction.findOne({
    attributes: ["id"],
    where: {
      inId: fromTx.id,
      outId: toTx.id,
    },
  });
  if (!mtTx || isEmpty(mtTx)) {
    return (ctx.body = {
      errno: 1000,
      data: null,
      errmsg: "Collection records do not match",
    });
  }
  const { hex, leaf } = await SPV.calculateLeaf(toTx);
  const delayedPayment = SPV.tree[String(toChain)].delayedPayment;
  if (!delayedPayment) {
    return (ctx.body = {
      errno: 0,
      data: [],
      errmsg: "proof non-existent",
    });
  }
  const proof = delayedPayment.getHexProof(hex);
  // const extra:any = txTx.extra || {};
  ctx.body = {
    errno: 0,
    data: {
      tx: leaf,
      proof,
    },
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
  const { hex } = await SPV.calculateLeaf(tx);
  if (!SPV.tree[String(query["chainId"])]) {
    return (ctx.body = {
      errno: 1000,
      data: [],
      errmsg: "proof non-existent",
    });
  }
  const uncollectedPayment =
    SPV.tree[String(query["chainId"])].uncollectedPayment;
  if (!uncollectedPayment) {
    return (ctx.body = {
      errno: 1000,
      data: [],
      errmsg: "non-existent",
    });
  }
  const proof = uncollectedPayment.getHexProof(hex);
  ctx.body = {
    errno: 0,
    data: proof,
    errmsg: "",
  };
}
