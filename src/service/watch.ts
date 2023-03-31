import { sleep } from "orbiter-chaincore/src/utils/core";
import { chains, pubSub, ScanChainMain } from "orbiter-chaincore";
import { Transaction } from "orbiter-chaincore/src/types";
import { groupWatchAddressByChain } from "../utils";
import { Context } from "../context";

import {
  processUserSendMakerTx,
  processMakerSendUserTxFromCache,
  processSubTxList,
  processMakerSendUserTx,
} from "./transaction";
import dayjs from "dayjs";
import { Op, QueryTypes } from "sequelize";
export class Watch {
  constructor(public readonly ctx: Context) { }
  public isMultiAddressPaymentCollection(makerAddress: string): boolean {
    return Object.values(this.ctx.config.crossAddressTransferMap).includes(
      makerAddress.toLowerCase(),
    );
  }
  public async start() {
    const ctx = this.ctx;
    const producer = await this.ctx.mq.createProducer({
      exchangeName: "MakerTransationData",
      exchangeType: "direct",
    });

    const consumer = await this.ctx.mq.createConsumer({
      exchangeName: "MakerTransationData",
      exchangeType: "direct",
      queueName: "transactions",
      routingKey: "",
    });
    consumer.consume(async message => {
      try {
        await processSubTxList(ctx, JSON.parse(message));
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
        this.ctx.mq.bindQueue({
          exchangeName: "MakerWaitPending",
          exchangeType: "direct",
          queueName: `MakerWaitPending:${id}`,
          routingKey: id,
        });
        ctx.logger.info(
          `Start Subscribe ChainId: ${id}, instanceId:${this.ctx.instanceId}, instances:${this.ctx.instanceCount}`,
        );
        pubSub.subscribe(`${id}:txlist`, async (txList: Transaction[]) => {
          txList.forEach(tx => {
            try {
              const chainConfig = chains.getChainInfo(String(tx.chainId));
              const ymd = dayjs(tx.timestamp * 1000).format('YYYYMM');
              ctx.redis
                .multi()
                .zadd(`TX_RAW:hash:${ymd}`, dayjs(tx.timestamp * 1000).valueOf(), tx.hash)
                .hset(
                  `TX_RAW:${ymd}:${chainConfig?.internalId}`,
                  tx.hash,
                  JSON.stringify(tx),
                )
                .exec();
            } catch (error) {
              this.ctx.logger.error(`pubSub.subscribe error`, error);
            }
          });
          await producer.publish(txList, "");
          return true;
        });
        scanChain.startScanChain(id, chainGroup[id]).catch(error => {
          ctx.logger.error(`${id} startScanChain error:`, error);
        });
      }
      pubSub.subscribe("ACCEPTED_ON_L2:4", async (tx: any) => {
        if (tx) {
          try {
            const chainConfig = chains.getChainInfo(String(tx.chainId));
            const ymd = dayjs(tx.timestamp * 1000).format('YYYYMM');
            ctx.redis
              .multi()
              .zadd(`TX_RAW:hash:${ymd}`, dayjs(tx.timestamp * 1000).valueOf(), tx.hash)
              .hset(
                `TX_RAW:${ymd}:${chainConfig?.internalId}`,
                tx.hash,
                JSON.stringify(tx),
              )
              .exec();
          } catch (error) {
            this.ctx.logger.error(`pubSub.subscribe ACCEPTED_ON_L2 error`, error);
          }
          const chainConfig = chains.getChainInfo(String(tx.chainId));
          chainConfig &&
            ctx.redis
              .hset(`TX_RAW:${chainConfig?.internalId}`, JSON.stringify(tx))
              .catch(error => {
                ctx.logger.error(`save tx to cache error`, error);
              });
        }
        try {
          return await producer.publish([tx], "");
        } catch (error) {
          ctx.logger.error(
            `${tx.hash} processSubTxList ACCEPTED_ON_L2 error:`,
            error,
          );
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
    // this.readUserTxReMatchNotCreate()
    if (process.env['DB_MATCH'] === '1') {
      this.readMakerendReMatch().catch(error => {
        this.ctx.logger.error("readMakerendReMatch error:", error);
      });
    }
    if (process.env['CACHE_MATCH'] === '1') {
      setInterval(() => {
        processMakerSendUserTxFromCache(ctx).catch(error => {
          this.ctx.logger.error("processMakerSendUserTxFromCache error:", error);
        });
      }, 10000);
    }

  }
  // read db
  public async readMakerendReMatch(): Promise<any> {
    const startAt = dayjs().subtract(24, "hour").startOf("d").toDate();
    const endAt = dayjs().subtract(60, "second").toDate();
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
      const txList = await this.ctx.models.Transaction.findAll({
        raw: true,
        attributes: { exclude: ["input", "blockHash", "transactionIndex"] },
        order: [["timestamp", "desc"]],
        limit: 300,
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
              `readDBMatch process total:${txList.length}, id:${tx.id},hash:${tx.hash}`,
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
      await sleep(1000 * 60 * 5);
      return await this.readMakerendReMatch();
    }
  }
  public async readUserTxReMatchNotCreate(): Promise<any> {
    const txList: any[] = await this.ctx.models.sequelize.query(
      `select t.* from transaction as t left join maker_transaction as mt on t.id = mt.inId
    where t.side = 0 and inId is null and status = 1 and timestamp>='2023-03-20 00:00'
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
        `index:${index}/${txList.length},hash:${tx.hash}，result:`,
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
          `index:${index}/${txList.length},hash:${tx.hash}，result:`,
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
}
