import { isEmpty } from "orbiter-chaincore/src/utils/core";
import { pubSub, ScanChainMain } from "orbiter-chaincore";
import { Transaction } from "orbiter-chaincore/src/types";
import { Op } from "sequelize";
import { groupWatchAddressByChain, sleep } from "../utils";
import { Context } from "../context";
import { bulkCreateTransaction, processUserSendMakerTx } from "./transaction";
import dayjs from "dayjs";
export class Watch {
  constructor(public readonly ctx: Context) {}
  public async processSubTxList(txlist: Array<Transaction>) {
    const saveTxList = await bulkCreateTransaction(this.ctx, txlist);
    for (const tx of saveTxList) {
      // save log
      if (tx.id && tx.status == 1) {
        const transferId = tx.transferId;
        const matchTxKey = `MatchTx:${dayjs().format("YYYY")}:${tx.side}`;
        if (tx.side === 0) {
          const result = await processUserSendMakerTx(this.ctx, tx);
          if (isEmpty(result?.inId) || isEmpty(result?.outId)) {
            await this.ctx.redis
              .multi()
              .hset(matchTxKey, transferId, JSON.stringify(tx))
              .expire(matchTxKey, 1 * 60 * 60)
              .exec();
          } else {
            await this.ctx.redis
              .multi()
              .hset(matchTxKey, transferId, "ok")
              .expire(matchTxKey, 1 * 60 * 60)
              .exec();
          }
        }
        if (tx.side === 1) {
          await this.ctx.redis
            .multi()
            .zadd(matchTxKey, dayjs(tx.timestamp).unix(), transferId)
            .expire(matchTxKey, 1 * 60 * 60)
            .exec();
        }
      }
    }
    return saveTxList;
  }
  public start() {
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
        scanChain.startScanChain(id, chainGroup[id]).catch(error => {
          ctx.logger.error(`${id} startScanChain error:`, error);
        });
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
      // this.readDBMatch("2022-10-24 00:00:26", "2022-10-26 00:00:26").catch(error => {
      //   console.log(error);
      // })
      this.readQueneMatch().catch(error => {
        this.ctx.logger.error("readQueneMatch error:", error);
      });
    }
  }
  public async readUserSendReMatch(
    startAt: any,
    endAt: any = new Date(),
  ): Promise<any> {
    // read
    const txList = await this.ctx.models.transaction.findAll({
      raw: true,
      attributes: { exclude: ["input", "blockHash", "transactionIndex"] },
      limit: 500,
      order: [["timestamp", "desc"]],
      where: {
        side: 0,
        status: 1,
        timestamp: {
          [Op.gt]: startAt,
          [Op.lt]: endAt,
        },
      },
    });

    for (const tx of txList) {
      const result = await processUserSendMakerTx(this.ctx, tx);
      this.ctx.logger.debug(
        `readDBMatch process total:${txList.length}, id:${tx.id},hash:${tx.hash}`,
        result,
      );
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
      const MakerSaveTxKey = `MatchTx:${dayjs().format("YYYY")}:1`;
      const UserSaveTxKey = `MatchTx:${dayjs().format("YYYY")}:0`;
      const transferIdList = await this.ctx.redis.zrangebyscore(
        MakerSaveTxKey,
        dayjs().startOf("d").unix(),
        dayjs().unix(),
      );
      for (const id of transferIdList) {
        const result = await this.ctx.redis.hget(UserSaveTxKey, String(id));
        if (!isEmpty(result)) {
          if (result === "ok") {
            this.ctx.redis.hdel(UserSaveTxKey, String(id)).catch(error => {
              this.ctx.logger.error("readQueneMatch>ok delete error:", error);
            });
          } else {
            const matchResult = await processUserSendMakerTx(
              this.ctx,
              JSON.parse(String(result)),
            );
            if (matchResult?.inId && matchResult.outId) {
              this.ctx.redis.hdel(UserSaveTxKey, String(id)).catch(error => {
                this.ctx.logger.error(
                  "readQueneMatch>rematch ok delete error:",
                  error,
                );
              });
            }
          }
        }
      }
    } catch (error) {
      this.ctx.logger.error("readQueneMatch> error:", error);
    } finally {
      await sleep(1000 * 2);
      return this.readQueneMatch();
    }
  }
}
