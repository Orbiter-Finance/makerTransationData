import { isEmpty, sleep } from "orbiter-chaincore/src/utils/core";
import { pubSub, ScanChainMain } from "orbiter-chaincore";
import { Transaction } from "orbiter-chaincore/src/types";
import { groupWatchAddressByChain } from "../utils";
import { Context } from "../context";
import { bulkCreateTransaction, processUserSendMakerTx } from "./transaction";
import dayjs from "dayjs";
import {
  MAKER_MATCH_CROSS_TX,
  MAKER_MATCH_TX,
  TRANSACTION_RAW,
  USER_MATCH_TX,
} from "../types/const";
import { Op } from "sequelize";
export class Watch {
  constructor(public readonly ctx: Context) {}
  public async processSubTxList(txlist: Array<Transaction>) {
    const saveTxList = await bulkCreateTransaction(this.ctx, txlist);
    for (const tx of saveTxList) {
      // save log
      if (tx.status != 1) {
        continue;
      }
      if (!tx.id) {
        throw new Error("Id non-existent");
      }
      let transferId = tx.transferId;
      const reidsT = await this.ctx.redis
        .multi()
        .hset(`${TRANSACTION_RAW}:${tx.chainId}`, tx.hash, JSON.stringify(tx));
      if (tx.side === 0) {
        const result = await processUserSendMakerTx(this.ctx, tx as any);
        if (isEmpty(result?.inId) || isEmpty(result?.outId)) {
          await reidsT.hset(USER_MATCH_TX, transferId, tx.hash);
        } else {
          // await this.ctx.redis.hset(USER_MATCH_TX, transferId, "ok");
        }
      }
      if (tx.side === 1) {
        if (
          tx.replySender &&
          Object.values(this.ctx.config.crossAddressTransferMap).includes(
            tx.replySender.toLowerCase(),
          )
        ) {
          transferId = `${transferId}:cross`;
          await reidsT
            .hset(MAKER_MATCH_CROSS_TX, transferId, tx.hash)
            .zadd(MAKER_MATCH_TX, dayjs(tx.timestamp).unix(), transferId);
        } else {
          await reidsT.zadd(
            MAKER_MATCH_TX,
            dayjs(tx.timestamp).unix(),
            transferId,
          );
        }
      }
      await reidsT.exec();
    }
    return saveTxList;
  }
  public async start() {
    const ctx = this.ctx;
    try {
      const chainGroup = groupWatchAddressByChain(ctx.makerConfigs);
      const scanChain = new ScanChainMain(ctx.config.chains);
      for (const id in chainGroup) {
        if (Number(id) % this.ctx.instanceCount !== this.ctx.instanceId) {
          continue;
        }
        ctx.logger.info(
          `Start Subscribe ChainId: ${id}, instanceId:${this.ctx.instanceId}, instances:${this.ctx.instanceCount}`,
        );
        pubSub.subscribe(`${id}:txlist`, (result: Transaction[]) => {
          this.processSubTxList(result)
            .then(result => {
              this.ctx.logger.info(
                `Received subscription transaction,instanceId:${this.ctx.instanceId}, instances:${this.ctx.instanceCount}`,
                result.map(tx => tx.hash),
              );
            })
            .catch(error => {
              ctx.logger.error(`${id} processSubTxList error:`, error);
            });
        });
        // scanChain.startScanChain(id, chainGroup[id]).catch(error => {
        //   ctx.logger.error(`${id} startScanChain error:`, error);
        // });
      }
      process.on("SIGINT", () => {
        scanChain.pause().catch(error => {
          ctx.logger.error("chaincore pause error:", error);
        });
        process.exit(0);
      });
    } catch (error: any) {
      ctx.logger.error("startSub error:", error);
    }
    if (this.ctx.instanceId === 0) {
      this.readUserSendReMatch().catch(error => {
        this.ctx.logger.error("readUserSendReMatch error:", error);
      });
      // processMakerTxCrossAddress(this.ctx, "0x64282d53de4947ce61c44e702d44afde73d5135c8a7c5d3a5e56262e8af8913").then(result => {
      //   console.log(result, '==result');
      // }).catch(error => {
      //   console.log(error, '======error');
      // })
      // setInterval(() => {

      // }, 1000 * 60);
      // this.readQueneMatch().catch(error => {
      //   this.ctx.logger.error("readQueneMatch error:", error);
      // });
    }
  }
  public async readUserSendReMatch(): Promise<any> {
    const startAt = dayjs().startOf("d").toDate();
    let endAt = dayjs().subtract(1, "minute").toDate();
    try {
      // read
      const txList = await this.ctx.models.Transaction.findAll({
        raw: true,
        attributes: { exclude: ["input", "blockHash", "transactionIndex"] },
        order: [["timestamp", "desc"]],
        where: {
          side: 0,
          status: 1,
          timestamp: {
            [Op.gte]: startAt,
            [Op.lte]: endAt,
          },
        },
      });
      for (const tx of txList) {
        await processUserSendMakerTx(this.ctx, tx).catch(error => {
          this.ctx.logger.error(
            `readDBMatch process total:${txList.length}, id:${tx.id},hash:${tx.hash}`,
            error,
          );
        });
        endAt = tx.timestamp;
      }
      if (txList.length <= 0 || dayjs(endAt).isBefore(startAt)) {
        return { startAt, endAt, count: txList.length };
      }
    } catch (error) {
    } finally {
      await sleep(1000 * 30);
      return await this.readUserSendReMatch();
    }
  }
  // public async readQueneMatch(): Promise<any> {
  //   try {
  //     const transferIdList: Array<string> = await this.ctx.redis.zrangebyscore(
  //       MAKER_MATCH_TX,
  //       dayjs().subtract(60, "minute").unix(),
  //       dayjs().unix(),
  //     );
  //     for (const transferId of transferIdList) {
  //       try {
  //         if (String(transferId).includes(":cross")) {
  //           const hash = await this.ctx.redis.hget(
  //             MAKER_MATCH_CROSS_TX,
  //             transferId,
  //           );
  //           if (hash) {
  //             const matchResult = await processMakerSendUserTx(
  //               this.ctx,
  //               hash,
  //               true,
  //             );
  //             if (matchResult?.inId && matchResult.outId) {
  //               await this.ctx.redis
  //                 .multi()
  //                 .zrem(MAKER_MATCH_CROSS_TX, transferId)
  //                 .hdel(`${MAKER_MATCH_TX}:cross`, transferId);
  //             }
  //           }
  //           continue;
  //         }
  //         const hash = await this.ctx.redis.hget(
  //           USER_MATCH_TX,
  //           String(transferId),
  //         );
  //         if (!hash) {
  //           continue;
  //         }
  //         if (hash === "ok") {
  //           await this.ctx.redis
  //             .multi()
  //             .zrem(MAKER_MATCH_TX, transferId)
  //             .hdel(USER_MATCH_TX, transferId)
  //             .exec();
  //           continue;
  //         }
  //         const matchResult = await processUserSendMakerTx(this.ctx, hash);
  //         if (matchResult?.inId && matchResult.outId) {
  //           await this.ctx.redis
  //             .multi()
  //             .zrem(MAKER_MATCH_TX, transferId)
  //             .hdel(USER_MATCH_TX, transferId)
  //             .exec();
  //         }
  //       } catch (error) {
  //         this.ctx.logger.error(
  //           "readQueneMatch>for transferId error:%s,%s",
  //           transferId,
  //           error,
  //         );
  //       }
  //     }
  //   } catch (error) {
  //     this.ctx.logger.error("readQueneMatch> error:", error);
  //   } finally {
  //     await sleep(1000 * 2);
  //     return await this.readQueneMatch();
  //   }
  // }
}
