import { sleep } from "orbiter-chaincore/src/utils/core";
import { chains, pubSub, ScanChainMain } from "orbiter-chaincore";
import { Transaction } from "orbiter-chaincore/src/types";
import { groupWatchAddressByChain, TranferId } from "../utils";
import { Context } from "../context";

import {
  processUserSendMakerTx,
  processMakerSendUserTxFromCache,
  processMakerSendUserTx,
  bulkCreateTransaction,
  calcMakerSendAmount,
} from "./transaction";
import dayjs from "dayjs";
import { Op, Order, QueryTypes } from "sequelize";
import { getAmountFlag } from "../utils/oldUtils";
import sequelize from "sequelize";
export class Watch {
  constructor(public readonly ctx: Context) { }
  public async saveTxRawToCache(txList: Transaction[]) {
    try {
      if (txList && Array.isArray(txList)) {
        txList.forEach(tx => {
          try {
            const chainConfig = chains.getChainInfo(String(tx.chainId));
            const ymd = dayjs(tx.timestamp * 1000).format("YYYYMM");
            this.ctx.redis
              .multi()
              .zadd(
                `TX_RAW:${chainConfig?.internalId}:hash:${ymd}`,
                dayjs(tx.timestamp * 1000).valueOf(),
                tx.hash,
              )
              .hset(
                `TX_RAW:${chainConfig?.internalId}:${ymd}`,
                tx.hash,
                JSON.stringify(tx),
              )
              .exec();
          } catch (error) {
            this.ctx.logger.error(`pubSub.subscribe error`, error);
          }
        });
      }
    } catch (error) {
      this.ctx.logger.error("saveTxRawToCache error", error);
    }
  }
  public async start() {
    const ctx = this.ctx;
    this.ctx.mq.consumer.consume(async message => {
      try {
        await bulkCreateTransaction(ctx, JSON.parse(message));
        return true;
      } catch (error) {
        this.ctx.logger.error(`Consumption transaction list failed`, error);
        return false;
      }
    });

    try {
      const chainGroup = groupWatchAddressByChain(ctx, ctx.makerConfigs);
      const scanChain = new ScanChainMain(ctx.config.chains);
      for (const id in chainGroup) {
        if (process.env["SingleChain"]) {
          const isScan = process.env["SingleChain"]
            .split(",")
            .includes(String(id));
          if (!isScan) {
            ctx.logger.info(`Single-chain configuration filtering ${id}`);
            continue;
          }
        }
        if (Number(id) % this.ctx.instanceCount !== this.ctx.instanceId) {
          continue;
        }
        ctx.logger.info(
          `Start Subscribe ChainId: ${id}, instanceId:${this.ctx.instanceId}, instances:${this.ctx.instanceCount}`,
        );
        pubSub.subscribe(`${id}:txlist`, async (txList: Transaction[]) => {
          if (txList) {
            try {
              await this.saveTxRawToCache(txList);
              // return await bulkCreateTransaction(ctx, txList);
              return await this.ctx.mq.producer.publish(txList, "");
            } catch (error) {
              await bulkCreateTransaction(ctx, txList).catch(error => {
                ctx.logger.error(
                  `pubSub.subscribe  processSubTxList error:bulkCreateTransaction error`,
                  error,
                );
              });
              ctx.logger.error(
                `pubSub.subscribe  processSubTxList error:`,
                error,
              );
            }
          }
          return true;
        });
        scanChain.startScanChain(id, chainGroup[id]).catch(error => {
          ctx.logger.error(`${id} startScanChain error:`, error);
        });
      }
      pubSub.subscribe("ACCEPTED_ON_L2:4", async (tx: any) => {
        if (tx) {
          try {
            await this.saveTxRawToCache([tx]);
            // return await bulkCreateTransaction(ctx, [tx]);
            return await this.ctx.mq.producer.publish([tx], "");
          } catch (error) {
            ctx.logger.error(
              `${tx.hash} processSubTxList ACCEPTED_ON_L2 error:`,
              error,
            );
            await bulkCreateTransaction(ctx, [tx]);
          }
        }
      });
      process.on("SIGINT", () => {
        scanChain.pause().catch(error => {
          ctx.logger.error("chaincore pause error:", error);
        });
        process.exit(0);
      });
    } catch (error: any) {
      ctx.logger.error("startSub error:", error);
    }
    if (process.env["CACHE_MATCH"] === "1" && this.ctx.instanceId === 0) {
      this.readCacheMakerendReMatch().catch(error => {
        this.ctx.logger.error("readCacheMakerendReMatch error:", error);
      })
    }
    if (process.env["DB_MATCH"] === "1" && this.ctx.instanceId === 0) {
      this.readMakerendReMatch().catch(error => {
        this.ctx.logger.error("readMakerendReMatch error:", error);
      });
    }
    // this.readMakerendReMatch();
    // this.readUserTxReMatchNotCreate();
    // this.regenerateTransferId()
    // this.regenerateTransferId();
    // this.starknetNotNonceReplyMatch();
  }
  //read cache
  public async readCacheMakerendReMatch(): Promise<any> {
    await processMakerSendUserTxFromCache(this.ctx).catch(error => {
      this.ctx.logger.error(
        "setInterval processMakerSendUserTxFromCache error:",
        error,
      );
    });
    await sleep(1000 * 10);
    return await this.readCacheMakerendReMatch();
  }
  // read db
  public async readMakerendReMatch(): Promise<any> {
    await this.readUserTxReMatchNotCreate().catch(error=> {
      this.ctx.logger.error('readUserTxReMatchNotCreate error', error);
    })
    await this.starknetNotNonceReplyMatch().catch(error=> {
      this.ctx.logger.error('starknetNotNonceReplyMatch error', error);
    })
    const startAt = dayjs().subtract(24, "hour").startOf("d").toDate();
    const endAt = dayjs().subtract(120, "second").toDate();
    const where = {
      side: 1,
      status: 1,
      timestamp: {
        [Op.gte]: startAt,
        [Op.lte]: endAt,
      },
    };
    try {
      // read
      let order: Order = [["timestamp", "desc"]];
      if (process.env["ServerName"] === "80C") {
        order = [["timestamp", "asc"]];
      }
      const txList = await this.ctx.models.Transaction.findAll({
        raw: true,
        attributes: {
          exclude: [
            "input",
            "blockHash",
            "transactionIndex",
            "lpId",
            "makerId",
            "gas",
            "gasPrice",
            "fee",
          ],
        },
        order,
        limit: 500,
        where,
      });
      console.log(
        `exec match:${startAt} - ${endAt}, txlist:${JSON.stringify(
          txList.map(row => row.hash),
        )}`,
      );
      let index = 0;
      for (const tx of txList) {
        const result = await processMakerSendUserTx(this.ctx, tx).catch(
          error => {
            this.ctx.logger.error(
              `readMakerendReMatch process total:${txList.length}, id:${tx.id},hash:${tx.hash}`,
              error,
            );
          },
        );
        console.log(
          `readMakerendReMatch index:${index}/${txList.length},hash:${tx.hash}，result:`,
          result,
        );
        index++;
      }
    } catch (error) {
      console.log("error:", error);
      this.ctx.logger.error('readMakerendReMatch error', error);
    } finally {

      await sleep(1000 * 30);
      return await this.readMakerendReMatch();
    }
  }
  public async readUserTxReMatchNotCreate(): Promise<any> {
    const txList: any[] = await this.ctx.models.sequelize.query(
      `select t.* from transaction as t left join maker_transaction as mt on t.id = mt.inId
    where t.side = 0 and inId is null and status = 1 and timestamp>='${dayjs().subtract(30, 'day').format('YYYY-MM-DD HH:mm:ss')}'
    order by t.timestamp desc
    limit 500`,
      {
        type: QueryTypes.SELECT,
        raw: false,
      },
    );
    let index = 0;
    for (const tx of txList) {
      const result = await processUserSendMakerTx(this.ctx, tx).catch(error => {
        this.ctx.logger.error(
          `readDBMatch process total:${txList.length}, id:${tx.id},hash:${tx.hash}`,
          error,
        );
      });
      console.log(
        `readUserTxReMatchNotCreate index:${index}/${txList.length},hash:${tx.hash}，result:`,
        result,
      );
      index++;
    }
  }
  public async readUserTxReMatch(): Promise<any> {
    const startAt = dayjs().subtract(24, "hour").startOf("d").toDate();
    const endAt = dayjs().subtract(10, "s").toDate();
    const where = {
      side: 0,
      status: 1,
      timestamp: {
        [Op.gte]: startAt,
        [Op.lte]: endAt,
      },
    };
    try {
      // read
      const txList = await this.ctx.models.Transaction.findAll({
        raw: true,
        attributes: { exclude: ["input", "blockHash", "transactionIndex"] },
        order: [["timestamp", "desc"]],
        limit: 600,
        where,
      });
      console.log(
        `exec match:${startAt} - ${endAt}, txlist:${JSON.stringify(
          txList.map(row => row.hash),
        )}`,
      );
      let index = 0;
      for (const tx of txList) {
        const result = await processUserSendMakerTx(this.ctx, tx).catch(
          error => {
            this.ctx.logger.error(
              `readDBMatch process total:${txList.length}, id:${tx.id},hash:${tx.hash}`,
              error,
            );
          },
        );
        console.log(
          `readUserTxReMatch index:${index}/${txList.length},hash:${tx.hash}，result:`,
          result,
        );
        index++;
      }
    } catch (error) {
      console.log("error:", error);
    } finally {
      await sleep(1000 * 30);
      return await this.readMakerendReMatch();
    }
  }

  public async regenerateTransferId(): Promise<any> {
    const startAt = dayjs().subtract(72, "hour").startOf("d").toDate();
    const endAt = dayjs().toDate();
    const where = {
      side: 0,
      status: 1,
      // expectValue:null,
      hash: "xxx",
      // id:{
      //   [Op.lte]: 19994645
      // },
      // chainId: 14,
      timestamp: {
        [Op.gte]: startAt,
        [Op.lte]: endAt,
      },
    };
    try {
      // read
      const txList = await this.ctx.models.Transaction.findAll({
        raw: true,
        order: [["timestamp", "desc"]],
        limit: 400,
        where,
      });
      console.log(
        `exec match:${startAt} - ${endAt}, txlist:${JSON.stringify(
          txList.map(row => row.hash),
        )}`,
      );
      for (const txData of txList) {
        const toChainId = getAmountFlag(
          Number(txData.chainId),
          String(txData.value),
        );
        const toChain = chains.getChainInfo(Number(toChainId));
        if (!toChain) {
          continue;
        }
        const amount = String(await calcMakerSendAmount(this.ctx.makerConfigs, txData as any));
        if (!amount || Number(amount) < 0) {
          continue;
        }
        txData.expectValue = amount;
        txData.transferId = TranferId(
          String(txData.memo),
          txData.replySender,
          String(txData.replyAccount),
          String(txData.nonce),
          String(txData.symbol),
          txData.expectValue,
        );
        await this.ctx.models.Transaction.update({
          expectValue: txData.expectValue,
          transferId: txData.transferId,
        }, {
          where: {
            id: txData.id
          }
        })
        await this.ctx.models.MakerTransaction.update({
          toAmount: txData.expectValue
        }, {
          where: {
            inId: txData.id
          }
        })
      }
    } catch (error) {
      console.log("error:", error);
    }
  }
  public async starknetNotNonceReplyMatch() {
    const txlist = await this.ctx.models.Transaction.findAll({
      attributes: ["id", 'chainId', 'symbol', 'timestamp', "value", 'replyAccount'],
      raw: true,
      limit: 500,
      order: [["id", "asc"]],
      where: {
        status: 1,
        timestamp: {
          [Op.gte]: dayjs()
            .subtract(24, 'hour')
            .toDate(),
          [Op.lte]: dayjs()
            .subtract(10, 'minute')
            .toDate()
        },
        replySender: "0x06e18dd81378fd5240704204bccc546f6dfad3d08c4a3a44347bd274659ff328",
      }
    });
    for (const destTx of txlist) {
      try {
        const sourceTx = await this.ctx.models.Transaction.findOne({
          raw: true,
          attributes: ["id"],
          where: {
            status: 1,
            memo: destTx.chainId,
            symbol: destTx.symbol,
            expectValue: sequelize.literal(`SUBSTRING(expectValue, 1, LENGTH(expectValue) - 4) = '${destTx.value.substring(0, destTx.value.length - 4)}'`),
            replyAccount: destTx.replyAccount,
            timestamp: {
              [Op.lte]: dayjs(destTx.timestamp)
                .add(3, "m")
                .toDate(),
              [Op.gte]: dayjs(destTx.timestamp)
                .subtract(24 * 3, 'hour')
                .toDate(),
            }
          }
        });
        if (sourceTx) {
          const t = await this.ctx.models.sequelize.transaction();
          try {
            const updateStatusRow = await this.ctx.models.Transaction.update({
              status: 99,
            }, {
              where: {
                status: 1,
                id: [sourceTx.id, destTx.id]
              },
              transaction: t
            });

            if (updateStatusRow[0] != 2) {
              throw new Error('starknetNotNonceReplyMatch update1 rows fail');
            }
            // change makerTrx
            const updateMakerTrxRow = await this.ctx.models.MakerTransaction.update({
              outId: destTx.id,
              toAmount: destTx.value
            }, {
              where: {
                inId: sourceTx.id,
                outId: null
              },
              transaction: t
            })
            if (updateMakerTrxRow[0] != 1) {
              throw new Error('starknetNotNonceReplyMatch update2 rows fail');
            }
            await t.commit();
          } catch (error) {
            t && await t.rollback();
            throw error;
          }
        }
      } catch (error) {
        this.ctx.logger.error(`starknetNotNonceReplyMatch error ${destTx.id}`, error);
      }
    }
  }
}
