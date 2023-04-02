import { Transaction } from "./../models/Transactions";
import { MakerTransaction } from "../models/MakerTransaction";
import dayjs from "dayjs";
import { chains } from "orbiter-chaincore";
import { ITransaction, TransactionStatus } from "orbiter-chaincore/src/types";
import { dydx } from "orbiter-chaincore/src/utils";
import BigNumber from "bignumber.js";
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
import RLP from "rlp";
import { ethers } from "ethers";
import sequelize from "sequelize";
export async function validateTransactionSpecifications(
  ctx: Context,
  tx: ITransaction,
) {
  const isOrbiterX = tx.source == "xvm"; // temp
  const result = {
    orbiterX: false,
    isToMaker: false,
    isToUser: false,
    intercept: true,
    isToUserCrossAddress: false,
  };
  if (isOrbiterX) {
    result.orbiterX = true;
  }
  const isMakerSend = !!ctx.makerConfigs.find(
    item =>
      equals(item.sender, tx.from) ||
      equals(item.crossAddress?.sender, tx.from),
  );
  if (isMakerSend) {
    result.isToUser = true;
  }
  if (
    Object.values(ctx.config.crossAddressTransferMap).includes(
      tx.from.toLocaleLowerCase(),
    )
  ) {
    result.isToUserCrossAddress = true;
  }
  const isUserSend = !!ctx.makerConfigs.find(
    item =>
      equals(item.recipient, tx.to) ||
      equals(item.crossAddress?.recipient, tx.to),
  );
  if (isUserSend) {
    result.isToMaker = true;
  }
  if (
    result.isToMaker ||
    result.isToUser ||
    result.orbiterX ||
    result.isToUserCrossAddress
  ) {
    result.intercept = false;
  }
  return result;
}
export async function processSubTxList(
  ctx: Context,
  txlist: Array<ITransaction>,
) {
  const saveTxList = await bulkCreateTransaction(ctx, txlist);
  return saveTxList;
}
export function generateChangeID(tx: Transaction) {
  const id = `${tx.chainId}${tx.hash}${tx.status}${tx.transferId}`;
  return id;
}
export async function bulkCreateTransaction(
  ctx: Context,
  txlist: Array<any>,
): Promise<Array<Transaction>> {
  const upsertList: Array<InferCreationAttributes<Transaction>> = [];
  for (const row of txlist) {
    if (!row) {
      continue;
    }
    // ctx.logger.info(`processSubTx:${tx.hash}`);
    const chainConfig = chains.getChainInfo(String(row.chainId));
    if (!chainConfig) {
      ctx.logger.error(`getChainByInternalId chainId ${row.chainId} not found(${row.hash})`, row);
      continue;
    }
    if (
      chainConfig.tokens.findIndex(row =>
        equals(row.address, String(row.address)),
      ) < 0
    ) {
      ctx.logger.error(
        ` Token Not Found ${row.tokenAddress} ${row.chainId} ${row.hash
        } ${getFormatDate(row.timestamp)}`,
      );
      continue;
    }
    const value: string = new BigNumber(String(row.value)).toFixed();
    if (value.length >= 32) {
      ctx.logger.error(
        `Amount format error ${row.chainId} ${row.hash} ${getFormatDate(
          row.timestamp,
        )}`,
      );
      continue;
    }
    let memo = getAmountFlag(Number(chainConfig.internalId), String(row.value));
    const txExtra = row.extra || {};
    if (["9", "99"].includes(chainConfig.internalId) && txExtra) {
      const arr = txExtra.memo.split("_");
      memo = String(+arr[0] % 9000);
    } else if (
      ["11", "511"].includes(chainConfig.internalId) &&
      txExtra["type"] === "TRANSFER_OUT"
    ) {
      if (!row.to) {
        row.to = dydx.getEthereumAddressFromClientId(txExtra["clientId"]);
      }
      // makerAddress
      if (!row.from) {
        const makerItem = await ctx.makerConfigs.find(
          (row: { toChain: { id: number } }) =>
            equals(row.toChain.id, Number(chainConfig.internalId)),
        );
        row.from = (makerItem && makerItem.sender) || "";
      }
    }
    const txData: Partial<Transaction> = {
      hash: row.hash.toLowerCase(),
      nonce: String(row.nonce),
      blockHash: row.blockHash,
      blockNumber: row.blockNumber,
      transactionIndex: row.transactionIndex,
      from: row.from,
      to: row.to,
      value,
      symbol: row.symbol,
      gasPrice: row.gasPrice,
      gas: row.gas,
      input: row.input != "0x" ? row.input : undefined,
      status: row.status,
      tokenAddress: row.tokenAddress || "",
      timestamp: dayjs(row.timestamp * 1000)
        .utc()
        .toDate(),
      fee: String(row.fee),
      feeToken: row.feeToken,
      chainId: Number(chainConfig.internalId),
      source: row.source,
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
    const { isToMaker, isToUser, orbiterX, intercept, isToUserCrossAddress } =
      await validateTransactionSpecifications(ctx, row);
    if (intercept) {
      ctx.logger.info(`${txData.hash} intercept`);
      continue;
    }
    if (!isToUser && !isToMaker && !orbiterX && !isToUserCrossAddress) {
      ctx.logger.info(`MakerTx ${txData.hash} Not Find Maker Address!`);
      continue;
    }
    if (isToUser || isToUserCrossAddress) {
      txData.side = 1;
      // maker send
      txData.replyAccount = txData.to;
      txData.replySender = row.from;
      txData.transferId = TranferId(
        String(txData.chainId),
        String(txData.replySender),
        String(txData.replyAccount),
        String(txData.memo),
        String(txData.symbol),
        String(txData.value),
      );
      saveExtra.toSymbol = txData.symbol;
    } else if (isToMaker) {
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

    if (orbiterX) {
      try {
        await handleXVMTx(ctx, txData, txExtra, saveExtra, upsertList);
      } catch (error) {
        ctx.logger.error("handle xvm error", error);
      }
    }
    // valid cache status
    const cacheStatus = await ctx.redis.hget(
      "TXHASH_STATUS",
      String(txData.hash),
    );
    if (cacheStatus && Number(cacheStatus) == 99) {
      ctx.logger.info(
        `From Cache ${txData.hash} The transaction status has already been matched`,
      );
      continue;
    }
    // valid status
    const tx = await ctx.models.Transaction.findOne({
      attributes: ["id", "status"],
      where: {
        hash: txData.hash,
      },
    });
    if (tx) {
      // status:0=PENDING,1=COMPLETE,2=REJECT,3=MatchFailed,4=refund,5=timers not match,99= MatchSuccess,98=makerDelayTransfer
      if (tx.status === 99) {
        // save
        if (tx.side === 0) {
          await ctx.redis
            .multi()
            .hset("TXHASH_STATUS", String(txData.hash), 99)
            .hdel(`UserPendingTx:${txData.memo}`, String(txData.transferId))
            .exec();
        } else {
          await ctx.redis
            .multi()
            .hset("TXHASH_STATUS", String(txData.hash), 99)
            .zrem(`MakerPendingTx:${txData.chainId}`, String(txData.hash))
            .exec();
        }

        ctx.logger.info(
          `From DB ${txData.hash} The transaction status has already been matched`,
        );
        continue;
      }
    }
    txData.extra = saveExtra;
    await ctx.redis.hset(
      `TX:${txData.chainId}`,
      String(txData.hash),
      JSON.stringify({
        hash: txData.hash,
        status: txData.status,
        chainId: txData.chainId,
        from: txData.from,
        to: txData.to,
        value: txData.value,
        symbol: txData.symbol,
        memo: txData.memo,
        replyAccount: txData.replyAccount,
        replySender: txData.replySender,
        expectValue: txData.expectValue,
        transferId: txData.transferId,
      }),
    );
    upsertList.push(<any>txData);
  }

  const options: any = {
    updateOnDuplicate: [
      "replyAccount",
      "replySender",
      "expectValue",
      "extra",
      "memo",
      "source",
      "fee",
    ],
    returning: true,
  };
  const t = await ctx.models.sequelize.transaction();
  try {
    const recordList = await ctx.models.Transaction.bulkCreate(
      upsertList,
      {
        ...options,
        transaction: t
      },

    );
    for (const txData of recordList) {
      // save
      if (txData.status == 3 || txData.status != 1) {
        continue;
      }
      if (txData.status === 1) {
        await txSaveCache(ctx, txData).catch(error => {
          ctx.logger.error('txSaveCache error:', error);
        })
      }
      const id = txData.get("id");
      txData.id = id;
      if (id) {
        // create 
        await messageToOrbiterX(ctx, txData).catch(error => {
          ctx.logger.error('messageToOrbiterX error:', error);
        })
        if (txData.side === 0) {
          // maker trx
          const trxId = TransactionID(
            String(txData.from),
            txData.chainId,
            txData.nonce,
            txData.symbol,
            dayjs(txData.timestamp).valueOf(),
          );
          await ctx.models.MakerTransaction.findOrCreate({
            defaults: {
              transcationId: trxId,
              inId: txData.id,
              fromChain: txData.chainId,
              toChain: Number(txData.memo),
              toAmount: String(txData.expectValue),
              replySender: txData.replySender,
              replyAccount: txData.replyAccount,
            },
            transaction: t,
            where: {
              transcationId: trxId,
            }
          });
        }
      }
    }
    await t.commit();
    return recordList;
  } catch (error) {
    await t.rollback();
    throw error;
  }
}
function txSaveCache(ctx: Context, txData: Transaction) {
  return new Promise(async (resolve, reject) => {
    const redisT = ctx.redis.multi();
    if (txData.id) {
      redisT.hset(
        `TX:${txData.chainId}`,
        String(txData.hash),
        JSON.stringify({
          id: txData.id,
          hash: txData.hash,
          status: txData.status,
          chainId: txData.chainId,
          from: txData.from,
          to: txData.to,
          value: txData.value,
          symbol: txData.symbol,
          memo: txData.memo,
          replyAccount: txData.replyAccount,
          replySender: txData.replySender,
          expectValue: txData.expectValue,
          transferId: txData.transferId,
        }),
      );
    }
    try {
      switch (txData.side) {
        case 0:
          redisT.hset(
            `UserPendingTx:${txData.memo}`,
            txData.transferId,
            `${txData.hash}_${txData.chainId}`,
          )
          break;
        case 1:
          redisT.zadd(
            `MakerPendingTx:${txData.chainId}`,
            dayjs(txData.timestamp).valueOf(),
            txData.hash,
          )
          break;
      }
      await redisT.exec()
      resolve(true);
    } catch (error) {
      reject(error);
    }
  })
}
async function messageToOrbiterX(ctx: Context, txData: Transaction) {
  if (txData.source === "xvm" && txData.side === 0 && new Date(txData.timestamp).valueOf() > ctx.startTime) {
    // push
    const producer = await ctx.mq.createProducer({
      exchangeName: "MakerTxList",
      exchangeType: "direct",
      queueName: `MakerTxList:${txData.chainId}`,
      routingKey: String(txData.chainId),
    });
    producer.publish(txData, String(txData.chainId));
  }
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
    const decodeData = decodeSwapData(params.data);
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
      txData.expectValue = decodeData.expectValue;
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
    txData.side = 1;
    const { tradeId, op } = decodeSwapAnswerData(params.data);
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

function decodeSwapData(data: string): {
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

function decodeSwapAnswerData(data: string): {
  tradeId: string;
  op: number;
} {
  const dataDecode: any = RLP.decode(data);
  const tradeId = Buffer.from(dataDecode[0]).toString();
  const op = Number(Buffer.from(dataDecode[1]).toString());
  return { tradeId, op };
}

export async function calcMakerSendAmount(
  makerConfigs: Array<any>,
  trx: Transaction,
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
  userTx: Transaction | string,
) {
  if (typeof userTx === "string") {
    const record = await ctx.models.Transaction.findOne({
      raw: true,
      attributes: { exclude: ["input", "blockHash", "transactionIndex"] },
      where: {
        hash: userTx,
      },
    });
    if (!record || !record.id) {
      return {
        data: userTx,
        errmsg: "User Tx Not Found",
      };
    }
    userTx = record;
  }
  // const transferId = TranferId(
  //   String(userTx.memo),
  //   String(userTx.replySender),
  //   String(userTx.replyAccount),
  //   String(userTx.nonce),
  //   String(userTx.symbol),
  //   String(userTx.expectValue),
  // );
  // if (transferId != userTx.transferId) {
  //   // await ctx.models.Transaction.update({
  //   //   transferId
  //   // }, {
  //   //   where: {
  //   //     id: userTx.id
  //   //   }
  //   // })
  //   // userTx.transferId = transferId;
  // }

  let t: sequelize.Transaction | undefined;
  try {
    if (!userTx || isEmpty(userTx.id)) {
      throw new Error("Missing Id Or Transaction does not exist");
    }
    const relInOut = (<any>userTx)["maker_transaction"];
    if (relInOut && relInOut.inId && relInOut.outId) {
      ctx.logger.error(`UserTx %s Already matched`, userTx.hash);
      try {
        await ctx.redis
          .multi()
          .hmset(`TXHASH_STATUS`, [userTx.hash, 99])
          .hmset(`TXID_STATUS`, [relInOut.inId, 99, relInOut.outId, 99])
          .hdel(`UserPendingTx:${userTx.memo}`, userTx.transferId)
          .exec();
      } catch (error) {
        ctx.logger.error(
          `UserTx %s Already matched Change Redis error`,
          userTx.hash,
          error,
        );
      }

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
      return {
        errmsg: `${userTx.hash} Current status cannot match`,
      };
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
    // const transferId1 = TranferId(
    //   String(userTx.memo),
    //   String(userTx.replySender),
    //   String(userTx.replyAccount),
    //   String(userTx.nonce),
    //   String(userTx.symbol),
    //   String(userTx.expectValue),
    // );
    // const transferId2 = TranferId(
    //   String(userTx.memo),
    //   String(userTx.to),
    //   String(userTx.replyAccount),
    //   String(userTx.nonce),
    //   String(userTx.symbol),
    //   String(userTx.expectValue),
    // );
    const where = {
      status: [0, 1, 95],
      side: 1,
      transferId: userTx.transferId,
      timestamp: {
        [Op.gte]: dayjs(userTx.timestamp)
          .subtract(60 * 6, "m")
          .toDate(),
      },
    };
    // Because of the delay of starknet network, the time will be longer if it is starknet
    if ([4, 44].includes(fromChainId)) {
      where.timestamp = {
        [Op.gte]: dayjs(userTx.timestamp).subtract(30, "minute").toDate(),
      };
    }
    t = await ctx.models.sequelize.transaction();
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
    // TAG:
    if (makerSendTx && makerSendTx.id) {
      upsertData.outId = makerSendTx.id;
      let upStatus = 99;
      if (makerSendTx.status === 95) {
        upStatus = 95;
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
            id: [userTx.id, makerSendTx.id],
          },
          transaction: t,
        },
      );
      await ctx.redis
        .multi()
        .hmset(`TXHASH_STATUS`, [userTx.hash, 99, makerSendTx.hash, 99])
        .hmset(`TXID_STATUS`, [userTx.id, 99, makerSendTx.id, 99])
        .exec();
    }
    await ctx.models.MakerTransaction.upsert(<any>upsertData, {
      transaction: t,
    });
    await t.commit();
    return { inId: userTx.id, outId: makerSendTx?.id, code: 0 };
  } catch (error) {
    if (t) {
      await t.rollback();
    }
    ctx.logger.error("processUserSendMakerTx error", error);
  }
}

export async function processMakerSendUserTx(
  ctx: Context,
  makerTx: Transaction | string,
) {
  if (typeof makerTx === "string") {
    const record = await ctx.models.Transaction.findOne({
      raw: true,
      attributes: { exclude: ["input", "blockHash", "transactionIndex"] },
      where: {
        hash: makerTx,
      },
    });
    if (!record || !record.id) {
      return {
        data: makerTx,
        outId: null,
      };
    }
    makerTx = record;
  }
  const { intercept } = await validateTransactionSpecifications(
    ctx,
    makerTx as any,
  );
  if (intercept) {
    return {
      errmsg: `MakerTx ${makerTx.hash} Not Find Maker Address`,
    };
  }

  let t: sequelize.Transaction | undefined;
  try {
    if (!makerTx || isEmpty(makerTx.id)) {
      return {
        errmsg: "Missing Id Or Transaction does not exist",
      };
    }

    // makerTx.transferId = transferId;
    if (!makerTx || isEmpty(makerTx.transferId)) {
      const transferId = TranferId(
        String(makerTx.chainId),
        String(makerTx.replySender),
        String(makerTx.replyAccount),
        String(makerTx.memo),
        String(makerTx.symbol),
        String(makerTx.value),
      );
      makerTx.transferId = transferId;
      // return {
      //   errmsg: "Missing transferId Or Transaction does not exist",
      // };
    }
    const relInOut = (<any>makerTx)["out_maker_transaction"];
    if (relInOut && relInOut.inId && relInOut.outId) {
      ctx.logger.error(`MakerTx %s Already matched`, relInOut.hash);
      // clear
      await ctx.redis
        .multi()
        .hmset(`TXHASH_STATUS`, [makerTx.hash, 99])
        .hmset(`TXID_STATUS`, [relInOut.inId, 99, relInOut.outId, 99])
        .zrem(`MakerPendingTx:${makerTx.chainId}`, makerTx.hash)
        .hdel(`UserPendingTx:${makerTx.chainId}`, makerTx.transferId)
        .exec()
        .catch(error => {
          ctx.logger.error(
            "processMakerSendUserTxFromCache remove cache erorr",
            error,
          );
        });
      return {
        inId: relInOut.inId,
        outId: relInOut.outId,
        errmsg: "MakerTx Already matched",
      };
    }
    if (makerTx.status != 1 && makerTx.status != 95) {
      return {
        errmsg: `${makerTx.hash} Current status cannot match`,
      };
    }

    const models = ctx.models;
    const where: any = {
      transferId: makerTx.transferId,
      status: [1, 95, 96, 97],
      side: 0,
      timestamp: {
        [Op.lte]: dayjs(makerTx.timestamp).add(1, "hour").toDate(),
      },
    };
    if (
      Object.values(ctx.config.crossAddressTransferMap).includes(makerTx.from)
    ) {
      const crossAddressTransferMap = ctx.config.crossAddressTransferMap;
      const ids = [makerTx.transferId];
      for (const primaryMaker in crossAddressTransferMap) {
        if (equals(crossAddressTransferMap[primaryMaker], makerTx.from)) {
          // oether maker transfer
          ids.push(
            TranferId(
              String(makerTx.chainId),
              String(primaryMaker),
              String(makerTx.replyAccount),
              String(makerTx.memo),
              String(makerTx.symbol),
              String(makerTx.value),
            ),
          );
        }
      }
      where.transferId = ids;
    }

    if (makerTx.source == "xvm") {
      try {
        const extra: any = makerTx.extra;
        const { tradeId } = decodeSwapAnswerData(extra?.xvm?.params?.data);
        where["hash"] = tradeId;
        delete where["transferId"];
      } catch (e: any) {
        return {
          errmsg: `Orbiter X decode fail ${makerTx.hash} ${e.message}`,
        };
      }
    }
    const userSendTx = await models.Transaction.findOne({
      attributes: [
        "id",
        "from",
        "hash",
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
        outHash: makerTx.hash,
        inHash: null,
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
    if (makerTx.status === 95) {
      upStatus = 95;
    }
    userSendTx.status = upStatus;
    t = await ctx.models.sequelize.transaction();
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
          id: [userSendTx.id, makerTx.id],
        },
        transaction: t,
      },
    );
    await models.MakerTransaction.upsert(<any>upsertData, {
      transaction: t,
    });

    await t.commit();
    if (userSendTx.id && makerTx.id) {
      const inId = userSendTx.id;
      const outId = makerTx.id;
      const outHash = makerTx.hash;
      const inHash = userSendTx.hash;
      ctx.logger.info(
        `db match success inID:${inId}, outID:${outId}, inHash:${inHash}, outHash:${outHash}`,
      );
      await ctx.redis
        .multi()
        .hmset(`TXHASH_STATUS`, [inHash, 99, outHash, 99])
        .hmset(`TXID_STATUS`, [inId, 99, outId, 99])
        .zrem(`MakerPendingTx:${makerTx.chainId}`, outHash)
        .hdel(`UserPendingTx:${makerTx.chainId}`, userSendTx.transferId)
        .exec()
        .catch(error => {
          ctx.logger.error(
            "processMakerSendUserTxFromCache remove cache erorr",
            error,
          );
        });
    }
    return {
      inId: userSendTx.id,
      outId: makerTx.id,
      inHash: userSendTx.hash,
      outHash: makerTx.hash,
      code: 0,
    };
  } catch (error) {
    if (t) {
      await t.rollback();
    }
    ctx.logger.error("processMakerSendUserTx error", error);
    return {
      errmsg: error,
    };
  }
}

export async function processMakerSendUserTxFromCacheByChain(
  ctx: Context,
  chain: string,
) {
  const maxScore = dayjs().valueOf(), minScore = dayjs().subtract(30, 'm').valueOf();
  const hashList = await ctx.redis.zrevrangebyscore(
    `MakerPendingTx:${chain}`,
    maxScore,
    minScore
  );
  const processHandleHash = async (hash: string) => {
    try {
      const makerTx: any = await ctx.redis
        .hget(`TX:${chain}`, hash)
        .then(tx => tx && JSON.parse(tx));
      const transferIdList = [makerTx.transferId];
      for (const primaryMaker in ctx.config.crossAddressTransferMap) {
        if (
          equals(ctx.config.crossAddressTransferMap[primaryMaker], makerTx.from)
        ) {
          // oether maker transfer
          transferIdList.push(
            TranferId(
              String(makerTx.chainId),
              String(primaryMaker),
              String(makerTx.replyAccount),
              String(makerTx.memo),
              String(makerTx.symbol),
              String(makerTx.value),
            ),
          );
        }
      }
      const userHash: string = await ctx.redis
        .hmget(`UserPendingTx:${makerTx.chainId}`, ...transferIdList)
        .then(str => String(str));
      if (isEmpty(userHash)) {
        return;
      }
      const data: string[] = userHash.split("_");
      const userTx = await ctx.redis
        .hget(`TX:${data[1]}`, data[0])
        .then(tx => tx && JSON.parse(tx));
      if (userTx) {
        if (userTx.id && makerTx.id) {
          const inId = userTx.id;
          const outId = makerTx.id;
          const inHash = userTx.hash;
          const outHash = makerTx.hash;
          // change
          if (inId && outId && inHash && outHash) {
            ctx.logger.info(
              `cache match success inID:${inId}, outID:${outId}, inHash:${inHash}, outHash:${outHash}`,
            );
            const t = await ctx.models.sequelize.transaction();
            try {
              await ctx.models.MakerTransaction.update(
                {
                  outId,
                },
                {
                  where: {
                    inId,
                    outId: null,
                  },
                  transaction: t,
                },
              );
              await ctx.models.Transaction.update(
                {
                  status: 99,
                },
                {
                  where: {
                    id: [inId, outId],
                  },
                  transaction: t,
                },
              );
              await t.commit();
            } catch (error) {
              await t.rollback();
            }
            await ctx.redis
              .multi()
              .hmset(`TXHASH_STATUS`, [inHash, 99, outHash, 99])
              .hmset(`TXID_STATUS`, [inId, 99, outId, 99])
              .zrem(`MakerPendingTx:${makerTx.chainId}`, outHash)
              .hdel(`UserPendingTx:${makerTx.chainId}`, userTx.transferId)
              .exec()
              .catch(error => {
                ctx.logger.error(
                  "processMakerSendUserTxFromCache remove cache erorr",
                  error,
                );
              });
          }
        } else {
          await processMakerSendUserTx(ctx, makerTx.hash);
        }
      }
    } catch (error) {
      ctx.logger.error(
        `chain:${chain}, hash:${hash}, processMakerSendUserTxFromCache error`,
        error,
      );
    }
  };
  hashList.forEach(hash => {
    processHandleHash(hash);
  });
}
export async function processMakerSendUserTxFromCache(ctx: Context) {
  const chainList = await chains.getAllChains();
  chainList.forEach(chain => {
    processMakerSendUserTxFromCacheByChain(ctx, chain.internalId).catch(
      error => {
        ctx.logger.error(
          `chain:${chain}, processMakerSendUserTxFromCache for error`,
          error,
        );
      },
    );
  });
}
