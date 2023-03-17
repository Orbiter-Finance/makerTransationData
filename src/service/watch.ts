import { sleep } from "orbiter-chaincore/src/utils/core";
import { pubSub, ScanChainMain } from "orbiter-chaincore";
import { Transaction } from "orbiter-chaincore/src/types";
import { groupWatchAddressByChain } from "../utils";
import { Context } from "../context";
import {
  bulkCreateTransaction,
  processMakerSendUserTx,
  processUserSendMakerTx,
} from "./transaction";
import dayjs from "dayjs";
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
      try {
        if (!tx.id) {
          this.ctx.logger.error(`Id non-existent`, tx);
          continue;
        }
        if (tx.side === 0) {
          const result = await processUserSendMakerTx(this.ctx, tx as any);
          console.log(`match result1:${tx.hash}`, result);
        } else if (tx.side === 1) {
          const result = await processMakerSendUserTx(this.ctx, tx as any);
          console.log(`match result2:${tx.hash}`, result);
        }
      } catch (error) {
        console.log(`processUserSendMakerTx error:`, error);
        this.ctx.logger.error(`processUserSendMakerTx error:`, error);
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
        if (process.env["SingleChain"]) {
          if (Number(process.env["SingleChain"]) != Number(id)) {
            console.log(`Single-chain configuration filtering ${id}`);
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
          await ctx.mq.publishTxList(txList);
        });
        scanChain.startScanChain(id, chainGroup[id]).catch(error => {
          ctx.logger.error(`${id} startScanChain error:`, error);
        });
      }
      await ctx.mq.subscribe(this);
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
    }
    if (this.ctx.instanceId === 0) {
      this.readMakerendReMatch().catch(error => {
        this.ctx.logger.error("readUserSendReMatch error:", error);
      });
    }
  }
  // read db
  public async readMakerendReMatch(): Promise<any> {
    const startAt = dayjs().subtract(6, "hour").startOf("d").toDate();
    const endAt = dayjs().subtract(10, "second").toDate();
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
        limit: 200,
        where,
      });
      console.log(
        `exec match:${startAt} - ${endAt}, txlist:${JSON.stringify(
          txList.map(row => row.hash),
        )}`,
      );
      for (const tx of txList) {
        const result = await processMakerSendUserTx(this.ctx, tx).catch(
          error => {
            this.ctx.logger.error(
              `readDBMatch process total:${txList.length}, id:${tx.id},hash:${tx.hash}`,
              error,
            );
          },
        );
        console.log(`hash:${tx.hash}，result:`, result);
      }
    } catch (error) {
      console.log("error:", error);
    } finally {
      await sleep(1000 * 30);
      return await this.readMakerendReMatch();
    }
  }
}
