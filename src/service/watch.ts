import { pubSub, ScanChainMain } from "orbiter-chaincore";
import { Transaction } from "orbiter-chaincore/src/types";
import { Op } from "sequelize";
import { WAIT_MATCH_REDIS_KEY } from "../types/const";
import { groupWatchAddressByChain, sleep } from "../utils";
import { Context } from "../context";
import { bulkCreateTransaction, findByHashTxMatch } from "./transaction";
export class Watch {
  constructor(public readonly ctx: Context) {}
  public async processSubTxList(txlist: Array<Transaction>) {
    const saveTxList = await bulkCreateTransaction(this.ctx, txlist);
    for (const tx of saveTxList) {
      if (Number(tx.status) !== 1) {
        continue;
      }
      this.ctx.redis
        .rpush(
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
        //TAG: On
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
    } finally {
      this.ctx.instanceId === 0 &&
        this.initUnmatchedTransaction().catch(error => {
          this.ctx.logger.error("initUnmatchedTransaction error:", error);
        });
      this.ctx.instanceId === 0 &&
        this.readQueneMatch().catch(error => {
          this.ctx.logger.error("readQueneMatch error:", error);
        });
    }
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
    };
    const mtxList = await this.ctx.models.maker_transaction.findAll({
      attributes: ["inId", "outId"],
      raw: true,
      where,
      order: [["id", "desc"]],
      limit: 1000,
    });
    const txIdList = mtxList.map(row => {
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
    txList.forEach(tx => {
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
