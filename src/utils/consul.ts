import "dotenv/config";
import Consul from "consul";
import {
  convertChainConfig,
  convertMakerConfig
} from "./maker";
import { Context } from "../context";
import { IMakerCfg } from "../types";
import { chains } from "orbiter-chaincore";


export const consul = process.env["CONSUL_HOST"]
    ? new Consul({
          host: process.env["CONSUL_HOST"],
          port: process.env["CONSUL_PORT"],
          secure: false,
          defaults: {
              token: process.env["CONSUL_TOKEN"],
          },
      })
    : null;

export async function watchConsulConfig(ctx: Context) {
    console.log("======== consul config init begin ========");
    const keys = [
        ...(await consul.kv.keys("maker/rule/config/common")),
    ];
    for (const key of keys) {
        try {
            await watchMakerConfig(ctx, key);
        } catch (e) {
            // TODO TG
          ctx.logger.error(e);
        }
    }
    console.log("======== consul config init end ========");
}

async function watchMakerConfig(ctx: Context, key: string) {
    return new Promise((resolve, reject) => {
        const watcher = consul.watch({ method: consul.kv.get, options: { key } });
        watcher.on("change", (data: any) => {
            if (!data?.Key) {
                ctx.logger.error(`Consul can't find key ${key}`, data);
                return;
            }
            console.log(`Configuration updated: ${data.Key}`);
            if (data.Value) {
                try {
                    const config = JSON.parse(data.Value);
                    if (key === "maker/rule/config/common/chain.json") {
                        updateChain(ctx, config);
                    }
                    if (key.indexOf("maker/rule/config/common/trading-pairs") !== -1) {
                        updateTradingPairs(ctx, key.split("maker/rule/config/common/trading-pairs/")[1], config);
                    }
                    resolve(config);
                } catch (e) {
                    ctx.logger.error(`Consul watch refresh config error: ${e.message} dataValue: ${data.Value}`);
                    resolve(null);
                }
            } else {
                resolve(null);
            }
        });
        watcher.on("error", (err: Error) => {
            ctx.logger.error(`Consul watch ${key} error: `, err);
            resolve(null);
        });
    });
}

function updateChain(ctx: Context, config: any) {
    if (config && config.length && config.find(item => +item.internalId === 1 || +item.internalId === 5)) {
        const configs = <any>convertChainConfig("NODE_APP", config);
        chains.fill(configs);
        if (ctx.config.chains && ctx.config.chains.length) {
          compare(ctx.config.chains, chains.getAllChains(), function(msg) {
            ctx.logger.info(msg);
          });
        }
        refreshConfig(ctx);
        ctx.logger.info(`update chain config success`);
    } else {
        ctx.logger.error(`update chain config fail`);
    }
}

function updateTradingPairs(ctx: Context, makerAddress: string, config: any) {
    if (config && Object.keys(config).length) {
        if(allMaker[makerAddress]) {
          compare(allMaker[makerAddress], config, function(msg) {
            ctx.logger.info(msg);
          });
        }
        allMaker[makerAddress] = config;
        refreshConfig(ctx);
        ctx.logger.info(`update ${makerAddress} trading pairs success`);
    } else {
        ctx.logger.error(`update maker config fail`);
    }
}

function refreshConfig(ctx: Context) {
  ctx.config.chains = chains.getAllChains();
  const makerConfigs = [];
  for (const makerAddress in allMaker) {
    makerConfigs.push(...convertMakerConfig(ctx.config.chains, allMaker[makerAddress], makerAddress));
  }
  ctx.makerConfigs = JSON.parse(JSON.stringify(makerConfigs));
}

function compare(obj1: any, obj2: any, cb: Function, superKey?: string) {
  if (obj1 instanceof Array && obj2 instanceof Array) {
    compareList(obj1, obj2, cb, superKey);
  } else if (typeof obj1 === "object" && typeof obj2 === "object") {
    compareObj(obj1, obj2, cb, superKey);
  }
}

function compareObj(obj1: any, obj2: any, cb: Function, superKey?: string) {
  for (const key in obj1) {
    if (obj1[key] instanceof Array) {
      compareList(obj1[key], obj2[key], cb, superKey ? `${superKey} ${key}` : key);
    } else if (typeof obj1[key] === "object") {
      compareObj(obj1[key], obj2[key], cb, superKey ? `${superKey} ${key}` : key);
    } else if (obj1[key] !== obj2[key]) {
      cb(`${superKey ? (superKey + " ") : ""}${key}:${obj1[key]} ==> ${obj2[key]}`);
    }
  }
}

function compareList(arr1: any[], arr2: any[], cb: Function, superKey?: string) {
  if (arr1.length !== arr2.length) {
    cb(`${superKey ? (superKey + " ") : ""}count:${arr1.length} ==> ${arr2.length}`);
    return;
  }
  for (let i = 0; i < arr1.length; i++) {
    if (typeof arr1[i] === "object") {
      compareObj(arr1[i], arr2[i], cb, superKey);
    } else if (arr1[i] !== arr2[i]) {
      cb(`${superKey ? (superKey + " ") : ""}${arr1[i]} ==> ${arr2[i]}`);
    }
  }
}

const allMaker: { [makerAddress: string]: IMakerCfg } = {};
