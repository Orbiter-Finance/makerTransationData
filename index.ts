import "dotenv/config";
import { ScanChainMain, chains, pubSub } from "orbiter-chaincore";
import {
  convertMarketListToFile,
  groupWatchAddressByChain,
  sleep,
} from "./src/utils";
import { makerList } from "./maker";
import { equals } from "orbiter-chaincore/src/utils/core";
import {
  ITransaction,
  Transaction,
} from "orbiter-chaincore/src/types/transaction";
import net from "net";
import { Context } from "./context";
import {
  bulkCreateTransaction,
  findByHashTxMatch,
} from "./src/service/transaction";
import { WAIT_MATCH_REDIS_KEY } from "./src/types/const";
import { Op } from "sequelize";
import dayjs from "dayjs";
export class Application {
  public ctx: Context;
  constructor() {
    this.ctx = new Context();
  }
  async bootstrap() {
    subscribeInject(this.ctx);
    this.ctx.makerConfigs = await convertMarketListToFile(
      makerList,
      this.ctx.config.L1L2Mapping,
    );
    await this.watchChain();
  }
  async processSubTxList(txlist: Array<ITransaction>) {
    const saveTxList = await bulkCreateTransaction(this.ctx, txlist);
    for (const tx of saveTxList) {
      if (Number(tx.status) !== 1) {
        continue;
      }
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
  watchChain() {
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
                { result },
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
    this.startMatch().catch(error => {
      ctx.logger.error("init startMatch error:", error);
    });
    this.modifyReplyUserAndReplyMaker(0).catch(error => {
      ctx.logger.error("modifyReplyUserAndReplyMaker error:", error);
    });

    this.readQueneMatch().catch(error => {
      ctx.logger.error("readQueneMatch error:", error);
    });
  }
  async modifyReplyUserAndReplyMaker(page = 0): Promise<any> {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    const txList = await this.ctx.models.transaction
      .findAll({
        raw: true,
        where: <any>{
          replyAccount: null,
        },
        order: [["id", "desc"]],
        offset: page * 100,
        limit: 100,
      })
      .then(trx => {
        const newList = trx.map(row => {
          const item: any = row;
          const chainConfig = chains.getChainByInternalId(String(row.chainId));
          item.chainId = chainConfig.chainId;
          item.timestamp = dayjs(row.timestamp).unix();
          return item;
        });
        newList.length > 0 && bulkCreateTransaction(this.ctx, <any>newList);
        return newList;
      });
    await sleep(1000 * 10);
    if (txList.length > 0) {
      return this.modifyReplyUserAndReplyMaker(page >= 100 ? 0 : page++);
    }
  }
  async readQueneMatch() {
    while (true) {
      const tx: any = await this.ctx.redis
        .rpop(WAIT_MATCH_REDIS_KEY)
        .then(result => result && JSON.parse(result));
      if (tx) {
        try {
          await findByHashTxMatch(this.ctx, tx.chainId, tx.hash);
        } catch (error) {
          this.ctx.logger.error(
            "readQueneMatch findByHashTxMatch error:",
            error,
          );
        }
      }
      if (!tx) {
        await sleep(1000 * 10);
      }
    }
  }
  async startMatch() {
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
      limit: 100,
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
      where: <any>{
        status: 1,
        id: {
          [Op.in]: txIdList,
        },
      },
    });
    txList.forEach(tx => {
      this.ctx.redis
        .lpush(
          WAIT_MATCH_REDIS_KEY,
          JSON.stringify({ chainId: tx.chainId, hash: tx.hash }),
        )
        .catch(error => {
          this.ctx.logger.error("save waitMatching queue error:", error);
        });
    });
  }
}
function subscribeInject(ctx: Context) {
  const client = new net.Socket();
  client.connect(8001, "127.0.0.1", function () {
    console.log("[Inject-Service] Successfully connected to the server\n");
    client.write(
      JSON.stringify({
        op: "subscribe",
        data: "",
      }),
    );
  });
  client.on("data", (str: string) => {
    let body: any = {};
    try {
      body = JSON.parse(str);
    } catch (err) {}
    if (body && body.op === "inject") {
      const chain = chains
        .getAllChains()
        .find(row => equals(row.internalId, body.data.key));
      if (!chain) {
        return ctx.logger.error(
          `Inject Key Not Find Chain Config ${body.data.key}`,
        );
      }
      chain.api.key = body.data.value;
    }
  });
  // client.on("end", () => {
  //   console.log("Send Data end");
  // });
  client.on("error", error => {
    if ((Date.now() / 1000) * 10 === 0) {
      ctx.logger.error("sub error:", error);
    }
    sleep(1000 * 10)
      .then(() => {
        subscribeInject(ctx);
      })
      .catch(error => {
        ctx.logger.error("sleep error:", error);
      });
  });
}

const app = new Application();
app.bootstrap().catch(error => {
  console.error("start app error", error);
});

process.on("uncaughtException", (err: Error) => {
  console.error("Global Uncaught exception:", err);
});

process.on("unhandledRejection", (err: Error) => {
  console.error(
    "There are failed functions where promise is not captured：",
    err,
  );
});
