import { pubSub, ScanChainMain } from "orbiter-chaincore";
import { Transaction } from "orbiter-chaincore/src/types";
import { Op } from "sequelize";
import { WAIT_MATCH_REDIS_KEY } from "../types/const";
import { groupWatchAddressByChain, sleep } from "../utils";
import { Context } from "../context";
import {
  bulkCreateTransaction,
  findByHashTxMatch,
  txProcessMatch,
} from "./transaction";
import dayjs from "dayjs";
export class Watch {
  constructor(public readonly ctx: Context) {}

  public async processSubTxList(txlist: Array<Transaction>) {
    const saveTxList = await bulkCreateTransaction(this.ctx, txlist);
    for (const tx of saveTxList) {
      // save log
      // if (Number(tx.status) !== 1) {
      //   continue;
      // }
      this.ctx.redis
        .lpush(
          WAIT_MATCH_REDIS_KEY,
          JSON.stringify({ chainId: tx.chainId, hash: tx.hash }),
        )
        .catch(error => {
          this.ctx.logger.error("save waitMatching queue error:", error);
        });
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
                result,
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
      pubSub.subscribe("ACCEPTED_ON_L2:4", async (tx: any) => {
        try {
          await this.processSubTxList([tx]);
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
    } finally {
      // this.ctx.instanceId === 0 &&
      //   this.initUnmatchedTransaction().catch(error => {
      //     this.ctx.logger.error("initUnmatchedTransaction error:", error);
      //   });
      // this.readQueneMatch().catch(error => {
      //   this.ctx.logger.error("readQueneMatch error:", error);
      // });
    }

    this.readDBMatch(
      dayjs().subtract(5, "d").format("YYYY-MM-DD HH:mm"),
      dayjs().subtract(10, "minute").format("YYYY-MM-DD HH:mm"),
    ).catch(error => {
      console.log(error, "==error");
    });
  }
  public async readDBMatch(
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
      const result = await txProcessMatch(this.ctx, tx);
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
    return await this.readDBMatch(startAt, endAt);
  }
  public async initUnmatchedTransaction() {
    const where: any = {
      [Op.or]: [
        {
          inId: null,
        },
        {
          outId: null,
        },
      ],
      createdAt: {
        [Op.gte]: dayjs().startOf("d"),
      },
    };
    const mtxList = await this.ctx.models.maker_transaction.findAll({
      attributes: ["inId", "outId"],
      raw: true,
      where,
      order: [["id", "desc"]],
      limit: 500,
    });
    const txIdList = mtxList.map((row: any) => {
      return row.inId || row.outId;
    });
    if (!txIdList || txIdList.length <= 0) {
      return;
    }
    const txList = await this.ctx.models.transaction.findAll({
      attributes: ["chainId", "hash"],
      raw: true,
      // order: [["id", "desc"]],
      where: <any>{
        status: 1,
        id: {
          [Op.in]: txIdList,
        },
      },
    });
    txList.forEach((tx: { chainId: any; hash: any }) => {
      this.ctx.redis
        .rpush(
          WAIT_MATCH_REDIS_KEY,
          JSON.stringify({ chainId: tx.chainId, hash: tx.hash }),
        )
        .catch(error => {
          this.ctx.logger.error("save waitMatching queue error:", error);
        });
    });
  }
  public async readQueneMatch(): Promise<any> {
    const tx: any = await this.ctx.redis
      .lpop(WAIT_MATCH_REDIS_KEY)
      .then((result: any) => {
        return result && JSON.parse(result);
      });
    try {
      if (tx) {
        await findByHashTxMatch(this.ctx, tx.chainId, tx.hash);
      } else {
        await sleep(1000 * 10);
      }
    } catch (error) {
      this.ctx.logger.error("readQueneMatch findByHashTxMatch error:", error);
    }
    return this.readQueneMatch();
  }
}
