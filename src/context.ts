import Redis from "ioredis";
import { readFile } from "fs/promises";
import {
  initModels,
  maker_transaction,
  transaction,
} from "./models/init-models";
import { Config, IMarket } from "./types";

import { Sequelize } from "sequelize";
import { Logger } from "winston";
import { convertMarketListToFile } from "./utils";
import { TCPInject } from "./service/tcpInject";
import { chains } from "orbiter-chaincore";
import { makerList, makerListHistory } from "./maker";
import Subgraphs from "./service/subgraphs";
import { LoggerService } from "./utils/logger";

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
    chainsTokens: [],
    subgraphEndpoint: "",
    L1L2Mapping: {
      "4": {
        "0x80c67432656d59144ceff962e8faf8926599bcf8":
          "0x07b393627bd514d2aa4c83e9f0c468939df15ea3c29980cd8e7be3ec847795f0",
        // "0x095d2918b03b2e86d68551dcf11302121fb626c9":
        //   "0x001709ea381e87d4c9ba5e4a67adc9868c05e82556a53fd1b3a8b1f21e098143",
        "0x095d2918b03b2e86d68551dcf11302121fb626c9":
          "0x0411c2a2a4dc7b4d3a33424af3ede7e2e3b66691e22632803e37e2e0de450940",
      },
      "44": {
        "0x0043d60e87c5dd08c86c3123340705a1556c4719":
          "0x001709ea381e87d4c9ba5e4a67adc9868c05e82556a53fd1b3a8b1f21e098143",
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
        logging: false,
      },
    );
    this.models = initModels(this.sequelize);
    this.sequelize.sync().catch(error => {
      this.logger.error("sequelize sync error:", error);
    });
  }
  private async initChainConfigs() {
    const file = `${
      this.NODE_ENV === "production" ? "chains" : "testnet"
    }.json`;
    const result = await readFile(`./src/config/${file}`);
    const configs = JSON.parse(result.toString());
    // for (const chain of configs) {
    //   chain.api.key = "";
    // }
    chains.fill(configs);
    this.config.chains = chains.getAllChains();
    return configs;
  }
  private initLogger() {
    this.logger = LoggerService.createLogger(this.instanceId.toString());
  }
  private initRedis() {
    const { REDIS_PORT, REDIS_HOST, REDIS_DB } = <any>process.env;
    this.redis = new Redis({
      port: Number(REDIS_PORT || 6379), // Redis port
      host: REDIS_HOST || "127.0.0.1", // Redis host
      db: Number(REDIS_DB || this.instanceId), // Defaults to 0
    });
  }
  async init() {
    await this.initChainConfigs();
    chains.fill(this.config.chains);
    const subApi = new Subgraphs(this.config.subgraphEndpoint);
    // Update LP regularly
    if (this.isSpv) {
      try {
        this.makerConfigs = await subApi.getAllLp();
      } catch (error) {
        this.logger.error("init LP error", error);
      }
      this.config.chainsTokens = await subApi.getChains();
      setInterval(() => {
        subApi
          .getAllLp()
          .then(result => {
            if (result && result.length > 0) {
              this.makerConfigs = result;
            }
          })
          .catch(error => {
            this.logger.error("setInterval getAllLp error:", error);
          });
        if (Date.now() % 6 === 0) {
          subApi
            .getChains()
            .then(chainsTokens => {
              if (chainsTokens) {
                this.config.chainsTokens = chainsTokens;
              }
            })
            .catch(error => {
              this.logger.error("setInterval getChains error:", error);
            });
        }
      }, 1000 * 10);
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
