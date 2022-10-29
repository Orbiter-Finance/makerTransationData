import { isEmpty } from "orbiter-chaincore/src/utils/core";
import { pubSub, ScanChainMain } from "orbiter-chaincore";
import { Transaction } from "orbiter-chaincore/src/types";
import { Op } from "sequelize";
import { groupWatchAddressByChain, sleep } from "../utils";
import { Context } from "../context";
import {
  bulkCreateTransaction,
  processMakerSendUserTx,
  processUserSendMakerTx,
} from "./transaction";
import dayjs from "dayjs";
import {
  MAKER_MATCH_CROSS_TX,
  MAKER_MATCH_TX,
  USER_MATCH_TX,
} from "../types/const";
export class Watch {
  constructor(public readonly ctx: Context) {}
  public async processSubTxList(txlist: Array<Transaction>) {
    const saveTxList = await bulkCreateTransaction(this.ctx, txlist);
    for (const tx of saveTxList) {
      // save log
      if (tx.status != 1) {
        continue;
      }
      let transferId = tx.transferId;
      if (tx.side === 0) {
        const result = await processUserSendMakerTx(this.ctx, tx.hash);
        if (isEmpty(result?.inId) || isEmpty(result?.outId)) {
          await this.ctx.redis.hset(USER_MATCH_TX, transferId, tx.hash);
        } else {
          await this.ctx.redis.hset(USER_MATCH_TX, transferId, "ok");
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
          await this.ctx.redis
            .multi()
            .hset(MAKER_MATCH_CROSS_TX, transferId, tx.hash)
            .zadd(MAKER_MATCH_TX, dayjs(tx.timestamp).unix(), transferId)
            .exec();
        } else {
          await this.ctx.redis.zadd(
            MAKER_MATCH_TX,
            dayjs(tx.timestamp).unix(),
            transferId,
          );
        }
      }
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
      // processMakerTxCrossAddress(this.ctx, "0x64282d53de4947ce61c44e702d44afde73d5135c8a7c5d3a5e56262e8af8913").then(result => {
      //   console.log(result, '==result');
      // }).catch(error => {
      //   console.log(error, '======error');
      // })
      // setInterval(() => {
      this.readUserSendReMatch(
        dayjs().subtract(50, "minute").toDate(),
        dayjs().subtract(1, "minute").toDate(),
      ).catch(error => {
        console.log(error, "==");
      });
      // }, 1000 * 60);
      // this.readQueneMatch().catch(error => {
      //   this.ctx.logger.error("readQueneMatch error:", error);
      // });
    }
  }
  public async readUserSendReMatch(
    startAt: any,
    endAt: any = new Date(),
  ): Promise<any> {
    // read
    const txList = await this.ctx.models.Transaction.findAll({
      raw: true,
      attributes: ["hash"],
      limit: 500,
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
      await processUserSendMakerTx(this.ctx, tx.hash).catch(error => {
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
    await sleep(1000 * 5);
    return await this.readUserSendReMatch(startAt, endAt);
  }
  public async readQueneMatch(): Promise<any> {
    try {
      const transferIdList: Array<string> = await this.ctx.redis.zrangebyscore(
        MAKER_MATCH_TX,
        dayjs().subtract(60, "minute").unix(),
        dayjs().unix(),
      );
      for (const transferId of transferIdList) {
        try {
          if (String(transferId).includes(":cross")) {
            const hash = await this.ctx.redis.hget(
              MAKER_MATCH_CROSS_TX,
              transferId,
            );
            if (hash) {
              const matchResult = await processMakerSendUserTx(
                this.ctx,
                hash,
                true,
              );
              if (matchResult?.inId && matchResult.outId) {
                await this.ctx.redis
                  .multi()
                  .zrem(MAKER_MATCH_CROSS_TX, transferId)
                  .hdel(`${MAKER_MATCH_TX}:cross`, transferId);
              }
            }
            continue;
          }
          const hash = await this.ctx.redis.hget(
            USER_MATCH_TX,
            String(transferId),
          );
          if (!hash) {
            continue;
          }
          if (hash === "ok") {
            await this.ctx.redis
              .multi()
              .zrem(MAKER_MATCH_TX, transferId)
              .hdel(USER_MATCH_TX, transferId)
              .exec();
            continue;
          }
          const matchResult = await processUserSendMakerTx(this.ctx, hash);
          if (matchResult?.inId && matchResult.outId) {
            await this.ctx.redis
              .multi()
              .zrem(MAKER_MATCH_TX, transferId)
              .hdel(USER_MATCH_TX, transferId)
              .exec();
          }
        } catch (error) {
          this.ctx.logger.error(
            "readQueneMatch>for transferId error:%s,%s",
            transferId,
            error,
          );
        }
      }
    } catch (error) {
      this.ctx.logger.error("readQueneMatch> error:", error);
    } finally {
      await sleep(1000 * 2);
      return await this.readQueneMatch();
    }
  }
}
