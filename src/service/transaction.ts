import { Transaction } from "./../models/Transactions";
import { MakerTransaction } from "../models/MakerTransaction";
import dayjs from "dayjs";
import { chains } from "orbiter-chaincore";
import { ITransaction, TransactionStatus } from "orbiter-chaincore/src/types";
import { dydx } from "orbiter-chaincore/src/utils";
import BigNumber from "bignumber.js";
import axios from "axios";
import {
  equals,
  fix0xPadStartAddress,
  isEmpty,
} from "orbiter-chaincore/src/utils/core";
import { InferAttributes, InferCreationAttributes, Op } from "sequelize";
import { Context } from "../context";
import { TranferId, TransactionID } from "../utils";
import {
  getAmountFlag,
  getAmountToSend,
  getFormatDate,
} from "../utils/oldUtils";
import { IMarket } from "../types";
import { Transaction as transactionAttributes } from "../models/Transactions";
import { RabbitMq } from "./RabbitMq";
import RLP from "rlp";
import { ethers } from "ethers";

export async function bulkCreateTransaction(
  ctx: Context,
  txlist: Array<ITransaction>,
): Promise<Array<InferCreationAttributes<Transaction>>> {
  const upsertList: Array<InferCreationAttributes<Transaction>> = [];
  for (const tx of txlist) {
    // ctx.logger.info(`processSubTx:${tx.hash}`);
    const chainConfig = chains.getChainInfo(Number(tx.chainId));
    if (!chainConfig) {
      ctx.logger.error(`getChainByInternalId chainId ${tx.chainId} not found`);
      continue;
    }
    if (
      chainConfig.tokens.findIndex(row =>
        equals(row.address, String(tx.tokenAddress)),
      ) < 0
    ) {
      ctx.logger.error(
        ` Token Not Found ${tx.tokenAddress} ${tx.chainId} ${
          tx.hash
        } ${getFormatDate(tx.timestamp)}`,
      );
      continue;
    }
    const value: string = new BigNumber(String(tx.value)).toFixed();
    if (value.length >= 32) {
      ctx.logger.error(
        `Amount format error ${tx.chainId} ${tx.hash} ${getFormatDate(
          tx.timestamp,
        )}`,
      );
      continue;
    }
    let memo = getAmountFlag(Number(chainConfig.internalId), String(tx.value));
    const txExtra = tx.extra || {};
    if (["9", "99"].includes(chainConfig.internalId) && txExtra) {
      const arr = txExtra.memo.split("_");
      memo = String(+arr[0] % 9000);
    } else if (
      ["11", "511"].includes(chainConfig.internalId) &&
      txExtra["type"] === "TRANSFER_OUT"
    ) {
      if (!tx.to) {
        tx.to = dydx.getEthereumAddressFromClientId(txExtra["clientId"]);
      }
      // makerAddress
      if (!tx.from) {
        const makerItem = await ctx.makerConfigs.find(
          (row: { toChain: { id: number } }) =>
            equals(row.toChain.id, Number(chainConfig.internalId)),
        );
        tx.from = (makerItem && makerItem.sender) || "";
      }
    }
    const txData: Partial<Transaction> = {
      hash: tx.hash.toLowerCase(),
      nonce: String(tx.nonce),
      blockHash: tx.blockHash,
      blockNumber: tx.blockNumber,
      transactionIndex: tx.transactionIndex,
      from: tx.from,
      to: tx.to,
      value,
      symbol: tx.symbol,
      gasPrice: tx.gasPrice,
      gas: tx.gas,
      input: tx.input != "0x" ? tx.input : undefined,
      status: tx.status,
      tokenAddress: tx.tokenAddress || "",
      timestamp: dayjs(tx.timestamp * 1000)
        .utc()
        .toDate(),
      fee: String(tx.fee),
      feeToken: tx.feeToken,
      chainId: Number(chainConfig.internalId),
      source: tx.source,
      extra: {},
      memo,
      replyAccount: undefined,
      replySender: undefined,
      side: 0,
      makerId: undefined,
      lpId: undefined,
      expectValue: undefined,
      transferId: "",
    };
    const saveExtra: any = {
      ebcId: "",
    };
    const isMakerSend = !!ctx.makerConfigs.find(
      item =>
        equals(item.sender, tx.from) ||
        equals(item.crossAddress?.sender, tx.from),
    );
    const isUserSend = !!ctx.makerConfigs.find(
      item =>
        equals(item.recipient, tx.to) ||
        equals(item.crossAddress?.recipient, tx.to),
    );
    if (isMakerSend) {
      txData.side = 1;
      // maker send
      txData.replyAccount = txData.to;
      txData.replySender = txData.from;
      txData.transferId = TranferId(
        String(txData.chainId),
        String(txData.replySender),
        String(txData.replyAccount),
        String(txData.memo),
        String(txData.symbol),
        String(txData.value),
      );
      saveExtra.toSymbol = txData.symbol;
      // const count: any = await ctx.models.Transaction.count(<any>{
      //   where: {
      //     transferId: txData.transferId,
      //   },
      // });
      // if (!count) {
      //   // backtrack
      //   const userTx = await ctx.models.Transaction.findOne(<any>{
      //     where: {
      //       replyAccount: txData.replyAccount,
      //       chainId: txData.chainId,
      //       nonce: txData.memo,
      //     },
      //   });
      //   if (userTx) {
      //     txData.transferId = userTx.transferId;
      //     txData.status = 95;
      //     userTx.status = 95;
      //     upsertList.push(userTx);
      //   }
      // }
    } else if (isUserSend) {
      txData.side = 0;
      const fromChainId = Number(txData.chainId);
      const toChainId = Number(txData.memo);
      // user send
      // Calculation collection ID
      txData.replyAccount = txData.from;
      if ([44, 4, 11, 511].includes(fromChainId)) {
        // dydx contract send
        // starknet contract send
        txData.replyAccount = txExtra["ext"] || "";
      } else if ([44, 4, 11, 511].includes(toChainId)) {
        const ext = txExtra["ext"] || "";
        saveExtra["ext"] = ext;
        // 11,511 0x02 first
        // 4, 44 0x03 first
        txData.replyAccount = `0x${ext.substring(4)}`;
        if ([44, 4].includes(toChainId)) {
          txData.replyAccount = fix0xPadStartAddress(txData.replyAccount, 66);
        }
      }
      if ([99, 9].includes(fromChainId)) {
        const arr = txExtra.memo.split("_");
        if (arr.length > 1) {
          txData.replyAccount = arr[1];
        }
      }
      const market = getMarket(
        ctx,
        fromChainId,
        toChainId,
        String(txData.symbol),
        String(txData.symbol),
        txData.timestamp,
        true,
      );
      if (!market) {
        // market not found
        txData.status = 3;
      } else {
        // valid timestamp
        txData.lpId = market.id || null;
        txData.makerId = market.makerId || null;
        // ebc
        saveExtra.ebcId = market.ebcId;
        saveExtra.ua = {
          toTokenAddress: market.toChain?.tokenAddress,
        };
        saveExtra.toSymbol = market.toChain.symbol;
        txData.replySender = market.sender;
        // calc response amount
        try {
          txData.expectValue = String(
            await calcMakerSendAmount(ctx.makerConfigs, txData as any),
          );
          txData.transferId = TranferId(
            String(toChainId),
            txData.replySender,
            String(txData.replyAccount),
            String(txData.nonce),
            String(txData.symbol),
            txData.expectValue,
          );
        } catch (error) {
          ctx.logger.error(
            "bulkCreateTransaction calcMakerSendAmount error:",
            error,
          );
        }
      }
    }

    if (
      [3, 33, 8, 88, 12, 512, 9, 99].includes(Number(txData.chainId)) &&
      txData.status === TransactionStatus.PENDING
    ) {
      txData.status = TransactionStatus.COMPLETE;
    }
    if (tx.source == "xvm" && txExtra?.xvm) {
      await handleXVMTx(ctx, txData, txExtra, saveExtra, upsertList);
    }
    txData.extra = saveExtra;
    upsertList.push(<any>txData);
  }
  // log
  for (const txData of <Transaction[]>upsertList) {
    const isMakerSend = txData.side;
    const saveExtra: any = txData.extra;
    const detail =
      "detail:" +
      (txData.source === "xvm"
        ? JSON.stringify(saveExtra?.xvm || {})
        : JSON.stringify(saveExtra?.ua || {}));
    if (isMakerSend) {
      ctx.logger.info(
        `maker ${txData.chainId}:${txData.symbol}->${saveExtra?.toSymbol} status:${txData.status} ${txData.source} ${txData.hash}`,
      );
    } else {
      ctx.logger.info(
        `user ${txData.chainId}:${txData.symbol}->${txData.memo}:${saveExtra?.toSymbol} status:${txData.status} ${txData.source} ${txData.hash} ${detail}`,
      );
    }
  }
  const pushMQTxs = [];
  for (const row of upsertList) {
    try {
      const [newTx, created] = await ctx.models.Transaction.findOrCreate({
        defaults: row,
        attributes: ["id", "status"],
        where: {
          hash: row.hash,
        },
      });
      if (!created) {
        // change
        if ([0, 1].includes(newTx.status) && row.status != newTx.status) {
          //
          newTx.status = row.status;
        }
        if (newTx.transferId != row.transferId) {
          newTx.transferId = row.transferId;
        }
        await newTx.save();
        row.status = newTx.status;
      }
      row.id = newTx.id;
      if (created) {
        pushMQTxs.push(row);
      }
    } catch (error: any) {
      console.log(row);
      ctx.logger.error("processSubTx error:", error);
      throw error;
    }
  }
  // push mq
  try {
    // tag: prod filter tx
    let messageList = [];
    if (ctx.NODE_ENV === "production") {
      messageList = pushMQTxs.filter(
        item => item.side == 0 && item.status == 1 && item.source === "xvm",
      );
    } else {
      messageList = pushMQTxs.filter(
        item => item.side == 0 && item.status == 1,
      );
    }
    if (messageList.length > 0) {
      const rbmq = new RabbitMq(ctx);
      await rbmq.publish(ctx, messageList);
    }
  } catch (e: any) {
    ctx.logger.error("RabbitMQ error", e.message);
  }
  return upsertList;
}

async function handleXVMTx(
  ctx: Context,
  txData: Partial<Transaction>,
  txExtra: any,
  saveExtra: any,
  upsertList: Array<InferCreationAttributes<Transaction>>,
) {
  saveExtra.xvm = txExtra.xvm;
  const { name, params } = txExtra.xvm;
  txData.value = params.value;
  if (name.toLowerCase() === "swap") {
    const decodeData = decodeXvmData(params.data);
    params.data = decodeData;
    txData.memo = String(decodeData.toChainId);
    const fromChainId = Number(txData.chainId);
    const toChainId = Number(txData.memo);
    const market = getMarket(
      ctx,
      fromChainId,
      toChainId,
      String(txData.tokenAddress),
      decodeData.toTokenAddress,
      txData.timestamp,
    );
    if (!market) {
      // market not found
      txData.status = 3;
      ctx.logger.error("Market not found", txData.hash);
    } else {
      const isCrossAddressAndSameSymbol =
        !equals(txData.from, decodeData.toWalletAddress) &&
        equals(txData.symbol, market.toChain.symbol);
      txData.lpId = market.id || null;
      txData.makerId = market.makerId || null;
      saveExtra["ebcId"] = market.ebcId;
      saveExtra.toSymbol = market.toChain.symbol;
      txData.side = 0;
      txData.replySender =
        isCrossAddressAndSameSymbol && market.crossAddress?.sender
          ? market.crossAddress?.sender
          : market.sender;
      txData.replyAccount = decodeData.toWalletAddress;
      if ([44, 4].includes(toChainId)) {
        txData.replyAccount = fix0xPadStartAddress(txData.replyAccount, 66);
      }
      txData.expectValue = String(
        await calcMakerSendAmount(ctx.makerConfigs, txData as any),
      );
      txData.transferId = TranferId(
        String(market.toChain.id),
        String(txData.replySender),
        String(txData.replyAccount),
        String(txData.nonce),
        String(market.toChain.symbol),
        String(txData.expectValue),
      );
    }
  } else if (name.toLowerCase() === "swapanswer") {
    const dataDecode: any = RLP.decode(params.data);
    txData.side = 1;
    // params:{tradeId,token,to,value}
    const tradeId = Buffer.from(dataDecode[0]).toString();
    const op = Number(Buffer.from(dataDecode[1]).toString());
    const userTx = await ctx.models.Transaction.findOne(<any>{
      // attributes: [
      //   "id",
      //   "hash",
      //   "status",
      //   "chainId",
      //   "transferId",
      //   "replyAccount",
      //   "replySender",
      //   "side",
      // ],
      where: {
        hash: tradeId,
      },
    });
    if (op == 2) {
      txData.status = 4;
    }
    const market = ctx.makerConfigs.find(item =>
      equals(item.toChain.tokenAddress, params.token),
    );
    if (market) {
      saveExtra.toSymbol = market.toChain.symbol;
    }
    if (userTx) {
      txData.memo = String(userTx.chainId);
      txData.transferId = userTx.transferId;
      txData.replyAccount = userTx.replyAccount;
      txData.replySender = userTx.replySender;
      if (op == 2) {
        userTx.status = 4;
        upsertList.push(userTx);
      }
      if (op == 3) {
        userTx.status = 95;
        txData.status = 95;
        upsertList.push(userTx);
      }
    } else {
      ctx.logger.error(
        `get userTx fail,tradeId:${tradeId}, hash:${txData.hash}`,
      );
    }
  }
}

function getMarket(
  ctx: Context,
  fromChainId: number,
  toChainId: number,
  fromTokenAddress: string,
  toTokenAddress: string,
  timestamp: any,
  isSymbol?: boolean,
) {
  if (isSymbol)
    return ctx.makerConfigs.find(
      m =>
        equals(m.fromChain.id, fromChainId) &&
        equals(m.toChain.id, toChainId) &&
        equals(m.fromChain.symbol, fromTokenAddress) &&
        equals(m.toChain.symbol, toTokenAddress) &&
        dayjs(timestamp).unix() >= m.times[0] &&
        dayjs(timestamp).unix() <= m.times[1],
    );
  return ctx.makerConfigs.find(
    m =>
      equals(m.fromChain.id, fromChainId) &&
      equals(m.toChain.id, toChainId) &&
      equals(m.fromChain.tokenAddress, fromTokenAddress) &&
      equals(m.toChain.tokenAddress, toTokenAddress) &&
      dayjs(timestamp).unix() >= m.times[0] &&
      dayjs(timestamp).unix() <= m.times[1],
  );
}

function decodeXvmData(data: string): {
  toChainId: number;
  toTokenAddress: string;
  toWalletAddress: string;
  expectValue: string;
  slippage: number;
} {
  const decoded: any = RLP.decode(data);
  const result: any = {};
  decoded.forEach((item: any, index: number) => {
    switch (index) {
      case 0:
        result.toChainId = Number(ethers.utils.hexlify(item));
        break;
      case 1:
        result.toTokenAddress = ethers.utils.hexlify(item);
        break;
      case 2:
        result.toWalletAddress = ethers.utils.hexlify(item);
        break;
      case 3:
        result.expectValue = new BigNumber(
          ethers.utils.hexlify(item),
        ).toString();
        break;
      case 4:
        result.slippage = Number(item.toString());
        break;
    }
  });
  return result;
}

async function getRates(currency: string): Promise<any> {
  const resp: any = await axios.get(
    `https://api.coinbase.com/v2/exchange-rates?currency=${currency}`,
  );
  const rates = resp.data?.data?.rates;
  if (!rates) {
    console.log("Get rate fail, try it again");
    await new Promise(resolve => setTimeout(resolve, 3000));
    return await getRates(currency);
  }
  console.log("Get rate success !!!");
  return rates;
}

export async function exchangeToCoin(
  value: any,
  sourceCurrency: any,
  toCurrency: any,
) {
  if (!sourceCurrency) return value;
  if (!(value instanceof BigNumber)) {
    value = new BigNumber(value);
  }
  const exchangeRates = await getRates(sourceCurrency);
  const fromRate = exchangeRates[sourceCurrency];
  const toRate = exchangeRates[toCurrency];
  if (!fromRate || !fromRate) {
    return new BigNumber(0);
  }
  return value.dividedBy(fromRate).multipliedBy(toRate);
}

export async function calcMakerSendAmount(
  makerConfigs: Array<any>,
  trx: transactionAttributes,
) {
  if (
    isEmpty(trx.chainId) ||
    isEmpty(trx.memo) ||
    isEmpty(trx.symbol) ||
    isEmpty(trx.tokenAddress) ||
    isEmpty(trx.timestamp)
  ) {
    throw new Error("Missing parameter");
  }
  const fromChainId = Number(trx.chainId);
  const toChainId = Number(trx.memo);
  const market: IMarket = makerConfigs.find(
    m =>
      equals(m.fromChain.id, fromChainId) &&
      equals(m.toChain.id, toChainId) &&
      equals(m.fromChain.symbol, trx.symbol) &&
      equals(m.fromChain.tokenAddress, trx.tokenAddress) &&
      dayjs(trx.timestamp).unix() >= m.times[0] &&
      dayjs(trx.timestamp).unix() <= m.times[1],
  );
  if (!market) {
    return 0;
  }
  return (
    getAmountToSend(
      Number(fromChainId),
      Number(toChainId),
      trx.value.toString(),
      market,
      trx.nonce,
    )?.tAmount || 0
  );
}

export async function processUserSendMakerTx(
  ctx: Context,
  userTx: Transaction,
) {
  const t = await ctx.models.sequelize.transaction();
  try {
    if (!userTx || isEmpty(userTx.id)) {
      throw new Error("Missing Id Or Transaction does not exist");
    }
    if (!userTx || isEmpty(userTx.transferId)) {
      userTx.transferId = TranferId(
        String(userTx.memo),
        String(userTx.replySender),
        String(userTx.replyAccount),
        String(userTx.nonce),
        String(userTx.symbol),
        String(userTx.expectValue),
      );
    }

    const relInOut = (<any>userTx)["maker_transaction"];
    if (relInOut && relInOut.inId && relInOut.outId) {
      ctx.logger.error(`UserTx %s Already matched`, userTx.hash);
      return {
        inId: relInOut.inId,
        outId: relInOut.outId,
        errmsg: "UserTx Already matched",
      };
    }
    if (
      userTx.status != 1 &&
      userTx.status != 0 &&
      userTx.status != 95 &&
      userTx.status != 97
    ) {
      ctx.logger.error(`${userTx.hash} Current status cannot match`);
      throw new Error(`${userTx.hash} Current status cannot match`);
    }
    // user send to Maker
    const fromChainId = Number(userTx.chainId);
    const toChainId = Number(userTx.memo);
    const transcationId = TransactionID(
      String(userTx.from),
      userTx.chainId,
      userTx.nonce,
      userTx.symbol,
      dayjs(userTx.timestamp).valueOf(),
    );

    const where = {
      transferId: userTx.transferId,
      status: [0, 1, 95],
      side: 1,
      timestamp: {
        [Op.gte]: dayjs(userTx.timestamp).subtract(60 * 6, "m").toDate(),
      },
    };
    // Because of the delay of starknet network, the time will be longer if it is starknet
    if ([4, 44].includes(fromChainId)) {
      where.timestamp = {
        [Op.gte]: dayjs(userTx.timestamp)
          .subtract(30, 'minute')
          .toDate(),
      };
    }
    const makerSendTx = await ctx.models.Transaction.findOne({
      attributes: ["id", "status", "timestamp"],
      where,
      order: [["timestamp", "asc"]],
      transaction: t,
    });
    const upsertData: Partial<InferAttributes<MakerTransaction>> = {
      transcationId,
      inId: userTx.id,
      fromChain: userTx.chainId,
      toChain: toChainId,
      toAmount: String(userTx.expectValue),
      replySender: userTx.replySender,
      replyAccount: userTx.replyAccount,
    };

    if (makerSendTx && makerSendTx.id) {
      let maxReceiptTime = 1 * 60 * 60 * 24;
      if (ctx.isSpv) {
        const chainData = ctx.config.chainsTokens.find((row: any) =>
          equals(row.id, userTx.chainId),
        );
        if (!chainData) {
          ctx.logger.error("processUserSendMakerTx getChain Not Found");
          return;
        }
        maxReceiptTime = chainData.maxReceiptTime;
      }
      upsertData.outId = makerSendTx.id;
      let upStatus = 99;
      const delayMin = dayjs(makerSendTx.timestamp).diff(userTx.timestamp, "s");
      if (makerSendTx.status === 95) {
        upStatus = 95;
      } else if (delayMin > maxReceiptTime) {
        upStatus = 98; //
      }
      makerSendTx.status = upStatus;
      makerSendTx.lpId = userTx.lpId;
      makerSendTx.makerId = userTx.makerId;
      await makerSendTx.save({
        transaction: t,
      });
      await ctx.models.Transaction.update(
        {
          status: upStatus,
        },
        {
          where: {
            id: userTx.id,
          },
          transaction: t,
        },
      );
    }
    await ctx.models.MakerTransaction.upsert(<any>upsertData, {
      transaction: t,
    });
    await t.commit();
    return { inId: userTx.id, outId: makerSendTx?.id };
  } catch (error) {
    await t.rollback();
    ctx.logger.error("processUserSendMakerTx error", error);
  }
}

export async function processMakerSendUserTx(
  ctx: Context,
  makerTx: Transaction
) {
  const t = await ctx.models.sequelize.transaction();
  try {
    if (!makerTx || isEmpty(makerTx.id)) {
      throw new Error("Missing Id Or Transaction does not exist");
    }
    if (!makerTx || isEmpty(makerTx.transferId)) {
      throw new Error("Missing transferId Or Transaction does not exist");
    }
    const relInOut = (<any>makerTx)["out_maker_transaction"];
    if (relInOut && relInOut.inId && relInOut.outId) {
      ctx.logger.error(`MakerTx %s Already matched`, relInOut.hash);
      return {
        inId: relInOut.inId,
        outId: relInOut.outId,
        errmsg: "MakerTx Already matched",
      };
    }
    if (makerTx.status != 1) {
      throw new Error(`${makerTx.hash} Current status cannot match`);
    }
    const models = ctx.models;
    const where: any = {
      transferId: makerTx.transferId,
      status: 1,
      side: 0,
      timestamp: {
        [Op.lte]: dayjs(makerTx.timestamp).add(10, "m").toDate(),
      },
    };
    const userSendTx = await models.Transaction.findOne({
      attributes: [
        "id",
        "from",
        "to",
        "chainId",
        "symbol",
        "nonce",
        "timestamp",
        "lpId",
        "makerId",
        "replyAccount",
        "replySender",
      ],
      where,
    });

    if (isEmpty(userSendTx) || !userSendTx) {
      return {
        outId: makerTx.id,
        inId: null,
        errmsg: "User transaction not found",
      };
    }

    const upsertData: Partial<InferAttributes<MakerTransaction>> = {
      inId: userSendTx.id,
      outId: makerTx.id,
      toChain: makerTx.chainId,
      toAmount: String(makerTx.value),
      replySender: makerTx.replySender,
      replyAccount: makerTx.replyAccount,
      fromChain: userSendTx.chainId,
    };
    upsertData.transcationId = TransactionID(
      String(userSendTx.from),
      userSendTx.chainId,
      userSendTx.nonce,
      userSendTx.symbol,
      dayjs(userSendTx.timestamp).valueOf(),
    );
    let upStatus = 99;
    let maxReceiptTime = 1 * 60 * 60 * 24;
    if (ctx.isSpv) {
      const chainData = ctx.config.chainsTokens.find((row: any) =>
        equals(row.id, userSendTx.chainId),
      );
      if (!chainData) {
        ctx.logger.error("processMakerSendUserTx getChain Not Found");
        return;
      }
      maxReceiptTime = chainData.maxReceiptTime;
    }
    // Check whether the payment is delayed in minutes
    const delayMin = dayjs(makerTx.timestamp).diff(userSendTx.timestamp, "s");
    if (delayMin > maxReceiptTime) {
      upStatus = 98; //
    }
    userSendTx.status = upStatus;
    await userSendTx.save({
      transaction: t,
    });
    await ctx.models.Transaction.update(
      {
        status: upStatus,
        lpId: userSendTx.lpId,
        makerId: userSendTx.makerId,
      },
      {
        where: {
          id: userSendTx.id,
        },
        transaction: t,
      },
    );
    await models.MakerTransaction.upsert(<any>upsertData, {
      transaction: t,
    });
    await t.commit();
    return { inId: userSendTx.id, outId: makerTx.id, errmsg: "ok" };
  } catch (error) {
    t && (await t.rollback());
    ctx.logger.error("processMakerTxCrossAddress error", error);
  }
}
