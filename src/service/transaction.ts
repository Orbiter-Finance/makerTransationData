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
  getAccountAddressError,
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
  const isOrbiterX = tx.source == "xvm" || tx.extra["xvm"]; // temp
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
export function validMakerAddress(ctx: Context, address: string) {
  const data = ctx.makerConfigs.find(
    row => equals(row.sender, address) || equals(row.recipient, address),
  );
  return !isEmpty(data);
}
export async function bulkCreateTransaction(
  ctx: Context,
  txlist: Array<any>,
): Promise<Array<Transaction>> {
  const upsertList: Array<Transaction> = [];
  for (const row of txlist) {
    try {
      if (!row || upsertList.findIndex(tx => equals(tx.hash, row.hash)) >= 0) {
        continue;
      }
      if (isEmpty(row.symbol)) {
        continue;
      }
      // ctx.logger.info(`processSubTx:${tx.hash}`);
      const chainConfig = chains.getChainInfo(String(row.chainId));
      if (!chainConfig) {
        ctx.logger.error(
          `getChainByInternalId chainId ${row.chainId} not found(${row.hash})`,
          row,
        );
        continue;
      }
      const toToken = chains.getTokenByChain(
        Number(chainConfig.internalId),
        String(row.tokenAddress),
      );
      if (!toToken) {
        ctx.logger.error(
          ` Token Not Found  ${row.chainId} ${row.hash} ${row.tokenAddress}`,
        );
        continue;
      }
      const value: string = new BigNumber(String(row.value)).toFixed();
      if (value.length >= 32) {
        ctx.logger.error(
          `Amount format error ${row.chainId} ${row.hash} ${getFormatDate(
            row.timestamp,
          )}, value = ${value}`,
        );
        continue;
      }
      let memo = getAmountFlag(
        Number(chainConfig.internalId),
        String(row.value),
      );
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
        // makerAddress dydx
        // if (!row.from) {
        //   const makerItem = await ctx.makerConfigs.find(
        //     (row: { toChain: { id: number } }) =>
        //       equals(row.toChain.id, Number(chainConfig.internalId)),
        //   );
        //   row.from = (makerItem && makerItem.sender) || "";
        // }
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
        server: process.env['ServerName']
      };
      const { isToMaker, isToUser, orbiterX, intercept, isToUserCrossAddress } =
        await validateTransactionSpecifications(ctx, row);
      if (intercept) {
        ctx.logger.info(`${txData.hash} intercept isToMaker=${isToMaker}, isToUser=${isToUser},orbiterX=${orbiterX},isToUserCrossAddress=${isToUserCrossAddress}`);
        continue;
      }
      if (!isToUser && !isToMaker && !orbiterX && !isToUserCrossAddress) {
        ctx.logger.info(`MakerTx ${txData.hash} Not Find Maker Address!`);
        continue;
      }
      if (
        validMakerAddress(ctx, String(txData.from)) &&
        validMakerAddress(ctx, String(txData.to))
      ) {
        txData.status = 3;
        txData.extra["reason"] =  "maker";
        upsertList.push(<any>txData);
        continue;
      }
      if (orbiterX) {
        try {
          await handleXVMTx(ctx, txData, txExtra, saveExtra, upsertList);
        } catch (error) {
          ctx.logger.error("handle xvm error", error);
        }
      } else if (isToUser || isToUserCrossAddress) {
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
        txData.replyAccount = txData.from;
        txData.replySender = txData.to;
        if ([99, 9].includes(fromChainId)) {
          const arr = txExtra.memo.split("_");
          if (arr.length > 1) {
            txData.replyAccount = arr[1];
          }
        } else if ([44, 4, 11, 511].includes(fromChainId) && txExtra["ext"]) {
          // dydx contract send
          // starknet contract send
          txData.replyAccount = fix0xPadStartAddress(txExtra["ext"], 42);
        }

        if ([44, 4, 11, 511].includes(toChainId)) {
          const ext = txExtra["ext"] || "";
          saveExtra["ext"] = ext;
          if (isEmpty(ext)) {
            txData.status = 3;
            txData.replyAccount = null;
          } else {
            // 11,511 0x02 first
            // 4, 44 0x03 first
            switch (String(toChainId)) {
              case "11":
              case "511":
                txData.replyAccount = ext.replace("0x02", "0x");
                break;
              case "4":
              case "44":
                txData.replyAccount = ext.replace("0x03", "0x");
                break;
            }
            // txData.replyAccount = `0x${ext.substring(4)}`;
            if ([44, 4].includes(toChainId) && !isEmpty(ext)) {
              txData.replyAccount = fix0xPadStartAddress(txData.replyAccount, 66);
            }
          }
        }
        if (Number(txData.nonce) > 8999 && txData.source!='xvm') {
          txData.status = 3;
          txData.extra['reason'] = 'nonce too high, not allowed';
          upsertList.push(<any>txData);
          continue;
        }
        const market = getMarket(
          ctx,
          fromChainId,
          toChainId,
          String(txData.symbol),
          String(txData.symbol),
          txData.timestamp,
          true,
          String(txData.to)
        );

        const error: string | null = getAccountAddressError(txData.replyAccount, toChainId);
        if (error) {
          ctx.logger.error(`Illegal user starknet address ${txData.replyAccount} hash:${txData.hash}, ${error}`);
        }
        if (!market || isEmpty(txData.replyAccount) || error) {
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
            const calcResultAmount = getAmountToSend(
              Number(fromChainId),
              Number(toChainId),
              txData.value.toString(),
              market,
              txData.nonce,
            )?.tAmount || 0;
            txData.expectValue = new BigNumber(calcResultAmount).toString();
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
      // valid cache status
      const cacheStatus = await ctx.redis.hget(
        "TXHASH_STATUS",
        String(txData.hash),
      );
      if (cacheStatus && Number(cacheStatus) == 99) {
        // ctx.logger.info(
        //   `From Cache ${txData.hash} The transaction status has already been matched`,
        // );
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
            await clearMatchCache(
              ctx,
              Number(txData.chainId),
              Number(txData.memo),
              String(txData.hash),
              "",
              Number(txData.id),
              0,
              txData.transferId,
            );
          } else if (tx.side === 1) {
            await clearMatchCache(
              ctx,
              0,
              Number(txData.chainId),
              "",
              String(txData.hash),
              0,
              Number(txData.id),
              txData.transferId,
            );
          }
          // ctx.logger.info(
          //   `From DB ${txData.hash} The transaction status has already been matched`,
          // );
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
          side: txData.side,
          from: txData.from,
          to: txData.to,
          value: txData.value,
          symbol: txData.symbol,
          extra: txData.extra || {},
          memo: txData.memo,
          replyAccount: txData.replyAccount,
          replySender: txData.replySender,
          expectValue: txData.expectValue,
          transferId: txData.transferId,
        }),
      );
      upsertList.push(<any>txData);
    } catch (error) {
      ctx.logger.error("for handle tx error:", error);
    }
  }
  if (upsertList.length <= 0) {
    return [];
  }
  for (const txData of upsertList) {
    const t = await ctx.models.sequelize.transaction();
    let isPushMQ = false;
    try {
      const [dbData, isCreated] = await ctx.models.Transaction.findOrCreate({
        defaults: txData,
        attributes: ["id", "status"],
        where: {
          hash: txData.hash,
        },
        transaction: t,
      });
      txData.id = dbData.id;
      if (isCreated) {
        const id = dbData.id;
        //
        if (txData.side === 0 && dbData.status === 1) {
          isPushMQ = true;
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
              inId: id,
              fromChain: txData.chainId,
              toChain: Number(txData.memo),
              toAmount: String(txData.expectValue),
              replySender: txData.replySender,
              replyAccount: txData.replyAccount,
            },
            where: {
              transcationId: trxId,
            },
            transaction: t,
          });

        }
      } else {
        if ([0, 2, 3].includes(dbData.status) && dbData.status != txData.status) {
          dbData.status = txData.status;
          ctx.logger.info(`${txData.hash} change status origin status:${dbData.status} nowStatus:${txData.status}`);
          await dbData.save({
            transaction: t,
          });
        }
      }
      if (dbData.status === 1) {
        txSaveCache(ctx, txData).catch(error => {
          ctx.logger.error("txSaveCache error:", error);
        });
      }
      await t.commit();
      // send mq
      if (isPushMQ) {
        messageToOrbiterX(ctx, txData).catch(error => {
          ctx.logger.error("messageToOrbiterX error:", error);
        });
      }
    } catch (error) {
      t && t.rollback();
    }
  }
  return upsertList as any;
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
          side: txData.side,
          chainId: txData.chainId,
          from: txData.from,
          to: txData.to,
          value: txData.value,
          extra: txData.extra || {},
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
          );
          break;
        case 1:
          redisT.zadd(
            `MakerPendingTx:${txData.chainId}`,
            dayjs(txData.timestamp).valueOf(),
            txData.hash,
          );
          break;
      }
      await redisT.exec();
      resolve(true);
    } catch (error) {
      reject(error);
    }
  });
}
async function messageToOrbiterX(ctx: Context, txData: Transaction) {
  if (
    txData.source === 'xvm' &&
    txData.status === 1 &&
    new Date(txData.timestamp).valueOf() > ctx.startTime
  ) {
    ctx.logger.info(`publish MakerWaitTransferMessage ready:${txData.hash}`, txData);
    await ctx.mq
      .publishMakerWaitTransferMessage(txData, String(txData.memo))
      .catch(error => {
        ctx.logger.error(`publish MakerWaitTransferMessage error:`, error);
      }).then(() => {
        ctx.logger.info(`publish MakerWaitTransferMessage success:${txData.hash}`);
      })
  }
}
async function handleXVMTx(
  ctx: Context,
  txData: Partial<Transaction>,
  txExtra: any,
  saveExtra: any,
  _upsertList: Array<InferCreationAttributes<Transaction>>,
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
      false,
      params['recipient']
    );
    if (!market) {
      // market not found
      txData.status = 3;
      ctx.logger.error("Market not found", txData.hash);
    } else {
      txData.lpId = market.id || null;
      txData.makerId = market.makerId || null;
      saveExtra["ebcId"] = market.ebcId;
      saveExtra.toSymbol = market.toChain.symbol;
      txData.side = 0;
      txData.replySender = market.sender;
      txData.replyAccount = decodeData.toWalletAddress;
      if ([44, 4].includes(toChainId) && !isEmpty(txData.replyAccount)) {
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
    // TODO: No association created @Soul
    txData.side = 1;
    const { tradeId, op } = decodeSwapAnswerData(params.data);
    txData.to = params.recipient;
    txData.replyAccount = params.recipient;
    txData.replySender = txData.from;
    // const userTx = await ctx.models.Transaction.findOne(<any>{
    //   // attributes: [
    //   //   "id",
    //   //   "hash",
    //   //   "status",
    //   //   "chainId",
    //   //   "transferId",
    //   //   "replyAccount",
    //   //   "replySender",
    //   //   "side",
    //   // ],
    //   where: {
    //     hash: tradeId,
    //   },
    // });
    if (op == 2) {
      txData.status = 4;
      saveExtra["sendBack"] = {
        fromHash: tradeId,
      };
    }
    // const market = ctx.makerConfigs.find(item =>
    //   equals(item.toChain.tokenAddress, params.token),
    // );
    // if (market) {
    //   saveExtra.toSymbol = market.toChain.symbol;
    // }
    // if (userTx) {
    //   txData.memo = String(userTx.chainId);
    //   txData.transferId = userTx.transferId;
    //   txData.replyAccount = userTx.replyAccount;
    //   txData.replySender = userTx.replySender;
    //   if (op == 2) {
    //     // userTx.status = 4;
    //     // upsertList.push(userTx);
    //   }
    //   if (op == 3) {
    //     // userTx.status = 95;
    //     txData.status = 95;
    //     // upsertList.push(userTx);
    //   }
    // } else {
    //   ctx.logger.error(
    //     `get userTx fail,tradeId:${tradeId}, hash:${txData.hash}`,
    //   );
    // }
  }
}
function getMarket(
  ctx: Context,
  fromChainId: number,
  toChainId: number,
  fromTokenAddress: string,
  toTokenAddress: string,
  timestamp: any,
  isSymbol: boolean,
  maker: string
) {
  if (isSymbol)
    return ctx.makerConfigs.find(
      m =>
        equals(m.fromChain.id, fromChainId) &&
        equals(m.toChain.id, toChainId) &&
        equals(m.fromChain.symbol, fromTokenAddress) &&
        equals(m.toChain.symbol, toTokenAddress) &&
        dayjs(timestamp).unix() >= m.times[0] &&
        dayjs(timestamp).unix() <= m.times[1] &&
        equals(maker, m.recipient)
    );
  return ctx.makerConfigs.find(
    m =>
      equals(m.fromChain.id, fromChainId) &&
      equals(m.toChain.id, toChainId) &&
      equals(m.fromChain.tokenAddress, fromTokenAddress) &&
      equals(m.toChain.tokenAddress, toTokenAddress) &&
      dayjs(timestamp).unix() >= m.times[0] &&
      dayjs(timestamp).unix() <= m.times[1] &&
      (equals(maker, m.recipient) || equals(maker, m.sender))
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
      dayjs(trx.timestamp).unix() <= m.times[1] &&
      equals(trx.to, m.recipient)
  );
  if (!market) {
    return 0;
  }
  const result = getAmountToSend(
    Number(fromChainId),
    Number(toChainId),
    trx.value.toString(),
    market,
    trx.nonce,
  )?.tAmount;
  return result || 0;
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

  if (isNaN(Number(userTx.expectValue)) || userTx.expectValue == "" || userTx.expectValue === null) {
    return {
      data: userTx.expectValue,
      errmsg: "User Tx expectValue zero",
    };
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
      toAmount: String(userTx.expectValue || 0),
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
      const response = await ctx.models.Transaction.update(
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
      if (response[0] != 2) {
        throw new Error('processUserSendMakerTx update rows fail')
      }
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
  // const { intercept } = await validateTransactionSpecifications(
  //   ctx,
  //   makerTx as any,
  // );
  // if (intercept) {
  //   return {
  //     errmsg: `MakerTx ${makerTx.hash} Not Find Maker Address`,
  //   };
  // }
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
      await clearMatchCache(
        ctx,
        0,
        makerTx.chainId,
        "",
        makerTx.hash,
        relInOut.inId,
        makerTx.id,
      );
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
    let where: any = {
      transferId: makerTx.transferId,
      status: [1, 95, 96, 97],
      side: 0,
      timestamp: {
        [Op.gte]: dayjs(makerTx.timestamp).subtract(7, "day").toDate(),
        [Op.lte]: dayjs(makerTx.timestamp).add(2, "hour").toDate(),
      },
    };
    if (makerTx.source == "xvm") {
      try {
        const extra: any = makerTx.extra;
        const { tradeId } = decodeSwapAnswerData(extra?.xvm?.params?.data);
        where = {
          hash: tradeId,
        };
      } catch (e: any) {
        return {
          errmsg: `Orbiter X decode fail ${makerTx.hash} ${e.message}`,
        };
      }
    } else {
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
      replySender: makerTx.from,
      replyAccount: makerTx.to,
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
    // await userSendTx.save({
    //   transaction: t,
    // });
    const updateRes = await ctx.models.Transaction.update(
      {
        status: upStatus,
        lpId: userSendTx.lpId,
        makerId: userSendTx.makerId,
      },
      {
        where: {
          id: {
            [Op.in]: [userSendTx.id, makerTx.id]
          },
        },
        transaction: t,
      },
    );
    if (updateRes[0] != 2) {
      throw new Error('processMakerSendUserTx update rows fail');
    }
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
      await clearMatchCache(
        ctx,
        userSendTx.chainId,
        makerTx.chainId,
        userSendTx.hash,
        makerTx.hash,
        userSendTx.id,
        makerTx.id,
      );
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
  const maxScore = dayjs().valueOf(),
    minScore = dayjs().subtract(10, "m").valueOf();
  const hashList = await ctx.redis.zrevrangebyscore(
    `MakerPendingTx:${chain}`,
    maxScore,
    minScore,
  );
  const processHandleHash = async (hash: string) => {
    try {
      const makerTx: any = await ctx.redis
        .hget(`TX:${chain}`, hash)
        .then(tx => tx && JSON.parse(tx));

      if (!makerTx || makerTx.side != 1) {
        return;
      }
      if (makerTx.extra && makerTx.extra["xvm"]) {
        if (makerTx.extra["xvm"]["name"] === "swapAnswer") {
          //
          await processMakerSendUserTx(ctx, makerTx.hash);
        }
      }
      const userHash: string = await ctx.redis
        .hget(`UserPendingTx:${makerTx.chainId}`, makerTx.transferId)
        .then(str => String(str));
      if (isEmpty(userHash)) {
        return;
      }
      const data: string[] = userHash.split("_");
      const userTx = await ctx.redis
        .hget(`TX:${data[1]}`, data[0])
        .then(tx => tx && JSON.parse(tx));
      if (userTx) {
        const isCacheMatch =
          userTx.id &&
          makerTx.id &&
          equals(userTx.memo, makerTx.chainId) &&
          equals(userTx.replyAccount, makerTx.replyAccount) &&
          equals(userTx.transferId, makerTx.transferId);
        // ctx.logger.info(`match find isCacheMatch ${isCacheMatch}`, {
        //   userTx,
        //   makerTx,
        // });
        if (isCacheMatch) {
          //
          const inId = userTx.id;
          const outId = makerTx.id;
          const inHash = userTx.hash;
          const outHash = makerTx.hash;
          const findUserTx = await ctx.models.Transaction.findOne({
            raw: true,
            attributes: ["id", "status"],
            where: {
              hash: inHash,
            },
          });
          if (!findUserTx?.id) {
            ctx.logger.error(`cache match success not find user tx ${inHash}`);
            return;
          }
          if (findUserTx.status === 99) {
            await clearMatchCache(
              ctx,
              userTx.chainId,
              makerTx.chainId,
              inHash,
              outHash,
              findUserTx.id,
              outId,
            );
            return;
          }
          if (findUserTx?.id != userTx.id) {
            ctx.logger.error(
              `cache match success not find user tx Inconsistent id ${findUserTx.id}!=${inId}`,
            );
            return;
          }
          // change
          if (inId && outId && inHash && outHash) {
            const t = await ctx.models.sequelize.transaction();
            try {
              const rows = await ctx.models.MakerTransaction.update(
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
              if (rows[0] != 1) {
                // clear
                await clearMatchCache(
                  ctx,
                  userTx.chainId,
                  makerTx.chainId,
                  inHash,
                  outHash,
                  inId,
                  outId,
                );
                throw new Error(
                  `cache match update MakerTransaction fail  ${inId}-${outId}`,
                );
              }
              const response = await ctx.models.Transaction.update(
                {
                  status: 99,
                },
                {
                  where: {
                    // hash: [inHash, outHash],
                    status: {
                      [Op.not]: 99,
                    },
                    id: [inId, outId],
                  },
                  transaction: t,
                },
              );
              if (response[0] != 2) {
                throw new Error(
                  `Failed to modify the number of matching record rows ${inId}-${outId}`,
                );
              }
              await t.commit();
              ctx.logger.info(
                `cache match success inID:${inId}, outID:${outId}, inHash:${inHash}, outHash:${outHash}`,
              );
              await clearMatchCache(
                ctx,
                userTx.chainId,
                makerTx.chainId,
                inHash,
                outHash,
                inId,
                outId,
              );
            } catch (error) {
              await t.rollback();
              ctx.logger.error("Memory matching exception", error);
            }
          }
        } else {
          // await processMakerSendUserTx(ctx, makerTx.hash);
        }
      }
    } catch (error) {
      ctx.logger.error(
        `chain:${chain}, hash:${hash}, processMakerSendUserTxFromCache error`,
        error,
      );
    }
  };
  hashList.reverse().forEach(processHandleHash);
}
export async function clearMatchCache(
  ctx: Context,
  fromChain: number,
  toChainId: number,
  inHash: string,
  outHash: string,
  inId: number,
  outId: number,
  transferId?: string,
) {
  // const user transferId
  const redisT = ctx.redis.multi();
  if (fromChain) {
    const userTx = await ctx.redis.hget(`TX:${fromChain}`, inHash).then(res => {
      return res && JSON.parse(res);
    });
    if (userTx && userTx.transferId) {
      redisT.hdel(`UserPendingTx:${toChainId}`, userTx.transferId);
    }
  }
  if (toChainId && transferId) {
    redisT.hdel(`UserPendingTx:${toChainId}`, transferId);
  }
  const TXHASH_STATUS = [];
  if (inHash) TXHASH_STATUS.push(inHash, 99);
  if (outHash) {
    TXHASH_STATUS.push(outHash, 99);
    if (toChainId) {
      redisT.zrem(`MakerPendingTx:${toChainId}`, outHash);
    }
  }
  const TXID_STATUS = [];
  if (inId) TXID_STATUS.push(inId, 99);
  if (outId) TXID_STATUS.push(outId, 99);
  redisT
    .hmset(`TXHASH_STATUS`, TXHASH_STATUS)
    .hmset(`TXID_STATUS`, TXID_STATUS);
  await redisT.exec().catch(error => {
    ctx.logger.error("clearMatchCache erorr", error);
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
