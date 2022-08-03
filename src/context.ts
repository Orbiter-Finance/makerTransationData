import Redis from "ioredis";
import {
  initModels,
  maker_transaction,
  transaction,
} from "./models/init-models";
import { Config, IMarket } from "./types";
import mainChainConfigs from "./config/chains.json";
import testChainConfigs from "./config/testnet.json";
import { LoggerService } from "orbiter-chaincore/src/utils";
import { Sequelize } from "sequelize";
import { Logger } from "winston";

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
  private initDB() {
    const { DB_HOST, DB_NAME, DB_USER, DB_PASS, DB_PORT, DEBUG } = <any>(
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
        logging: !!DEBUG,
      },
    );
    this.models = initModels(this.sequelize);
    this.sequelize.sync().catch(error => {
      this.logger.error("sequelize sync error:", error);
    });
  }
  private initChainConfigs() {
    const NODE_ENV = process.env.NODE_ENV;
    if (NODE_ENV === "prod") {
      this.logger.info("Start APP Read Chain Config:[Mainnet]");
      this.config.chains = <any>mainChainConfigs;
    } else {
      this.logger.info("Starp APP Read Chain Config:[Testnet]");
      this.config.chains = <any>testChainConfigs;
    }
  }
  private initLogger() {
    this.logger = LoggerService.createLogger({
      dir: `${process.env.RUNTIME_DIR || ""}/logs${this.instanceId}`,
    });
  }
  private initRedis() {
    const { REDIS_PORT, REDIS_HOST } = <any>process.env;
    this.redis = new Redis(
      Number(REDIS_PORT || 6379),
      REDIS_HOST || "127.0.0.1",
    );
  }
  constructor() {
    this.instanceId = Number(process.env.NODE_APP_INSTANCE || 0);
    this.instanceCount = Number(process.env.INSTANCES || 1);
    this.initLogger();
    this.initRedis();
    this.initDB();
    this.initChainConfigs();
  }
}
