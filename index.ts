import "dotenv/config";
import { Chain, getChainByChainId } from "orbiter-chaincore/src/utils/chains";
import { LoggerService } from "orbiter-chaincore/src/utils/logger";
import { ScanChainMain } from "orbiter-chaincore";
import { convertMarketListToFile, groupWatchAddressByChain } from "./src/utils";
import { makerList } from "./maker";
import { Sequelize } from "sequelize";
import { initModels, transactionAttributes } from "./src/models/init-models";
import { IMarket } from "./src/types";
import { padStart } from "lodash";
import { getAmountFlag, getAmountToSend } from "./src/utils/oldUtils";
import { NetUtil } from "./src/bin/net";
import { equals } from "orbiter-chaincore/src/utils/core";
import {
  ITransaction,
  TransactionStatus,
} from "orbiter-chaincore/src/types/transaction";
import { IChainConfig } from "orbiter-chaincore/src/types";
import mainChainConfigs from "./src/config/chains.json";
import testChainConfigs from "./src/config/testnet.json";
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
  chains: Array<IChainConfig>;
}
export class Context {
  public models;
  public logger;
  public sequelize: Sequelize;
  public makerConfigs: Array<IMarket> = [];
  public config: Config = {
    chains: [],
    L1L2Mapping: {
      "4": {},
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
    if (NODE_ENV === "prod") {
      this.config.chains = <any>mainChainConfigs;
    } else {
      this.config.chains = <any>testChainConfigs;
    }
    this.logger = LoggerService.createLogger();
    try {
      const client = NetUtil.createClient();
      client.on("error", (error) => {
        this.logger.error(error);
      });
      client.on("data", (req: string) => {
        const body = JSON.parse(req);
        if (body.op === "inject") {
          const chain = Chain.configs.find((row) =>
            equals(row.internalId, body.data.key)
          );
          if (!chain) {
            return this.logger.error(
              `Inject Key Not Find Chain Config ${body.data.key}`
            );
          }
          chain.api.key = body.data.value;
        }
      });
    } catch (error) {
      this.logger.error(`NetUtil Client Inject Service Error`, error);
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
  const trxid = TransactionID(trx.from, trx.chainId, trx.nonce, trx.symbol);
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
      from: market.sender,
      to: replyAccount,
      chainId: toChainId,
      symbol: trx.symbol,
      memo: trx.nonce,
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
      },
      order: [["id", "desc"]],
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
    };
    userSendTx = await models.transaction.findOne({
      attributes: ["id", "from", "chainId", "symbol", "nonce"],
      raw: true,
      where,
      order: [["id", "desc"]],
    });
  }
  const replySender = trx.from;
  const replyAccount = trx.to;
  if (userSendTx?.id) {
    const trxId = TransactionID(
      userSendTx.from,
      userSendTx.chainId,
      userSendTx.nonce,
      userSendTx.symbol
    );
    await models.maker_transaction.upsert({
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
    await ctx.models.maker_transaction.upsert({
      outId: trx.id,
      toChain: Number(trx.chainId),
      toAmount: String(trx.value),
      replySender,
      replyAccount,
    });
  }
}
async function processSubTx(ctx: Context, tx: ITransaction) {
  // ctx.logger.info(`processSubTx:${tx.hash}`);
  const chainConfig = getChainByChainId(tx.chainId);
  if (!chainConfig) {
    throw new Error(`chainId ${tx.chainId} not found`);
  }
  // ctx.logger.info(
  //   `[${chainConfig.name}] chain:${chainConfig.internalId}, hash:${tx.hash}`
  // );
  const models = ctx.models;
  let memo = getAmountFlag(Number(chainConfig.internalId), String(tx.value));
  if (["9", "99"].includes(chainConfig.internalId) && tx.extra) {
    memo = ((<any>tx.extra).memo % 9000) + "";
  }
  //   const dbTran = await ctx.sequelize.transaction();
  const txData: any = {
    hash: tx.hash,
    nonce: String(tx.nonce),
    blockHash: tx.blockHash,
    blockNumber: tx.blockNumber,
    transactionIndex: tx.transactionIndex,
    from: tx.from,
    to: tx.to,
    value: tx.value.toString(),
    symbol: tx.symbol,
    gasPrice: tx.gasPrice,
    gas: tx.gas,
    input: tx.input != "0x" ? tx.input : null,
    status: tx.status,
    tokenAddress: tx.tokenAddress || "",
    timestamp: new Date(tx.timestamp * 1000),
    fee: tx.fee.toString(),
    feeToken: tx.feeToken,
    chainId: Number(chainConfig.internalId),
    source: tx.source,
    extra: tx.extra,
    memo,
  };
  if (
    [3, 33, 8, 88, 12, 512].includes(Number(txData.chainId)) &&
    txData.status === TransactionStatus.PENDING
  ) {
    txData.status = TransactionStatus.COMPLETE;
  }
  try {
    const [trx] = await models.transaction.upsert(txData);
    const isMakerSend =
      ctx.makerConfigs.findIndex((row) => equals(row.sender, tx.from)) !== -1;
    const isUserSend =
      ctx.makerConfigs.findIndex((row) => equals(row.recipient, tx.to)) !== -1;
    if (trx.id && isMakerSend) {
      txData.id = trx.id;
      await processMakerSendUserTx(ctx, txData);
    } else if (trx.id && isUserSend) {
      txData.id = trx.id;
      await processUserSendMakerTx(ctx, txData);
    } else {
      ctx.logger.error(
        `This transaction is not matched to the merchant address: ${tx.hash}`
      );
    }
  } catch (error: any) {
    ctx.logger.error("processSubTx error:", error);
    throw error;
  }
}

async function bootstrap() {
  const ctx = new Context();
  try {
    ctx.makerConfigs = await convertMarketListToFile(
      makerList,
      ctx.config.L1L2Mapping
    );
    const chainGroup = groupWatchAddressByChain(ctx.makerConfigs);
    const scanChain = new ScanChainMain(ctx.config.chains);
    for (const id in chainGroup) {
      scanChain.mq.subscribe(`${id}:txlist`, (txlist: Array<ITransaction>) => {
        for (const tx of txlist) {
          processSubTx(ctx, tx);
        }
      });
      await scanChain.startScanChain(id, chainGroup[id]);
    }
  } catch (error: any) {
    ctx.logger.error("startSub error:", error);
  }
}

bootstrap();
