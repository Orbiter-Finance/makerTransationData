import "dotenv/config";
import { ScanChainMain, chains, pubSub } from "orbiter-chaincore";
import {
  convertMarketListToFile,
  groupWatchAddressByChain,
  sleep,
} from "./src/utils";
import { BigNumber } from 'bignumber.js'
import { makerList } from "./maker";
import { Op, Sequelize } from "sequelize";
import { initModels, transactionAttributes } from "./src/models/init-models";
import { IMarket } from "./src/types";
import { padStart } from "lodash";
import { getAmountFlag, getAmountToSend } from "./src/utils/oldUtils";
import { equals, fix0xPadStartAddress } from "orbiter-chaincore/src/utils/core";
import { ITransaction } from "orbiter-chaincore/src/types/transaction";
import mainChainConfigs from "./src/config/chains.json";
import testChainConfigs from "./src/config/testnet.json";
import {
  matchSourceData,
  matchSourceDataByTx,
  bulkCreateTransaction,
} from "./src/service";
import net from "net";
import dayjs from "dayjs";
import { LoggerService } from "orbiter-chaincore/src/utils";
export function TransactionID(
  fromAddress: string,
  fromChainId: number | string,
  fromTxNonce: string | number,
  symbol: string | undefined,
) {
  return `${fromAddress}${padStart(String(fromChainId), 4, "00")}${symbol || "NULL"
    }${fromTxNonce}`.toLowerCase();
}
export interface Config {
  L1L2Mapping: {
    [key: string]: {
      [key: string]: string;
    };
  };
  chains: Array<any>;
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
    } catch (err) { }
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
export class Context {
  public models;
  public logger;
  public sequelize: Sequelize;
  public makerConfigs: Array<IMarket> = [];
  public config: Config = {
    chains: [],
    L1L2Mapping: {
      "4": {
        "0x80c67432656d59144ceff962e8faf8926599bcf8":
          "0x07c57808b9cea7130c44aab2f8ca6147b04408943b48c6d8c3c83eb8cfdd8c0b",
      },
      "44": {
        "0x8a3214f28946a797088944396c476f014f88dd37":
          "0x033b88fc03a2ccb1433d6c70b73250d0513c6ee17a7ab61c5af0fbe16bd17a6e",
      },
    },
  };
  constructor() {
    const { DB_HOST, DB_NAME, DB_USER, DB_PASS, DB_PORT, NODE_ENV } = <any>(
      process.env
    );
    const instanceId = Number(process.env.NODE_APP_INSTANCE || 0);
    this.logger = LoggerService.createLogger({
      dir: `${process.env.RUNTIME_DIR || ''}/logs${instanceId}`
    });
    if (NODE_ENV === "prod") {
      this.logger.info("Start APP Read Chain Config:[Mainnet]");
      this.config.chains = <any>mainChainConfigs;
    } else {
      this.logger.info("Starp APP Read Chain Config:[Testnet]");
      this.config.chains = <any>testChainConfigs;
    }
    this.sequelize = new Sequelize(
      DB_NAME || "orbiter",
      String(DB_USER),
      DB_PASS,
      {
        host: DB_HOST,
        port: Number(DB_PORT) || 3306,
        dialect: "mysql",
        logging: true,
      },
    );
    this.models = initModels(this.sequelize);
    this.sequelize.sync().catch(error => {
      this.logger.error("sequelize sync error:", error);
    });
  }
}
export async function processUserSendMakerTx(
  ctx: Context,
  trx: transactionAttributes,
) {
  // user send to Maker
  const fromChainId = Number(trx.chainId);
  const transcationId = TransactionID(
    String(trx.from),
    trx.chainId,
    trx.nonce,
    trx.symbol,
  );
  let toChainId = getAmountFlag(fromChainId, String(trx.value));
  if ([9, 99].includes(fromChainId) && trx.extra) {
    toChainId = String((<any>trx.extra).memo % 9000);
  }
  const market = ctx.makerConfigs.find(
    m =>
      equals(m.fromChain.id, String(fromChainId)) &&
      equals(m.toChain.id, toChainId) &&
      equals(m.fromChain.symbol, trx.symbol) &&
      equals(m.fromChain.tokenAddress, trx.tokenAddress),
  );
  if (!market) {
    ctx.logger.error("market not found:", {
      hash: trx.hash,
      value: trx.value.toString(),
      from: trx.from,
      to: trx.to,
      fromChain: fromChainId,
      toChainId: toChainId,
      symbol: trx.symbol,
      token: trx.tokenAddress,
    });
    return;
  }
  const needToAmount =
    getAmountToSend(
      Number(fromChainId),
      Number(toChainId),
      trx.value.toString(),
      market.pool,
      trx.nonce,
    )?.tAmount || "0";
  let replyAccount: string | undefined = trx.from;
  if (["44", "4", "11", "511"].includes(toChainId)) {
    const ext = (<any>trx.extra)["ext"] || "";
    // 11,511 0x02 first
    // 4, 44 0x03 first
    replyAccount = `0x${ext.substring(4)}`;
    if (["44", "4"].includes(toChainId)) {
      replyAccount = fix0xPadStartAddress(replyAccount, 66);
    }
  }
  const t = await ctx.sequelize.transaction();
  try {
    const makerSendTx = await ctx.models.transaction.findOne({
      raw: true,
      attributes: ["id"],
      where: {
        chainId: toChainId,
        from: market.sender,
        to: replyAccount,
        symbol: trx.symbol,
        memo: trx.nonce,
        timestamp: {
          [Op.gte]: dayjs(trx.timestamp).subtract(2, "m").toDate(),
        },
      },
      order: [["timestamp", "asc"]],
      transaction: t
    });
    const upsertParams = {
      transcationId,
      inId: trx.id,
      outId: makerSendTx ? makerSendTx.id : undefined,
      fromChain: trx.chainId,
      toChain: Number(toChainId),
      toAmount: String(needToAmount),
      replySender: market.sender,
      replyAccount,
    };
    const result = await ctx.models.maker_transaction.upsert(upsertParams, {
      transaction: t,
    });
    await t.commit();
    return result[0].toJSON();
  } catch (error) {
    await t.rollback();
    throw error;
  }

}
export async function processMakerSendUserTx(
  ctx: Context,
  trx: transactionAttributes,
) {
  // const makerAddress = trx.from;
  const models = ctx.models;
  const userSendTxNonce = getAmountFlag(trx.chainId, String(trx.value));
  const t = await ctx.sequelize.transaction();
  try {
    // let userSendTx;
    // if ([4, 44].includes(trx.chainId)) {
    const userSendTx = await models.transaction.findOne({
      attributes: ["id", "from", "to", "chainId", "symbol", "nonce"],
      raw: true,
      order: [["timestamp", "desc"]],
      where: {
        memo: trx.chainId,
        nonce: userSendTxNonce,
        status: 1,
        symbol: trx.symbol,
        timestamp: {
          [Op.lte]: dayjs(trx.timestamp).add(1, "m").toDate(),
        },
        value: {
          [Op.gte]: String(trx.value),
        },
      },
      include: [
        {
          // required: false,
          attributes: ["id"],
          model: models.maker_transaction,
          as: "maker_transaction",
          where: {
            replySender: trx.from,
            replyAccount: trx.to,
          },
        },
      ],
      transaction: t
    });
    // } else {
    //   const where = {
    //     to: makerAddress,
    //     from: trx.to,
    //     memo: trx.chainId,
    //     nonce: userSendTxNonce,
    //     status: 1,
    //     symbol: trx.symbol,
    //     timestamp: {
    //       [Op.lte]: dayjs(trx.timestamp).add(2, "m").toDate(),
    //     },
    //   };
    //   userSendTx = await models.transaction.findOne({
    //     attributes: ["id", "from", "chainId", "symbol", "nonce"],
    //     raw: true,
    //     where,
    //   });
    // }
    const replySender = trx.from;
    const replyAccount = trx.to;
    let result;
    if (userSendTx?.id && userSendTx.from) {
      const transcationId = TransactionID(
        String(userSendTx.from),
        userSendTx.chainId,
        userSendTx.nonce,
        userSendTx.symbol,
      );
      result = await models.maker_transaction.upsert({
        transcationId,
        inId: userSendTx.id,
        outId: trx.id,
        fromChain: userSendTx.chainId,
        toChain: trx.chainId,
        toAmount: String(trx.value),
        replySender,
        replyAccount,
      }, {
        transaction: t
      });
    } else {
      result = await ctx.models.maker_transaction.upsert({
        outId: trx.id,
        toChain: Number(trx.chainId),
        toAmount: String(trx.value),
        replySender,
        replyAccount,
      }, {
        transaction: t
      });
    }
    await t.commit()
    return result[0].toJSON()
  } catch (error) {
    await t.rollback();
    throw error;
  }

}
async function startMatch(ctx: Context) {
  let page = 1,
    isLock = false;
  ctx.logger.info('Start matching task...')
  const matchTimerFun = async () => {
    try {
      if (!isLock) {
        isLock = true;
        const list = await matchSourceData(ctx, page, 100);
        page++;
        isLock = false;
        if (list.length <= 0 || page >= 50) {
          ctx.logger.info('The matching task has been executed.....')
          timer && clearInterval(timer);
        }
      }
      return isLock;
    } catch (error) {
      ctx.logger.error("startMatch error:", error);
      isLock = false;
      timer && clearInterval(timer);
    }
  };
  // eslint-disable-next-line
  const timer = setInterval(matchTimerFun, 5000);
}
async function bootstrap() {
  const ctx = new Context();
  const instances = Number(process.env.INSTANCES || 1);
  const instanceId = Number(process.env.NODE_APP_INSTANCE || 0);
  try {
    subscribeInject(ctx);
    ctx.makerConfigs = await convertMarketListToFile(
      makerList,
      ctx.config.L1L2Mapping,
    );
    const chainGroup = groupWatchAddressByChain(ctx.makerConfigs);
    const scanChain = new ScanChainMain(ctx.config.chains);
    for (const id in chainGroup) {
      if (Number(id) % instances !== instanceId) {
        continue;
      }
      ctx.logger.info(
        `Start Subscribe ChainId: ${id}, instanceId:${instanceId}, instances:${instances}`,
      );
      pubSub.subscribe(`${id}:txlist`, async (txlist: Array<ITransaction>) => {
        ctx.logger.info(
          `Received subscription transaction, interior ChainId:${id},instanceId:${instanceId}, instances:${instances}`, { txlist }
        );
        try {
          await bulkCreateTransaction(ctx, txlist).then((txList: any[]) =>
            txList.forEach(tx => {
              matchSourceDataByTx(ctx, tx).catch(error => {
                ctx.logger.error(
                  "bulkCreateTransaction matchSourceDataByTx error：",
                  error,
                );
              });
            }),
          );
        } catch (error) {
          ctx.logger.error("bulkCreateTransaction error：", error);
        }
      });
      await scanChain.startScanChain(id, chainGroup[id]).catch(error => {
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
  // instanceId == 0 && startMatch(ctx);
}

bootstrap().catch(error => {
  console.error("start app error", error);
});

process.on("uncaughtException", (err: Error) => {
  console.error("Global Uncaught exception:", err);
});

process.on("unhandledRejection", (err: Error, promise) => {
  console.error(
    "There are failed functions where promise is not captured：",
    err,
  );
});
