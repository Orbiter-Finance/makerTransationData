import Redis from "ioredis";
import { readFile } from "fs/promises";
import {
  initModels,
  maker_transaction,
  transaction,
} from "./models/init-models";
import { Config, IMarket } from "./types";

import { LoggerService } from "orbiter-chaincore/src/utils";
import { Sequelize } from "sequelize";
import { Logger } from "winston";
import { convertChainLPToOldLP, convertMarketListToFile } from "./utils";
import { TCPInject } from "./service/tcpInject";
import { chains } from "orbiter-chaincore";
import { makerList, makerListHistory } from "./maker";

export class Context {
  public models!: {
    transaction: typeof transaction;
    maker_transaction: typeof maker_transaction;
  };
  public logger!: Logger;
  public redis!: Redis;
  public sequelize!: Sequelize;
  public instanceId: number;
  public instanceCount: number;
  public makerConfigs: Array<IMarket> = [];
  public NODE_ENV: string;
  public isSpv: boolean;
  public config: Config = {
    chains: [],
    subgraphEndpoint: "",
    makerTransferTimeout: 10, // min
    L1L2Mapping: {
      "4": {
        "0x80c67432656d59144ceff962e8faf8926599bcf8":
          "0x07c57808b9cea7130c44aab2f8ca6147b04408943b48c6d8c3c83eb8cfdd8c0b",
      },
      "44": {
        "0x0043d60e87c5dd08c86c3123340705a1556c4719":
          "0x033b88fc03a2ccb1433d6c70b73250d0513c6ee17a7ab61c5af0fbe16bd17a6e",
      },
    },
  };
  private initDB() {
    const { DB_HOST, DB_NAME, DB_USER, DB_PASS, DB_PORT, DB_TIMEZONE } = <any>(
      process.env
    );

    this.sequelize = new Sequelize(
      DB_NAME || "orbiter",
      String(DB_USER),
      DB_PASS,
      {
        host: DB_HOST,
        port: Number(DB_PORT) || 3306,
        dialect: "mysql",
        timezone: DB_TIMEZONE || "+00:00",
        logging: this.NODE_ENV != "prod",
      },
    );
    this.models = initModels(this.sequelize);
    this.sequelize.sync().catch(error => {
      this.logger.error("sequelize sync error:", error);
    });
  }
  private async initChainConfigs() {
    const file = `${this.NODE_ENV === "prod" ? "chains" : "testnet"}.json`;
    const result = await readFile(`./src/config/${file}`);
    const configs = JSON.parse(result.toString());
    this.config.chains = configs;
    return configs;
  }
  private initLogger() {
    this.logger = LoggerService.createLogger({
      dir: `${process.env.RUNTIME_DIR || ""} / logs${this.instanceId}`,
    });
  }
  private initRedis() {
    const { REDIS_PORT, REDIS_HOST, REDIS_DB } = <any>process.env;
    this.redis = new Redis({
      port: Number(REDIS_PORT || 6379), // Redis port
      host: REDIS_HOST || "127.0.0.1", // Redis host
      db: Number(REDIS_DB || this.instanceId), // Defaults to 0
    });
  }
  public async fromSubgraphFetchLp(): Promise<void> {
    const lpList = await fecthSubgraphFetchLp(this.config.subgraphEndpoint);
    if (!(lpList && Array.isArray(lpList))) {
      this.logger.error("Get LP List Fail:");
      return;
    }
    const newLPList = convertChainLPToOldLP(lpList);

    if (newLPList.length > 0) {
      this.makerConfigs = newLPList;
    }
  }
  async init() {
    await this.initChainConfigs();
    chains.fill(this.config.chains);
    // Update LP regularly
    if (this.isSpv) {
      try {
        await this.fromSubgraphFetchLp();
      } catch (error) {
        this.logger.error("init LP error", error);
      }
      // setInterval(() => {
      //   this.fetchLP().catch(error => {
      //     this.logger.error("fetchLP error:", error);
      //   });
      // }, 1000 * 10);
    } else {
      await fetchFileMakerList(this);
    }
  }
  constructor() {
    this.NODE_ENV = process.env["NODE_ENV"] || "dev";
    this.isSpv = process.env["IS_SPV"] === "1";
    this.config.subgraphEndpoint = process.env["SUBGRAPHS"] || "";
    this.instanceId = Number(process.env.NODE_APP_INSTANCE || 0);
    this.instanceCount = Number(process.env.INSTANCES || 1);
    this.initLogger();
    this.initRedis();
    this.initDB();
    new TCPInject(this);
  }
}
export async function fetchFileMakerList(ctx: Context) {
  // -------------
  ctx.makerConfigs = await convertMarketListToFile(
    makerList,
    ctx.config.L1L2Mapping,
  );
  const makerConfigsHistory = await convertMarketListToFile(
    makerListHistory,
    ctx.config.L1L2Mapping,
  );
  ctx.makerConfigs.push(...makerConfigsHistory);
}
export const fecthSubgraphFetchLp = async (endpoint: string) => {
  const headers = {
    "content-type": "application/json",
    // "Authorization": "<token>"
  };
  const graphqlQuery = {
    operationName: "fetchLpList",
    query: `query fetchLpList {
      lpEntities(where: { stopTime: null }) {
        id
        createdAt
        maxPrice
        minPrice
        sourcePresion
        destPresion
        tradingFee
        gasFee
        startTime
        stopTime
          maker {
          id
          owner
        }
          pair {
          id
          sourceChain
          destChain
          sourceToken
          destToken
          ebcId
        }
      }
    }`,
    variables: {},
  };

  const options = {
    method: "POST",
    headers: headers,
    body: JSON.stringify(graphqlQuery),
  };

  const response = await fetch(endpoint, options);
  const data = await response.json();
  return data.data["lpEntities"];
};
