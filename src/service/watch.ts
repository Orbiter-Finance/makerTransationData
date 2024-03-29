import { sleep } from "orbiter-chaincore/src/utils/core";
import { pubSub, ScanChainMain } from "orbiter-chaincore";
import { Transaction } from "orbiter-chaincore/src/types";
import { groupWatchAddressByChain } from "../utils";
import { Context } from "../context";
import {
  bulkCreateTransaction,
  findByHashTxMatch,
  processMakerSendUserTx,
  processUserSendMakerTx,
  quickMatchSuccess,
} from "./transaction";
import dayjs from "dayjs";
import {
  TRANSACTION_RAW,
  MATCH_SUCCESS,
  USERTX_WAIT_MATCH,
  MAKERTX_WAIT_MATCH,
  MAKERTX_TRANSFERID,
} from "../types/const";
import { Op } from "sequelize";

export class Watch {
  constructor(public readonly ctx: Context) {}
  public isMultiAddressPaymentCollection(makerAddress: string): boolean {
    return Object.values(this.ctx.config.crossAddressTransferMap).includes(
      makerAddress.toLowerCase(),
    );
  }
  public async processSubTxList(txlist: Array<Transaction>) {
    const saveTxList = await bulkCreateTransaction(this.ctx, txlist);
    for (const tx of saveTxList) {
      // save log
      // if (tx.status != 1) {
      //   continue;
      // }
      if (!tx.id) {
        this.ctx.logger.error(`Id non-existent`, tx);
        continue;
      }
      const reidsT = await this.ctx.redis.multi();
      // const reidsT = await this.ctx.redis.multi()
      //   .hset(TRANSACTION_RAW, tx.id, JSON.stringify(tx));
      if (tx.side === 0) {
        const result = await processUserSendMakerTx(this.ctx, tx as any);
        if (result?.inId && result.outId) {
          // success
          await reidsT
            .hset(MATCH_SUCCESS, result.outId, result.inId)
            .hdel(MAKERTX_TRANSFERID, result.outId)
            .zrem(MAKERTX_WAIT_MATCH, result.outId);
        } else {
          await reidsT.hset(USERTX_WAIT_MATCH, tx.transferId, tx.id);
        }
      }
      if (tx.side === 1 && tx.replySender) {
        if (this.isMultiAddressPaymentCollection(tx.from)) {
          // Multi address payment collection
          await reidsT
            .hset(TRANSACTION_RAW, tx.id, JSON.stringify(tx))
            .hset(MAKERTX_TRANSFERID, tx.id, `${tx.transferId}_cross`)
            .zadd(MAKERTX_WAIT_MATCH, dayjs(tx.timestamp).unix(), tx.id);
        } else {
          await reidsT
            .hset(MAKERTX_TRANSFERID, tx.id, tx.transferId)
            .zadd(MAKERTX_WAIT_MATCH, dayjs(tx.timestamp).unix(), tx.id);
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
      // this.readMakerTxCacheReMatch().catch(error => {
      //   this.ctx.logger.error("readMakerTxCacheReMatch error:", error);
      // });
    }
  }
  // read db
  public async readUserSendReMatch(): Promise<any> {
    const startAt = dayjs().subtract(7, "d").startOf("d").toDate();
    let endAt = dayjs().subtract(1, "minute").toDate();
    try {
      // read
      const txList = await this.ctx.models.Transaction.findAll({
        raw: true,
        attributes: { exclude: ["input", "blockHash", "transactionIndex"] },
        order: [["timestamp", "desc"]],
        limit: 500,
        where: {
          side: 0,
          status: [0, 1],
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
      // if (txList.length <= 0 || dayjs(endAt).isBefore(startAt)) {
      //   return { startAt, endAt, count: txList.length };
      // }
    } catch (error) {
    } finally {
      await sleep(1000 * 10);
      return await this.readUserSendReMatch();
    }
  }
  public async readMakerTxCacheReMatch() {
    const outIdList: Array<string> = await this.ctx.redis.zrangebyscore(
      MAKERTX_WAIT_MATCH,
      dayjs()
        .subtract(60 * 24 * 7, "minute")
        .unix(),
      dayjs().unix(),
    );
    if (outIdList.length > 0) {
      for (const outTxId of outIdList) {
        const transferId = await this.ctx.redis.hget(
          MAKERTX_TRANSFERID,
          outTxId,
        );
        if (!transferId) {
          continue;
        }
        let matchRes: any = {
          inId: null,
          outId: null,
        };
        try {
          if (transferId.includes("_cross")) {
            // tx
            const txItem = await this.ctx.redis
              .hget(TRANSACTION_RAW, outTxId)
              .then(res => res && JSON.parse(res));
            matchRes = await processMakerSendUserTx(this.ctx, txItem, true);
          } else {
            const inTxId = await this.ctx.redis.hget(
              USERTX_WAIT_MATCH,
              transferId,
            );
            if (inTxId) {
              matchRes = await quickMatchSuccess(
                this.ctx,
                Number(inTxId),
                Number(outTxId),
                transferId,
              );
            } else {
              const res = await findByHashTxMatch(
                this.ctx,
                Number(outTxId),
              ).catch(error => {
                this.ctx.logger.info(
                  `readMakerTxCacheReMatch findByHashTxMatch error:`,
                  error,
                );
              });
            }
          }
          if (matchRes.inId && matchRes.outId) {
            this.ctx.logger.info(`quickMatchSuccess result:`, matchRes);
            await this.ctx.redis
              .multi()
              .zrem(MAKERTX_WAIT_MATCH, outTxId)
              .hdel(MAKERTX_TRANSFERID, outTxId)
              .hdel(USERTX_WAIT_MATCH, transferId)
              .hset(MATCH_SUCCESS, matchRes.outId, matchRes.inId)
              .exec();
          }
        } catch (error) {
          this.ctx.logger.error(`readUserCacheSendReMatch error:`, error);
        }
      }
    }
    await sleep(1000 * 10);

    return await this.readUserSendReMatch();
  }
}
