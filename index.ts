import "dotenv/config";
import { ScanChainMain, chains, pubSub } from "orbiter-chaincore";
import logger from "orbiter-chaincore/src/utils/logger";
import {
  convertMarketListToFile,
  groupWatchAddressByChain,
  sleep,
} from "./src/utils";
import { makerList } from "./maker";
import { Op, Sequelize } from "sequelize";
import { initModels, transactionAttributes } from "./src/models/init-models";
import { IMarket } from "./src/types";
import { padStart } from "lodash";
import { getAmountFlag, getAmountToSend } from "./src/utils/oldUtils";
import { equals } from "orbiter-chaincore/src/utils/core";
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
export function TransactionID(
  fromAddress: string,
  fromChainId: number | string,
  fromTxNonce: string | number,
  symbol: string | undefined
) {
  return `${fromAddress}${padStart(String(fromChainId), 4, "00")}${
    symbol || "NULL"
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
      })
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
        .find((row) => equals(row.internalId, body.data.key));
      if (!chain) {
        return ctx.logger.error(
          `Inject Key Not Find Chain Config ${body.data.key}`
        );
      }
      chain.api.key = body.data.value;
    }
  });
  // client.on("end", () => {
  //   console.log("Send Data end");
  // });
  client.on("error", (error) => {
    if ((Date.now() / 1000) * 10 === 0) {
      console.error("sub error:", error);
    }
    sleep(1000 * 10);
    subscribeInject(ctx);
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
    this.logger = logger;
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
        logging: false,
      }
    );
    this.models = initModels(this.sequelize);
    this.sequelize.sync();
  }
}
export async function processUserSendMakerTx(
  ctx: Context,
  trx: transactionAttributes
) {
  // user send to Maker
  const fromChainId = Number(trx.chainId);
  const trxid = TransactionID(
    String(trx.from),
    trx.chainId,
    trx.nonce,
    trx.symbol
  );
  let toChainId = getAmountFlag(fromChainId, String(trx.value));
  if ([9, 99].includes(fromChainId) && trx.extra) {
    toChainId = ((<any>trx.extra).memo % 9000) + "";
  }
  const market = ctx.makerConfigs.find(
    (m) =>
      equals(m.fromChain.id, String(fromChainId)) &&
      equals(m.toChain.id, toChainId) &&
      equals(m.fromChain.symbol, trx.symbol) &&
      equals(m.fromChain.tokenAddress, trx.tokenAddress)
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
      trx.nonce
    )?.tAmount || "0";
  let replyAccount: string | undefined = trx.from;
  if (["44", "4", "11", "511"].includes(toChainId)) {
    const ext = (<any>trx.extra)["ext"] || "";
    // 11,511 0x02 first
    // 4, 44 0x03 first
    replyAccount = `0x${ext.substring(4)}`;
  }
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
        [Op.gte]: dayjs(trx.timestamp).subtract(2, "m"),
      },
    },
    order: [["id", "desc"]],
  });
  const upsertParams = {
    transcationId: trxid,
    inId: trx.id,
    outId: makerSendTx ? makerSendTx.id : undefined,
    fromChain: trx.chainId,
    toChain: Number(toChainId),
    toAmount: String(needToAmount),
    replySender: market.sender,
    replyAccount,
  };
  await ctx.models.maker_transaction.upsert(upsertParams);
}
export async function processMakerSendUserTx(
  ctx: Context,
  trx: transactionAttributes
) {
  let makerAddress = trx.from;
  const models = ctx.models;
  let userSendTxNonce = getAmountFlag(trx.chainId, String(trx.value));

  let userSendTx;
  if ([4, 44].includes(trx.chainId)) {
    userSendTx = await models.transaction.findOne({
      attributes: ["id"],
      raw: true,
      where: {
        // to: makerAddress,
        // from: trx.to,
        memo: trx.chainId,
        nonce: userSendTxNonce,
        status: 1,
        symbol: trx.symbol,
        timestamp: {
          [Op.lte]: dayjs(trx.timestamp).add(2, "m"),
        },
      },
      include: [
        {
          attributes: ["id"],
          model: models.maker_transaction,
          as: "maker_transaction",
          where: {
            replySender: trx.from,
            replyAccount: trx.to,
          },
        },
      ],
    });
  } else {
    const where = {
      to: makerAddress,
      from: trx.to,
      memo: trx.chainId,
      nonce: userSendTxNonce,
      status: 1,
      symbol: trx.symbol,
      timestamp: {
        [Op.lte]: dayjs(trx.timestamp).add(2, "m"),
      },
    };
    userSendTx = await models.transaction.findOne({
      attributes: ["id", "from", "chainId", "symbol", "nonce"],
      raw: true,
      where,
    });
  }
  const replySender = trx.from;
  const replyAccount = trx.to;
  if (userSendTx?.id) {
    const trxId = TransactionID(
      String(userSendTx.from),
      userSendTx.chainId,
      userSendTx.nonce,
      userSendTx.symbol
    );
    return await models.maker_transaction.upsert({
      transcationId: trxId,
      inId: userSendTx.id,
      outId: trx.id,
      fromChain: userSendTx.chainId,
      toChain: trx.chainId,
      toAmount: String(trx.value),
      replySender,
      replyAccount,
    });
  } else {
    return await ctx.models.maker_transaction.upsert({
      outId: trx.id,
      toChain: Number(trx.chainId),
      toAmount: String(trx.value),
      replySender,
      replyAccount,
    });
  }
}
async function startMatch(ctx: Context) {
  let page = 1,
    isLock = false;
  let timer = setInterval(async () => {
    try {
      if (!isLock) {
        isLock = true;
        const list = await matchSourceData(ctx, page, 500);
        page++;
        isLock = false;
        if (list.length <= 0) {
          ctx.logger.info(
            "---------------------- startMatch end --------------------"
          );
          clearInterval(timer);
        }
      }
    } catch (error) {
      isLock = false;
      ctx.logger.error("startMatch error:", error);
    }
  }, 5000);
}
async function bootstrap() {
  const ctx = new Context();
  const instances = Number(process.env.INSTANCES || 1);
  const instanceId = Number(process.env.NODE_APP_INSTANCE || 0);
  try {
    subscribeInject(ctx);
    ctx.makerConfigs = await convertMarketListToFile(
      makerList,
      ctx.config.L1L2Mapping
    );
    const chainGroup = groupWatchAddressByChain(ctx.makerConfigs);
    const scanChain = new ScanChainMain(ctx.config.chains);
    for (const id in chainGroup) {
      if (Number(id) % instances !== instanceId) {
        continue;
      }
      ctx.logger.info(
        `Start Subscribe ChainId: ${id}, instanceId:${instanceId}, instances:${instances}`
      );
      pubSub.subscribe(`${id}:txlist`, async (txlist: Array<ITransaction>) => {
        try {
          await bulkCreateTransaction(ctx, txlist).then((txList: any[]) =>
            txList.forEach((tx) => {
              try {
                matchSourceDataByTx(ctx, tx)
              } catch (error) {
                ctx.logger.error("bulkCreateTransaction matchSourceDataByTx error：", error);
              }
            })
          );
        } catch (error) {
          ctx.logger.error("bulkCreateTransaction error：", error);
        }
      });
      await scanChain.startScanChain(id, chainGroup[id]);
    }
    process.on("SIGINT", async () => {
      scanChain.pause();
      process.exit(0);
    });
  } catch (error: any) {
    ctx.logger.error("startSub error:", error);
  }
  // instanceId == 0 && startMatch(ctx);
}

bootstrap();

process.on("uncaughtException", (err: Error) => {
  console.error("Global Uncaught exception:", err);
});

process.on("unhandledRejection", (err: Error, promise) => {
  console.error(
    "There are failed functions where promise is not captured：",
    err
  );
});
