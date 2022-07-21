import { maker_transactionAttributes } from "./../models/maker_transaction";
import dayjs from "dayjs";
import { chains } from "orbiter-chaincore";
import { ITransaction, TransactionStatus } from "orbiter-chaincore/src/types";
import { dydx } from "orbiter-chaincore/src/utils";
import {
  equals,
  fix0xPadStartAddress,
  isEmpty,
} from "orbiter-chaincore/src/utils/core";
import { Op } from "sequelize";
import { Context } from "../../context";
import { transactionAttributes } from "../models/transaction";
import { TransactionID } from "../utils";
import { getAmountFlag, getAmountToSend } from "../utils/oldUtils";
import { IMarket } from "../types";
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
  if (
    isEmpty(tx.from) ||
    isEmpty(tx.to) ||
    isEmpty(tx.value) ||
    isEmpty(tx.nonce) ||
    isEmpty(tx.symbol)
  ) {
    throw new Error(`Tx ${tx.hash} Missing required parameters`);
  }
  const isMakerSend =
    ctx.makerConfigs.findIndex((row: IMarket) =>
      equals(row.sender, tx.from),
    ) !== -1;
  const isUserSend =
    ctx.makerConfigs.findIndex((row: IMarket) =>
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
        error,
        tx,
      });
    }
  } else if (isUserSend) {
    try {
      return await processUserSendMakerTx(ctx, tx);
    } catch (error: any) {
      ctx.logger.error(`processUserSendMakerTx error: `, {
        error,
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
      throw new Error(`getChainByInternalId chainId ${tx.chainId} not found`);
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
    const txData = {
      hash: tx.hash,
      nonce: String(tx.nonce),
      blockHash: tx.blockHash,
      blockNumber: tx.blockNumber,
      transactionIndex: tx.transactionIndex,
      from: tx.from || "",
      to: tx.to || "",
      value: String(tx.value),
      symbol: tx.symbol,
      gasPrice: tx.gasPrice,
      gas: tx.gas,
      input: tx.input != "0x" ? tx.input : null,
      status: tx.status,
      tokenAddress: tx.tokenAddress || "",
      timestamp: dayjs(tx.timestamp * 1000).toDate(),
      fee: String(tx.fee),
      feeToken: tx.feeToken,
      chainId: Number(chainConfig.internalId),
      source: tx.source,
      extra: tx.extra,
      memo,
      replyAccount: "",
      replySender: "",
    };
    const isMakerSend =
      ctx.makerConfigs.findIndex((row: { sender: any }) =>
        equals(row.sender, tx.from),
      ) !== -1;
    const isUserSend =
      ctx.makerConfigs.findIndex((row: { recipient: any }) =>
        equals(row.recipient, tx.to),
      ) !== -1;
    if (isMakerSend) {
      // maker send
      txData.replyAccount = txData.to;
      txData.replySender = txData.from;
    } else if (isUserSend) {
      // user send
      const fromChainId = Number(txData.chainId);
      let toChainId = Number(
        getAmountFlag(Number(fromChainId), String(txData.value)),
      );
      if ([9, 99].includes(fromChainId) && txData.extra) {
        toChainId = Number(txData.extra.memo) % 9000;
      }
      txData.replyAccount = txData.from;
      if ([44, 4, 11, 511].includes(fromChainId)) {
        // dydx contract send
        // starknet contract send
        txData.replyAccount = txData.extra["ext"] || "";
      } else if ([44, 4, 11, 511].includes(toChainId)) {
        const ext = txData.extra["ext"] || "";
        // 11,511 0x02 first
        // 4, 44 0x03 first
        txData.replyAccount = `0x${ext.substring(4)}`;
        if ([44, 4].includes(toChainId)) {
          txData.replyAccount = fix0xPadStartAddress(txData.replyAccount, 66);
        }
      }
      const market = ctx.makerConfigs.find(
        m =>
          equals(m.fromChain.id, String(fromChainId)) &&
          equals(m.toChain.id, String(toChainId)) &&
          equals(m.fromChain.symbol, txData.symbol) &&
          equals(m.fromChain.tokenAddress, txData.tokenAddress),
      );
      if (!market) {
        txData.status = 3;
      } else {
        txData.replySender = market.sender;
      }
    }

    if (
      [3, 33, 8, 88, 12, 512].includes(Number(txData.chainId)) &&
      txData.status === TransactionStatus.PENDING
    ) {
      txData.status = TransactionStatus.COMPLETE;
    }

    txsList.push(txData);
  }
  try {
    await ctx.models.transaction.bulkCreate(<any>txsList, {
      // returning: true,
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
        "replyAccount",
        "replySender",
      ],
    });
    return txsList;
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
  const toChainId = Number(trx.memo);
  const market = ctx.makerConfigs.find(
    m =>
      equals(m.fromChain.id, String(fromChainId)) &&
      equals(m.toChain.id, String(toChainId)) &&
      equals(m.fromChain.symbol, trx.symbol) &&
      equals(m.fromChain.tokenAddress, trx.tokenAddress),
  );
  let needToAmount = "0";
  if (market) {
    needToAmount =
      getAmountToSend(
        Number(fromChainId),
        Number(toChainId),
        trx.value.toString(),
        market.pool,
        trx.nonce,
      )?.tAmount || "0";
  }

  const t = await ctx.sequelize.transaction();
  try {
    const where = {
      chainId: toChainId,
      from: trx.replySender,
      to: trx.replyAccount,
      symbol: trx.symbol,
      memo: trx.nonce,
      timestamp: {
        [Op.gte]: dayjs(trx.timestamp).subtract(5, "m").toDate(),
        [Op.lte]: dayjs(trx.timestamp)
          .add(24 * 60, "m")
          .toDate(),
      },
      value: String(needToAmount),
    };
    // Because of the delay of starknet network, the time will be longer if it is starknet
    if ([4, 44].includes(fromChainId)) {
      where.timestamp = {
        [Op.gte]: dayjs(trx.timestamp).subtract(120, "m").toDate(),
        [Op.lte]: dayjs(trx.timestamp)
          .add(2 * 60, "m")
          .toDate(),
      };
    }
    const makerSendTx = await ctx.models.transaction.findOne({
      raw: true,
      attributes: ["id"],
      where,
      order: [["timestamp", "asc"]],
      transaction: t,
    });
    const upsertData: Partial<maker_transactionAttributes> = {
      transcationId,
      inId: trx.id,
      fromChain: trx.chainId,
      toChain: toChainId,
      toAmount: String(needToAmount),
      replySender: trx.replySender,
      replyAccount: trx.replyAccount,
    };
    if (makerSendTx) {
      upsertData.outId = makerSendTx.id;
    }
    await ctx.models.maker_transaction.upsert(upsertData, {
      transaction: t,
    });
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
  const t = await ctx.sequelize.transaction();
  try {
    // upsert
    const replySender = trx.from;
    const replyAccount = trx.to;
    const userSendTx = await models.transaction.findOne({
      raw: true,
      attributes: [
        "id",
        "from",
        "to",
        "chainId",
        "symbol",
        "nonce",
        "replyAccount",
        "replySender",
      ],
      where: {
        memo: trx.chainId,
        nonce: trx.memo,
        status: 1,
        symbol: trx.symbol,
        replyAccount,
        replySender,
        timestamp: {
          [Op.lte]: dayjs(trx.timestamp).add(5, "m").toDate(),
          [Op.gte]: dayjs(trx.timestamp)
            .subtract(60 * 24, "m")
            .toDate(),
        },
        value: {
          [Op.gt]: Number(trx.value),
        },
      },
      transaction: t,
    });
    const upsertData: Partial<maker_transactionAttributes> = {
      outId: trx.id,
      toChain: trx.chainId,
      toAmount: String(trx.value),
      replySender,
      replyAccount,
    };
    if (userSendTx?.id) {
      upsertData.inId = userSendTx.id;
      upsertData.fromChain = userSendTx.chainId;
      upsertData.transcationId = TransactionID(
        String(userSendTx.from),
        userSendTx.chainId,
        userSendTx.nonce,
        userSendTx.symbol,
      );
    }
    const [makerRelTrx] = await models.maker_transaction.upsert(upsertData, {
      transaction: t,
    });
    await t.commit();
    return makerRelTrx;
  } catch (error) {
    t && (await t.rollback());
    throw error;
  }
}
