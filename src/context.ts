import Redis from "ioredis";
import { initModels } from "./models";
import { Config, IMarket } from "./types";
import { Logger } from "winston";
import { convertChainConfig, convertMakerConfig } from "./utils";
import { chains } from "orbiter-chaincore";
import db from "./db";
import { WinstonX } from "orbiter-chaincore/src/packages/winstonX";
import MQProducer from "./service/Rabbit";
export class Context {
  public models = initModels(db);
  public logger!: Logger;
  public redis!: Redis;
  public instanceId: number;
  public instanceCount: number;
  public mq!: MQProducer;
  public makerConfigs: Array<IMarket> = [];
  public NODE_ENV: "development" | "production" | "test" = <any>(
    (process.env["NODE_ENV"] || "development")
  );
  public isSpv: boolean;
  public config: Config = {
    chains: [],
    chainsTokens: [],
    subgraphEndpoint: "",
    crossAddressTransferMap: {},
  };
  public channel: any;
  private async initChainConfigs() {
    const configs = <any>convertChainConfig("NODE_APP");
    chains.fill(configs);
    this.config.chains = chains.getAllChains();
    return configs;
  }
  private initLogger() {
    // const dir = path.join(
    //   process.env.logDir || process.cwd() + "/runtime",
    //   "mtx",
    //   this.instanceId.toString(),
    // );
    this.logger = WinstonX.getLogger(this.instanceId.toString(), {
      logDir: process.env.logDir,
      debug: true,
    });
  }
  private initRedis() {
    const { REDIS_PORT, REDIS_HOST, REDIS_DB, REDIS_PASS } = <any>process.env;
    this.redis = new Redis({
      port: Number(REDIS_PORT || 6379), // Redis port
      host: REDIS_HOST || "127.0.0.1", // Redis host
      password: REDIS_PASS,
      db: Number(REDIS_DB || this.instanceId), // Defaults to 0
    });
  }
  async setCache(key: string, value: any, time?: number): Promise<void> {
    if (key) {
      if (typeof value == "object") {
        value = JSON.stringify(value);
      }
      this.redis.set(key, value || "");
      // In seconds
      this.redis.expire(key, time || 86400);
    }
  }
  async getCache(key: string): Promise<any> {
    return await new Promise(resolve => {
      this.redis.get(key, function (err, result) {
        if (!result) {
          resolve(null);
          return;
        }
        try {
          resolve(JSON.parse(result));
        } catch (e) {
          resolve(result);
        }
      });
    });
  }
  async init() {
    await this.initChainConfigs();
    // Update LP regularly
    await fetchFileMakerList(this);
    const chainList = chains.getAllChains();
    const chainsIds = chainList
      .filter(
        row => Number(row.internalId) % this.instanceCount === this.instanceId,
      )
      .map(row => row.internalId);
    this.mq = new MQProducer(this, chainsIds);
  }
  constructor() {
    this.isSpv = process.env["IS_SPV"] === "1";
    this.config.subgraphEndpoint = process.env["SUBGRAPHS"] || "";
    this.instanceId = Number(process.env.NODE_APP_INSTANCE || 0);
    this.instanceCount = Number(process.env.INSTANCES || 1);
    this.initLogger();
    this.initRedis();
    // new TCPInject(this);
  }
}
export async function fetchFileMakerList(ctx: Context) {
  ctx.makerConfigs = convertMakerConfig();
}
