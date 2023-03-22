import { sleep } from "orbiter-chaincore/src/utils/core";
import { pubSub, ScanChainMain } from "orbiter-chaincore";
import { Transaction } from "orbiter-chaincore/src/types";
import { groupWatchAddressByChain } from "../utils";
import { Context } from "../context";
import { processMakerSendUserTx, processUserSendMakerTx } from "./transaction";
import dayjs from "dayjs";
import { Op } from "sequelize";
export class Watch {
  constructor(public readonly ctx: Context) {}
  public isMultiAddressPaymentCollection(makerAddress: string): boolean {
    return Object.values(this.ctx.config.crossAddressTransferMap).includes(
      makerAddress.toLowerCase(),
    );
  }
  public async start() {
    const ctx = this.ctx;
    try {
      const chainGroup = groupWatchAddressByChain(ctx.makerConfigs);

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
          ctx.logger.info(
            "subscribe tx",
            txList.map(tx => tx.hash),
          );
          return ctx.mq.publishTxList(txList);
        });
        scanChain.startScanChain(id, chainGroup[id]).catch(error => {
          ctx.logger.error(`${id} startScanChain error:`, error);
        });
      }
      pubSub.subscribe("ACCEPTED_ON_L2:4", async (tx: any) => {
        try {
          await ctx.mq.publishTxList([tx]);
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
      await ctx.mq.subscribe(this);
    } catch (error: any) {
      ctx.logger.error("startSub error:", error);
    }
    if (this.ctx.instanceId === 0) {
      this.readMakerendReMatch().catch(error => {
        this.ctx.logger.error("readMakerendReMatch error:", error);
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
  public async readUserTxReMatch(): Promise<any> {
    const startAt = dayjs().subtract(6, "hour").startOf("d").toDate();
    const endAt = dayjs().subtract(10, "second").toDate();
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
        limit: 200,
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
