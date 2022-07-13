import dayjs from "dayjs";
import { chains } from "orbiter-chaincore";
import { ITransaction, TransactionStatus } from "orbiter-chaincore/src/types";
import { dydx } from "orbiter-chaincore/src/utils";
import { equals, fix0xPadStartAddress } from "orbiter-chaincore/src/utils/core";
import { Op } from "sequelize";
import { Context } from "../../context";
import { transactionAttributes } from "../models/transaction";
import { TransactionID } from "../utils";
import { getAmountFlag, getAmountToSend } from "../utils/oldUtils";
export async function findByHashTxMatch(
  ctx: Context,
  chainId: number,
  hash: string,
) {
  const tx = await ctx.models.transaction.findOne({
    raw: true,
    attributes: { exclude: ["input", "blockHash", "transactionIndex"] },
    where: {
      chainId,
      hash,
    },
  });
  if (!tx || !tx.id) {
    throw new Error("Tx Not Found");
  }
  const isMakerSend =
    ctx.makerConfigs.findIndex((row: { sender: any }) =>
      equals(row.sender, tx.from),
    ) !== -1;
  const isUserSend =
    ctx.makerConfigs.findIndex((row: { recipient: any }) =>
      equals(row.recipient, tx.to),
    ) !== -1;
  if (tx.status !== 1) {
    return;
  }
  if (isMakerSend) {
    try {
      return await processMakerSendUserTx(ctx, tx);
    } catch (error: any) {
      ctx.logger.error(`processMakerSendUserTx error: `, {
        errmsg: error.message,
        tx,
      });
    }
  } else if (isUserSend) {
    try {
      return await processUserSendMakerTx(ctx, tx);
    } catch (error: any) {
      console.log(error);
      ctx.logger.error(`processUserSendMakerTx error: `, {
        errmsg: error.message,
        tx,
      });
    }
  } else {
    ctx.logger.error(
      `matchSourceData This transaction is not matched to the merchant address: ${tx.hash}`,
    );
  }
}
export async function bulkCreateTransaction(
  ctx: Context,
  txlist: Array<ITransaction>,
) {
  const txsList = [];
  for (const tx of txlist) {
    // ctx.logger.info(`processSubTx:${tx.hash}`);
    const chainConfig = chains.getChainByChainId(tx.chainId);
    if (!chainConfig) {
      throw new Error(`chainId ${tx.chainId} not found`);
    }
    // ctx.logger.info(
    //   `[${chainConfig.name}] chain:${chainConfig.internalId}, hash:${tx.hash}`
    // );
    let memo = getAmountFlag(Number(chainConfig.internalId), String(tx.value));
    if (["9", "99"].includes(chainConfig.internalId) && tx.extra) {
      memo = String(tx.extra.memo % 9000);
    } else if (
      ["11", "511"].includes(chainConfig.internalId) &&
      tx.extra["type"] === "TRANSFER_OUT"
    ) {
      if (!tx.to) {
        tx.to = dydx.getEthereumAddressFromClientId(tx.extra["clientId"]);
      }
      // makerAddress
      if (!tx.from) {
        const makerItem = await ctx.makerConfigs.find(
          (row: { toChain: { id: string } }) =>
            row.toChain.id === chainConfig.internalId,
        );
        tx.from = (makerItem && makerItem.sender) || "";
      }
    }
    const txData: any = {
      hash: tx.hash,
      nonce: String(tx.nonce),
      blockHash: tx.blockHash,
      blockNumber: tx.blockNumber,
      transactionIndex: tx.transactionIndex,
      from: tx.from || "",
      to: tx.to || "",
      value: tx.value.toString(),
      symbol: tx.symbol,
      gasPrice: tx.gasPrice,
      gas: tx.gas,
      input: tx.input != "0x" ? tx.input : null,
      status: tx.status,
      tokenAddress: tx.tokenAddress || "",
      timestamp: new Date(tx.timestamp * 1000),
      fee: tx.fee.toString(),
      feeToken: tx.feeToken,
      chainId: Number(chainConfig.internalId),
      source: tx.source,
      extra: tx.extra,
      memo,
    };
    if (
      [3, 33, 8, 88, 12, 512].includes(Number(txData.chainId)) &&
      txData.status === TransactionStatus.PENDING
    ) {
      txData.status = TransactionStatus.COMPLETE;
    }

    txsList.push(txData);
  }
  try {
    const result = await ctx.models.transaction.bulkCreate(txsList, {
      returning: true,
      updateOnDuplicate: [
        "from",
        "to",
        "value",
        "fee",
        "feeToken",
        "symbol",
        "status",
        "input",
        "extra",
        "timestamp",
        "tokenAddress",
        "nonce",
        "memo",
      ],
    });
    return result.map((row: any) => row.toJSON());
  } catch (error: any) {
    ctx.logger.error("processSubTx error:", error);
    throw error;
  }
}
export async function processUserSendMakerTx(
  ctx: Context,
  trx: transactionAttributes,
) {
  // user send to Maker
  const fromChainId = Number(trx.chainId);
  const transcationId = TransactionID(
    String(trx.from),
    trx.chainId,
    trx.nonce,
    trx.symbol,
  );
  let toChainId = getAmountFlag(fromChainId, String(trx.value));
  if ([9, 99].includes(fromChainId) && trx.extra) {
    toChainId = String((<any>trx.extra).memo % 9000);
  }
  const market = ctx.makerConfigs.find(
    m =>
      equals(m.fromChain.id, String(fromChainId)) &&
      equals(m.toChain.id, toChainId) &&
      equals(m.fromChain.symbol, trx.symbol) &&
      equals(m.fromChain.tokenAddress, trx.tokenAddress),
  );
  if (!market) {
    ctx.logger.error("market not found:", {
      hash: trx.hash,
      value: trx.value.toString(),
      from: trx.from,
      to: trx.to,
      fromChain: fromChainId,
      toChainId: toChainId,
      symbol: trx.symbol,
      token: trx.tokenAddress,
    });
    return;
  }
  const needToAmount =
    getAmountToSend(
      Number(fromChainId),
      Number(toChainId),
      trx.value.toString(),
      market.pool,
      trx.nonce,
    )?.tAmount || "0";
  let replyAccount: string | undefined = trx.from;
  if (["44", "4", "11", "511"].includes(String(fromChainId))) {
    // dydx contract send
    // starknet contract send
    replyAccount = (<any>trx.extra)["ext"] || "";
  } else if (["44", "4", "11", "511"].includes(toChainId)) {
    const ext = (<any>trx.extra)["ext"] || "";
    // 11,511 0x02 first
    // 4, 44 0x03 first
    replyAccount = `0x${ext.substring(4)}`;
    if (["44", "4"].includes(toChainId)) {
      replyAccount = fix0xPadStartAddress(replyAccount, 66);
    }
  }
  const t = await ctx.sequelize.transaction();
  try {
    const where = {
      chainId: toChainId,
      from: market.sender,
      to: replyAccount,
      symbol: trx.symbol,
      memo: trx.nonce,
      timestamp: {
        [Op.gte]: dayjs(trx.timestamp).subtract(5, "m").toDate(),
        [Op.lte]: dayjs(trx.timestamp)
          .subtract(6 * 60, "m")
          .toDate(),
      },
      value: {
        [Op.lt]: Number(trx.value),
      },
    };
    // Because of the delay of starknet network, the time will be longer if it is starknet
    if (["4", "44"].includes(String(fromChainId))) {
      where.timestamp = {
        [Op.gte]: dayjs(trx.timestamp).subtract(120, "m").toDate(),
        [Op.lte]: dayjs(trx.timestamp)
          .subtract(6 * 60, "m")
          .toDate(),
      };
    }
    const makerSendTx = await ctx.models.transaction.findOne({
      raw: true,
      attributes: ["id"],
      where,
      order: [["timestamp", "desc"]],
      transaction: t,
    });
    if (makerSendTx) {
      const upsertParams = {
        transcationId,
        inId: trx.id,
        outId: makerSendTx ? makerSendTx.id : undefined,
        fromChain: trx.chainId,
        toChain: Number(toChainId),
        toAmount: String(needToAmount),
        replySender: market.sender,
        replyAccount,
      };
      await ctx.models.maker_transaction.upsert(upsertParams, {
        transaction: t,
      });
    }
    await t.commit();
    return true;
  } catch (error) {
    await t.rollback();
    throw error;
  }
}
export async function processMakerSendUserTx(
  ctx: Context,
  trx: transactionAttributes,
) {
  // const makerAddress = trx.from;
  const models = ctx.models;
  const userSendTxNonce = getAmountFlag(trx.chainId, String(trx.value));
  const t = await ctx.sequelize.transaction();
  try {
    const userSendTx = await models.transaction.findOne({
      attributes: ["id", "from", "to", "chainId", "symbol", "nonce"],
      order: [["timestamp", "desc"]],
      raw: true,
      nest: true,
      where: {
        memo: trx.chainId,
        nonce: userSendTxNonce,
        status: 1,
        symbol: trx.symbol,
        timestamp: {
          [Op.lte]: dayjs(trx.timestamp).add(5, "m").toDate(),
          [Op.gte]: dayjs(trx.timestamp)
            .subtract(60 * 6, "m")
            .toDate(),
        },
        value: {
          [Op.gt]: Number(trx.value),
        },
      },
      include: [
        {
          required: true,
          attributes: ["inId", "outId"],
          model: models.maker_transaction,
          as: "maker_transaction",
          where: {
            replySender: trx.from,
            replyAccount: trx.to,
          },
        },
      ],
      transaction: t,
    });
    // const makerTransaction: any = userSendTx
    //   ? userSendTx.maker_transaction
    //   : {};
    const replySender = trx.from;
    const replyAccount = trx.to;
    if (userSendTx?.id && userSendTx.from) {
      // exists user transaction
      const transcationId = TransactionID(
        String(userSendTx.from),
        userSendTx.chainId,
        userSendTx.nonce,
        userSendTx.symbol,
      );
      await models.maker_transaction.upsert(
        {
          transcationId,
          inId: userSendTx.id,
          outId: trx.id,
          fromChain: userSendTx.chainId,
          toChain: trx.chainId,
          toAmount: String(trx.value),
          replySender,
          replyAccount,
        },
        {
          transaction: t,
        },
      );
    } else {
      await ctx.models.maker_transaction.upsert(
        {
          outId: trx.id,
          toChain: Number(trx.chainId),
          toAmount: String(trx.value),
          replySender,
          replyAccount,
        },
        {
          transaction: t,
        },
      );
    }
    await t.commit();
    return userSendTx;
  } catch (error) {
    t && (await t.rollback());
    throw error;
  }
}
