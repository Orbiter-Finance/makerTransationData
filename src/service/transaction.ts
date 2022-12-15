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
import {
  getXVMContractToChainInfo,
  TranferId,
  TransactionID,
  TransferIdV2,
} from "../utils";
import { getAmountFlag, getAmountToSend } from "../utils/oldUtils";
import { IMarket, ITarget, IToChain } from "../types";
import { Transaction as transactionAttributes } from "../models/Transactions";
import { RabbitMq } from "./RabbitMq";
import Web3 from "web3";

export async function findByHashTxMatch(
  ctx: Context,
  hashOrId: number | string,
) {
  const where: any = {};
  if (typeof hashOrId == "string") {
    where["hash"] = String(hashOrId);
  } else {
    where["id"] = Number(hashOrId);
  }
  const tx = await ctx.models.Transaction.findOne({
    raw: true,
    attributes: { exclude: ["input", "blockHash", "transactionIndex"] },
    where,
  });
  if (!tx || !tx.id) {
    throw new Error(` hash ${hashOrId} Tx Not Found`);
  }
  if (![1, 99].includes(tx.status)) {
    ctx.logger.error(`Tx ${tx.hash} Incorrect transaction status`);
    return {
      inId: null,
      outId: null,
    };
  }

  if (
    isEmpty(tx.from) ||
    isEmpty(tx.to) ||
    isEmpty(tx.value) ||
    isEmpty(String(tx.nonce)) ||
    isEmpty(tx.symbol)
  ) {
    ctx.logger.error(`Tx ${tx.hash} Missing required parameters`, {
      from: tx.from,
      to: tx.to,
      value: tx.value,
      nonce: tx.nonce,
      symbol: tx.symbol,
    });
    return { inId: null, outId: null };
  }
  const isMakerSend =
    ctx.makerConfigs.findIndex((row: IMarket) =>
      equals(row.sender, tx.from),
    ) !== -1;
  const isUserSend =
    ctx.makerConfigs.findIndex((row: IMarket) =>
      equals(row.recipient, tx.to),
    ) !== -1;
  const mtTx = await ctx.models.MakerTransaction.findOne({
    attributes: ["id", "inId", "outId"],
    raw: true,
    where: {
      [Op.or]: {
        inId: tx.id,
        outId: tx.id,
      },
    },
  });
  if (mtTx && mtTx.inId && mtTx.outId) {
    await ctx.models.Transaction.update(
      {
        status: 99,
      },
      {
        where: {
          id: {
            [Op.in]: [mtTx.inId, mtTx.outId],
          },
        },
      },
    );
    return {
      inId: mtTx.inId,
      outId: mtTx.outId,
    };
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
      `findByHashTxMatch matchSourceData This transaction is not matched to the merchant address: ${tx.hash}`,
      tx,
    );
  }
}

export async function bulkCreateTransaction(
  ctx: Context,
  txlist: Array<ITransaction>,
): Promise<Array<InferCreationAttributes<Transaction>>> {
  const upsertList: Array<InferCreationAttributes<Transaction>> = [];
  for (const tx of txlist) {
    // ctx.logger.info(`processSubTx:${tx.hash}`);
    const chainConfig = chains.getChainByChainId(tx.chainId);
    if (!chainConfig) {
      ctx.logger.error(`getChainByInternalId chainId ${tx.chainId} not found`);
      continue;
    }
    if (
      chainConfig.tokens.findIndex(row =>
        equals(row.address, String(tx.tokenAddress)),
      ) < 0
    ) {
      ctx.logger.error(`${tx.hash} Tx ${tx.tokenAddress} Token Not Found`);
      continue;
    }
    // ctx.logger.info(
    //   `[${chainConfig.name}] chain:${chainConfig.internalId}, hash:${tx.hash}`
    // );
    let memo = getAmountFlag(Number(chainConfig.internalId), String(tx.value));
    const txExtra = tx.extra || {};
    if (["9", "99"].includes(chainConfig.internalId) && txExtra) {
      memo = String(txExtra.memo % 9000);
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
      value: new BigNumber(String(tx.value)).toFixed(),
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
    };
    const saveExtra: any = {
      ebcId: "",
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
        txData.value,
      );
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
      const market = ctx.makerConfigs.find(
        m =>
          equals(m.fromChain.id, fromChainId) &&
          equals(m.toChain.id, toChainId) &&
          equals(m.recipient, String(txData.to)) &&
          equals(m.fromChain.symbol, String(txData.symbol)) &&
          equals(m.fromChain.tokenAddress, String(txData.tokenAddress)) &&
          dayjs(txData.timestamp).unix() >= m.times[0] &&
          dayjs(txData.timestamp).unix() <= m.times[1],
      );
      if (!market) {
        // market not found
        txData.status = 3;
      } else {
        // valid timestamp
        txData.lpId = market.id || null;
        txData.makerId = market.makerId || null;
        // ebc
        saveExtra["ebcId"] = market.ebcId;
        txData.replySender = market.sender;
        // calc response amount
        try {
          txData.expectValue = String(
            await calcMakerSendAmount(ctx.makerConfigs, txData as any),
          );
          txData.transferId = TranferId(
            toChainId,
            txData.replySender,
            String(txData.replyAccount),
            String(txData.nonce),
            String(txData.symbol),
            txData.expectValue,
          );

          // if (new BigNumber(txData.expectValue).lt(new BigNumber(market.fromChain.minPrice)) || new BigNumber(txData.expectValue).gt(new BigNumber(market.fromChain.maxPrice))) {
          //   // overflow
          //   txData.status = 5;
          // }
          // TODO: valid maxPrice and minPrice
          // const minPrice = new BigNumber(market.pool.minPrice)
          //   .plus(new BigNumber(market.pool.tradingFee))
          //   .multipliedBy(new BigNumber(10 ** market.fromChain.decimals));
          // const maxPrice = new BigNumber(market.pool.maxPrice)
          //   .plus(new BigNumber(market.pool.tradingFee))
          //   .multipliedBy(new BigNumber(10 ** market.fromChain.decimals));
          // if () {
          //   // txData.status = 5;
          // }
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
  // MQ
  try {
    const mqList = upsertList.filter(item => item.side == 0);
    if (mqList.length) {
      const rbmq = new RabbitMq(ctx);
      await rbmq.publish(mqList);
    }
  } catch (e: any) {
    console.log("RabbitMQ error", e.message);
  }

  for (const row of upsertList) {
    try {
      const [newTx, created] = await ctx.models.Transaction.findOrCreate({
        defaults: row,
        attributes: ["id", "hash", "status", "expectValue"],
        where: {
          hash: row.hash,
        },
      });
      if (!created) {
        if (![0, 1].includes(row.status)) {
          newTx.status = row.status;
          await newTx.save();
        }
      }
      row.id = newTx.id;
    } catch (error: any) {
      console.log(row);
      ctx.logger.error("processSubTx error:", error);
      throw error;
    }
  }
  return upsertList;
}

async function handleXVMTx(ctx: Context, txData: Partial<Transaction>, txExtra: any, saveExtra: any, upsertList: Array<InferCreationAttributes<Transaction>>) {
  saveExtra.xvm = txExtra.xvm;
  const { name, params } = txExtra.xvm;
  txData.value = params.value;
  // params:{maker,token,value,data:[toChainId, t2Address, toWalletAddress, expectValue]}
  if (name.toLowerCase() === "swap" && params?.data && params.data.length >= 3) {
    txData.memo = String(+params.data[0]);
    const toToken = saveExtra.toToken = params.data[1];
    if (params.data.length > 4) {
      saveExtra.rate = +params.data[4];
    }
    const fromChainId = Number(txData.chainId);
    const toChainId = Number(txData.memo);
    // xvm check
    const toChainInfo: { target: ITarget, toChain: IToChain } = getXVMContractToChainInfo(fromChainId, toChainId, <string>txData.tokenAddress, toToken);
    if (!toChainInfo?.toChain) {
      txData.status = 3;
      return;
    }
    const market = ctx.makerConfigs.find(
      m =>
        equals(m.fromChain.id, fromChainId) &&
        equals(m.toChain.id, toChainId) &&
        equals(m.recipient, String(params.maker)) &&
        equals(m.fromChain.symbol, String(txData.symbol)) &&
        equals(m.fromChain.tokenAddress, String(txData.tokenAddress)) &&
        dayjs(txData.timestamp).unix() >= m.times[0] &&
        dayjs(txData.timestamp).unix() <= m.times[1],
    );
    if (!market) {
      // market not found
      txData.status = 3;
    } else {
      // valid timestamp
      txData.lpId = market.id || null;
      txData.makerId = market.makerId || null;
      // ebc
      saveExtra["ebcId"] = market.ebcId;
      txData.replySender = market.sender;
      // user send
      txData.side = 0;
      txData.replyAccount = String(params.data[2]);
      txData.transferId = TransferIdV2(
        String(txData.chainId),
        String(txData.from),
        String(txData.nonce),
      );
      const amount = String(
        await calcMakerSendAmount(ctx.makerConfigs, txData as any),
      );
      // cross coin
      const { target, toChain } = toChainInfo;
      if (target.symbol !== toChain.symbol) {
        const fromPrecision = target.precision;
        const toPrecision = toChain.precision;
        const expectValue = (new BigNumber(amount)).dividedBy(10 ** fromPrecision).multipliedBy(10 ** toPrecision);
        txData.expectValue = (await exchangeToCoin(expectValue, target.symbol, toChain.symbol)).toFixed(0);
        console.log(`FE expectValue: ${+params.data[3]},maker expectValue: ${txData.expectValue}`);
      } else {
        txData.expectValue = amount;
      }
    }
  } else if (name.toLowerCase() === "swapok" || name.toLowerCase() === "swapfail") {
    txData.side = 1;
    // params:{tradeId,token,to,value}
    const userTx = await ctx.models.Transaction.findOne(<any>{
      attributes: ["id", "hash", "status"],
      where: {
        hash: params.tradeId,
      },
    });
    if (name.toLowerCase() === "swapfail") {
      txData.status = 4;
    }
    if (userTx) {
      console.log("get userTx ...");
      txData.memo = String(userTx.chainId);
      txData.transferId = TransferIdV2(
        String(userTx.chainId),
        String(userTx.from),
        String(userTx.nonce),
      );
      if (name.toLowerCase() === "swapfail") {
        userTx.status = 4;
        upsertList.push(userTx);
      }
    }
  }
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

export async function exchangeToCoin(value: any, sourceCurrency: any, toCurrency: any) {
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
  console.log(`${sourceCurrency} fromRate`, fromRate, `${toCurrency} toRate`, toRate);
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
  const market = makerConfigs.find(
    m =>
      equals(m.fromChain.id, String(fromChainId)) &&
      equals(m.toChain.id, String(toChainId)) &&
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
      market.pool,
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
    // const userTx = await ctx.models.Transaction.findOne({
    //   attributes: [
    //     "id",
    //     "hash",
    //     "transferId",
    //     "chainId",
    //     "from",
    //     "to",
    //     "tokenAddress",
    //     "nonce",
    //     "status",
    //     "timestamp",
    //     "value",
    //     "expectValue",
    //     "memo",
    //     "symbol",
    //     "makerId",
    //     "lpId",
    //     "replySender",
    //     "replyAccount",
    //   ],
    //   where: {
    //     hash,
    //     // status: 1,
    //     side: 0,
    //   },
    //   include: [
    //     {
    //       required: false,
    //       attributes: ["id", "inId", "outId"],
    //       model: ctx.models.MakerTransaction,
    //       as: "maker_transaction",
    //     },
    //   ],
    //   transaction: t,
    // });
    if (!userTx || isEmpty(userTx.id)) {
      throw new Error("Missing Id Or Transaction does not exist");
    }
    if (!userTx || isEmpty(userTx.transferId)) {
      throw new Error("Missing transferId Or Transaction does not exist");
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
    if (userTx.status != 1 && userTx.status != 0) {
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
      status: [0, 1],
      side: 1,
      timestamp: {
        [Op.gte]: dayjs(userTx.timestamp).subtract(5, "m").toDate(),
      },
    };
    // Because of the delay of starknet network, the time will be longer if it is starknet
    if ([4, 44].includes(fromChainId)) {
      where.timestamp = {
        [Op.gte]: dayjs(userTx.timestamp).subtract(180, "m").toDate(),
      };
    }
    const makerSendTx = await ctx.models.Transaction.findOne({
      attributes: ["id", "timestamp"],
      where,
      order: [["timestamp", "asc"]],
      transaction: t,
      // include: [{
      //   required: false,
      //   attributes: ['id', 'inId', 'outId'],
      //   model: ctx.models.MakerTransaction,
      //   as: 'out_maker_transaction'
      // }]
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
      if (delayMin > maxReceiptTime) {
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

export async function quickMatchSuccess(
  ctx: Context,
  inId: number,
  outId: number,
  _transferId: string,
) {
  const outTx = await ctx.models.Transaction.findOne({
    attributes: ["id", "status"],
    where: {
      status: [0, 1],
      id: outId,
    },
  });
  if (!outTx) {
    return {
      inId,
      outId: null,
      errmsg: `No quick matching transactions found ${outId}`,
    };
  }
  const rows = await ctx.models.MakerTransaction.update(
    {
      outId: outId,
    },
    {
      where: {
        inId: inId,
        outId: null,
      },
    },
  );
  if (rows.length == 1) {
    return {
      inId,
      outId,
      errmsg: "ok",
    };
  } else {
    return {
      inId,
      outId,
      errmsg: "fail",
    };
  }
}

export async function processMakerSendUserTx(
  ctx: Context,
  makerTx: Transaction,
  isCross?: boolean,
) {
  const t = await ctx.models.sequelize.transaction();
  try {
    // const makerTx = await ctx.models.Transaction.findOne({
    //   attributes: [
    //     "id",
    //     "transferId",
    //     "chainId",
    //     "status",
    //     "timestamp",
    //     "value",
    //     "memo",
    //     "symbol",
    //     "replySender",
    //     "replyAccount",
    //   ],
    //   where: {
    //     hash,
    //     // status: 1,
    //     side: 1,
    //   },
    //   transaction: t,
    //   include: [
    //     {
    //       required: false,
    //       attributes: ["id", "inId", "outId"],
    //       model: ctx.models.MakerTransaction,
    //       as: "out_maker_transaction",
    //     },
    //   ],
    // });
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
    let where: any = {
      transferId: makerTx.transferId,
      status: 1,
      side: 0,
      timestamp: {
        [Op.lte]: dayjs(makerTx.timestamp).add(5, "m").toDate(),
      },
    };
    if (isCross) {
      where = {
        memo: makerTx.chainId,
        // nonce: trx.memo,
        symbol: makerTx.symbol,
        replyAccount: makerTx.replyAccount,
        replySender: "",
        expectValue: {
          [Op.gte]: makerTx.value,
          [Op.lte]: new BigNumber(makerTx.value).plus(9000).toFixed(),
        },
        status: 1,
        side: 0,
        timestamp: {
          [Op.lte]: dayjs(makerTx.timestamp).add(5, "m").toDate(),
        },
      };
      for (const addr1 in ctx.config.crossAddressTransferMap) {
        if (
          equals(
            ctx.config.crossAddressTransferMap[addr1],
            String(makerTx.replySender),
          )
        ) {
          where.replySender = addr1;
          break;
        }
      }
      if (equals(where.replySender, makerTx.replySender)) {
        throw new Error("Multi address collection mapping is not configured");
      }
    }
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
