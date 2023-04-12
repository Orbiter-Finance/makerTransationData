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
      this.readCacheMakerendReMatch();
    }
    if (process.env["DB_MATCH"] === "1" && this.ctx.instanceId === 0) {
      this.readMakerendReMatch().catch(error => {
        this.ctx.logger.error("readMakerendReMatch error:", error);
      });
    }
    // await this.redZK2();
    // this.regenerateTransferId();
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
    await this.readUserTxReMatchNotCreate();
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
    } finally {
      await sleep(1000 * 30);
      return await this.readMakerendReMatch();
    }
  }
  public async readUserTxReMatchNotCreate(): Promise<any> {
    const txList: any[] = await this.ctx.models.sequelize.query(
      `select t.* from transaction as t left join maker_transaction as mt on t.id = mt.inId
    where t.side = 0 and inId is null and status = 1 and timestamp>='${dayjs().startOf('week').format('YYYY-MM-DD HH:mm:ss')}'
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
      // hash: ["0x0cdaca647ff6484286d223881cc57dce7f34e14bbb7f49fa4f517fc4384a9d5a", '0x10e94a1361bd0d257eeee79127f9a28e3e7b22350cccc4fa43691372db91b553'],
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
        limit: 50,
        where,
      });
      console.log(
        `exec match:${startAt} - ${endAt}, txlist:${JSON.stringify(
          txList.map(row => row.hash),
        )}`,
      );
      for (const txData of txList) {
        const amount = String(await calcMakerSendAmount(this.ctx.makerConfigs, txData as any));
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
          transferId: txData.transferId
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
}
