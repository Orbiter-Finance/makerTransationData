import Redis from "ioredis";
import { readFile } from "fs/promises";
import { initModels } from "./models";
import { Config, IMarket } from "./types";
import { LoggerService } from "orbiter-chaincore/src/utils";
import { Logger } from "winston";
import { convertMarketListToFile } from "./utils";
import { TCPInject } from "./service/tcpInject";
import { chains } from "orbiter-chaincore";
import { makerList, makerListHistory } from "./maker";
import Subgraphs from "./service/subgraphs";
import db from "./db";
export class Context {
  public models = initModels(db);
  public logger!: Logger;
  public redis!: Redis;
  public instanceId: number;
  public instanceCount: number;
  public makerConfigs: Array<IMarket> = [];
  public NODE_ENV: "development" | "production" | "test" = <any>(
    (process.env["NODE_ENV"] || "development")
  );
  public isSpv: boolean;
  public config: Config = {
    chains: [],
    chainsTokens: [],
    subgraphEndpoint: "",
    crossAddressTransferMap: {
      "0x07c57808b9cea7130c44aab2f8ca6147b04408943b48c6d8c3c83eb8cfdd8c0b":
        "0x06d1d401ae235ba01e5d8a6ade82a0f17aba7db4f8780194b4d65315071be10b", // eth
      "0x001709eA381e87D4c9ba5e4A67Adc9868C05e82556A53FD1b3A8b1F21e098143":
        "0x01a316c2a9eece495df038a074781ce3983b4dbda665b951cc52a3025690a448", // dai
    },
    L1L2Mapping: {
      "0x80c67432656d59144ceff962e8faf8926599bcf8":
        "0x07c57808b9cea7130c44aab2f8ca6147b04408943b48c6d8c3c83eb8cfdd8c0b",
      "0x095d2918b03b2e86d68551dcf11302121fb626c9":
        "0x001709ea381e87d4c9ba5e4a67adc9868c05e82556a53fd1b3a8b1f21e098143",
      "0x0043d60e87c5dd08c86c3123340705a1556c4719":
        "0x001709ea381e87d4c9ba5e4a67adc9868c05e82556a53fd1b3a8b1f21e098143",
    },
  };
  private async initChainConfigs() {
    const file = `${
      this.NODE_ENV === "production" ? "chains" : "testnet"
    }.json`;
    const result = await readFile(`./src/config/${file}`);
    const configs = JSON.parse(result.toString());
    chains.fill(configs);
    this.config.chains = chains.getAllChains();
    return configs;
  }
  private initLogger() {
    this.logger = LoggerService.createLogger({
      dir: `${process.env.RUNTIME_DIR || ""}/logs${this.instanceId}`,
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
        try {
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
        } catch (error) {
          this.logger.error("setInterval error:", error);
        }
      }, 1000 * 10);
    } else {
      await fetchFileMakerList(this);
    }
  }
  constructor() {
    this.isSpv = process.env["IS_SPV"] === "1";
    this.config.subgraphEndpoint = process.env["SUBGRAPHS"] || "";
    this.instanceId = Number(process.env.NODE_APP_INSTANCE || 0);
    this.instanceCount = Number(process.env.INSTANCES || 1);
    this.initLogger();
    this.initRedis();
    new TCPInject(this);
  }
}
export async function fetchFileMakerList(ctx: Context) {
  // -------------
  ctx.makerConfigs = await convertMarketListToFile(makerList, ctx);
  const makerConfigsHistory = await convertMarketListToFile(
    makerListHistory,
    ctx,
  );
  ctx.makerConfigs.push(...makerConfigsHistory);
}
