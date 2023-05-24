import { isProd } from "./config/config";
import Redis from "ioredis";
import { initModels } from "./models";
import { Config, IMarket } from "./types";
import { Logger } from "winston";
import { convertChainConfig, convertMakerConfig } from "./utils";
import { chains } from "orbiter-chaincore";
import db from "./db";
import { WinstonX } from "orbiter-chaincore/src/packages/winstonX";
import { RabbitMQ } from "./utils/rabbitMQ";
import { equals } from "orbiter-chaincore/src/utils/core";
import { cloneDeep } from "lodash";
export class Context {
  public models = initModels(db);
  public logger!: Logger;
  public redis!: Redis;
  public instanceId: number;
  public instanceCount: number;
  public mq!: RabbitMQ;
  public startTime: number = Date.now();
  public makerConfigs: Array<IMarket> = [];
  public NODE_ENV: "development" | "production" | "test" = <any>(
    (process.env["NODE_ENV"] || "development")
  );
  public isSpv: boolean;
  public config: Config = {
    chains: [],
    chainsTokens: [],
    subgraphEndpoint: "",
    multipleMakers: {
      '*-14': ['0xee73323912a4e3772b74ed0ca1595a152b0ef282', '0x0a88bc5c32b684d467b43c06d9e0899efeaf59df'],
      '14-1': ['0xee73323912a4e3772b74ed0ca1595a152b0ef282', '0x0a88bc5c32b684d467b43c06d9e0899efeaf59df'],
      '14-2': ['0xee73323912a4e3772b74ed0ca1595a152b0ef282', '0x0a88bc5c32b684d467b43c06d9e0899efeaf59df'],
      '14-7': ['0xee73323912a4e3772b74ed0ca1595a152b0ef282', '0x0a88bc5c32b684d467b43c06d9e0899efeaf59df']
    },
    // Address should be in lowercase !!!
    crossAddressTransferMap: {
      "0x80c67432656d59144ceff962e8faf8926599bcf8": "0x646592183ff25a0c44f09896a384004778f831ed",
      "0xe4edb277e41dc89ab076a1f049f4a3efa700bce8": "0x646592183ff25a0c44f09896a384004778f831ed",
      "0xd7aa9ba6caac7b0436c91396f22ca5a7f31664fc": "0x646592183ff25a0c44f09896a384004778f831ed",
      "0x41d3d33156ae7c62c094aae2995003ae63f587b3": "0x646592183ff25a0c44f09896a384004778f831ed",
      "0x095d2918b03b2e86d68551dcf11302121fb626c9": "0x646592183ff25a0c44f09896a384004778f831ed",
      "0xee73323912a4e3772b74ed0ca1595a152b0ef282": "0x646592183ff25a0c44f09896a384004778f831ed",
      "0x0a88bc5c32b684d467b43c06d9e0899efeaf59df": "0x646592183ff25a0c44f09896a384004778f831ed",
      "0x07b393627bd514d2aa4c83e9f0c468939df15ea3c29980cd8e7be3ec847795f0":
        "0x06e18dd81378fd5240704204bccc546f6dfad3d08c4a3a44347bd274659ff328",
      "0x064a24243f2aabae8d2148fa878276e6e6e452e3941b417f3c33b1649ea83e11":
        "0x06e18dd81378fd5240704204bccc546f6dfad3d08c4a3a44347bd274659ff328",
      "0x0411c2a2a4dc7b4d3a33424af3ede7e2e3b66691e22632803e37e2e0de450940":
        "0x06e18dd81378fd5240704204bccc546f6dfad3d08c4a3a44347bd274659ff328",
    },
  };
  private async initChainConfigs() {
    const configs = <any>convertChainConfig("NODE_APP");
    chains.fill(configs);
    this.config.chains = chains.getAllChains();
    return configs;
  }
  private initLogger() {
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
      db: Number(REDIS_DB || 0), // Defaults to 0
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
    // const chainList = chains.getAllChains();
    // const chainsIds = chainList
    //   .filter(
    //     row => Number(row.internalId) % this.instanceCount === this.instanceId,
    //   )
    //   .map(row => row.internalId);
    this.mq = new RabbitMQ({ url: String(process.env["RABBIT_MQ"]) }, this);
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
  if (isProd()) {
    if (process.env["ServerName"] === "all") {
      const mk1 = convertMakerConfig(require(`./config/maker-80c.json`));
      const mk2 = convertMakerConfig(require(`./config/maker-e4e.json`));
      ctx.makerConfigs = [...mk1, ...mk2];
    } else {
      ctx.makerConfigs = convertMakerConfig(
        require(`./config/maker-${process.env[
          "ServerName"
        ]?.toLocaleLowerCase()}.json`),
      );
    }
    const fixMakersConfigs = [];
    for (const key in ctx.config.multipleMakers) {
      const [fromChainId, toChainId] = key.split('-');
      for (const fixMakerAddr of ctx.config.multipleMakers[key]) {
        let pushMakerList = cloneDeep(ctx.makerConfigs);
        if (fromChainId != '*')
          pushMakerList = pushMakerList.filter(row => equals(String(row.fromChain.id), fromChainId))
        if (toChainId != '*')
          pushMakerList = pushMakerList.filter(row => equals(String(row.toChain.id), toChainId))
        pushMakerList = pushMakerList.map(row => {
          row.recipient = fixMakerAddr
          row.sender = fixMakerAddr
          // TAG: crossAddress
          if (row.crossAddress) {

          }
          return row;
        })
        fixMakersConfigs.push(...pushMakerList);
      }
    }
    ctx.makerConfigs.push(...fixMakersConfigs)
  } else {
    const mk1 = convertMakerConfig(require(`./config/makerTest.json`));
    const mk2 = convertMakerConfig(require(`./config/makerTest-2.json`));
    ctx.makerConfigs = [...mk1, ...mk2];
  }
}
