import "dotenv/config";
import { ScanChainMain, chains, pubSub } from "orbiter-chaincore";
import {
  convertMarketListToFile,
  groupWatchAddressByChain,
  sleep,
} from "./src/utils";
import { makerList } from "./maker";
import { equals } from "orbiter-chaincore/src/utils/core";
import { ITransaction } from "orbiter-chaincore/src/types/transaction";
import net from "net";
import { Context } from "./context";
import {
  bulkCreateTransaction,
  findByHashTxMatch,
} from "./src/service/transaction";
import { WAIT_MATCH_REDIS_KEY } from "./src/types/const";
import { Op } from "sequelize";
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
  watchChain() {
    const instances = Number(process.env.INSTANCES || 1);
    const ctx = this.ctx;
    const instanceId = ctx.instanceId;
    try {
      const chainGroup = groupWatchAddressByChain(ctx.makerConfigs);
      const scanChain = new ScanChainMain(ctx.config.chains);
      for (const id in chainGroup) {
        if (Number(id) % instances !== instanceId) {
          continue;
        }
        ctx.logger.info(
          `Start Subscribe ChainId: ${id}, instanceId:${instanceId}, instances:${instances}`,
        );
        pubSub.subscribe(
          `${id}:txlist`,
          async (txlist: Array<ITransaction>) => {
            ctx.logger.info(
              `Received subscription transaction, interior ChainId:${id},instanceId:${instanceId}, instances:${instances}`,
              { txlist },
            );
            bulkCreateTransaction(ctx, txlist)
              .then(txList => {
                for (const tx of txList) {
                  if (Number(tx.status) !== 1) {
                    continue;
                  }
                  delete tx.id;
                  this.ctx.redis
                    .lpush(
                      WAIT_MATCH_REDIS_KEY,
                      JSON.stringify({ chainId: tx.chainId, hash: tx.hash }),
                    )
                    .catch(error => {
                      this.ctx.logger.error(
                        "save waitMatching queue error:",
                        error,
                      );
                    });
                }
              })
              .catch(error => {
                ctx.logger.error("bulkCreateTransaction error：", error);
              });
          },
        );
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
    this.startMatch().catch(error => {
      ctx.logger.error("init startMatch error:", error);
    });
    this.readQueneMatch().catch(error => {
      ctx.logger.error("readQueneMatch error:", error);
    });
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
    const where = { outId: { [Op.is]: null } };
    const txIdList = await this.ctx.models.maker_transaction.findAll({
      attributes: ["inId"],
      raw: true,
      where,
    });
    if (txIdList.length <= 0) {
      return console.log("Not Data");
    }
    const txList = await this.ctx.models.transaction.findAll({
      raw: true,
      where: <any>{
        id: {
          [Op.in]: txIdList.map((row: any) => row.inId),
        },
      },
    });
    for (const tx of txList) {
      try {
        await findByHashTxMatch(this.ctx, tx.chainId, tx.hash);
      } catch (error) {
        this.ctx.logger.error("startMatch error:", error);
      }
    }

    // const ctx = this.ctx;
    // let page = 1,
    //   isLock = false;
    // ctx.logger.info("Start matching task...");
    // const matchTimerFun = async () => {
    //   try {
    //     if (!isLock) {
    //       isLock = true;
    //       const list = await matchSourceData(ctx, page, 100);
    //       page++;
    //       isLock = false;
    //       if (list.length <= 0 || page >= 50) {
    //         ctx.logger.info("The matching task has been executed.....");
    //         timer && clearInterval(timer);
    //       }
    //     }
    //     return isLock;
    //   } catch (error) {
    //     ctx.logger.error("startMatch error:", error);
    //     isLock = false;
    //     timer && clearInterval(timer);
    //   }
    // };
    // // eslint-disable-next-line
    // const timer = setInterval(matchTimerFun, 5000);
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
