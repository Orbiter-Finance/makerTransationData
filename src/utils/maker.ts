import { Context } from "./../context";
import { BigNumber } from "bignumber.js";
import { equals, isEmpty } from "orbiter-chaincore/src/utils/core";
import {
  IChainCfg,
  IMaker,
  IMakerCfg, IMakerDataCfg, IMakerDefaultCfg,
  IMarket,
  ITarget,
  IToChain,
  IXvm,
} from "../types";
import { uniq, flatten, clone } from "lodash";
import { chains } from "orbiter-chaincore";
import { makerList, oldMakerList, xvmList } from "../maker";
import testnetChains from "../config/testnet.json";
import mainnetChains from "../config/chains.json";
import axios, { AxiosStatic } from "axios";
import path from "path";
import maker from "../config/maker.json";
import makerDefault from "../config/maker_default.json";
import fs from "fs";
export async function convertMarketListToFile(
  makerList: Array<any>,
  ctx: Context,
): Promise<Array<IMarket>> {
  const crossAddressTransferMap = ctx.config.crossAddressTransferMap;
  const crossAddressMakers: any[] = [];
  const configs = flatten(
    makerList.map(row => {
      return convertPool(row);
    }),
  ).map(row => {
    if ([4, 44].includes(row.toChain.id)) {
      row.sender = ctx.config.L1L2Mapping[row.sender.toLowerCase()];
    }
    if ([4, 44].includes(row.fromChain.id)) {
      // starknet mapping
      row.recipient = ctx.config.L1L2Mapping[row.recipient.toLowerCase()];
    }
    // after
    const item = clone(row);
    for (const addr1 in crossAddressTransferMap) {
      if (equals(row.sender, addr1)) {
        item.sender = crossAddressTransferMap[addr1];
        crossAddressMakers.push(item);
      }
    }
    return row;
  });
  return [...configs, ...crossAddressMakers];
}
export function convertChainLPToOldLP(oldLpList: Array<any>): Array<IMarket> {
  const marketList: Array<IMarket | null> = oldLpList.map(row => {
    try {
      const pair = row["pair"];
      const maker = row["maker"];
      const fromChain = chains.getChainByInternalId(pair.sourceChain);
      const fromToken = fromChain.tokens.find(row =>
        equals(row.address, pair.sourceToken),
      );
      const toChain = chains.getChainByInternalId(pair.destChain);
      const toToken = toChain.tokens.find(row =>
        equals(row.address, pair.destToken),
      );
      const recipientAddress = maker["owner"];
      const senderAddress = maker["owner"];
      const fromChainId = pair.sourceChain;
      const toChainId = pair.destChain;
      const minPrice = new BigNumber(
        Number(row["minPrice"]) / Math.pow(10, Number(row["sourcePresion"])),
      ).toNumber();
      const maxPrice = new BigNumber(
        Number(row["maxPrice"]) / Math.pow(10, Number(row["sourcePresion"])),
      ).toNumber();
      const times = [
        Number(row["startTime"]),
        Number(row["stopTime"] || 9999999999),
      ];

      const lpConfig: IMarket = {
        id: row["id"],
        recipient: recipientAddress,
        sender: senderAddress,
        makerId: maker.id,
        ebcId: pair["ebcId"],
        fromChain: {
          id: Number(fromChainId),
          name: fromChain.name,
          tokenAddress: pair.sourceToken,
          symbol: fromToken?.symbol || "",
          decimals: Number(row["sourcePresion"]),
          maxPrice: maxPrice,
          minPrice: minPrice,
        },
        toChain: {
          id: Number(toChainId),
          name: toChain.name,
          tokenAddress: pair.destToken,
          symbol: toToken?.symbol || "",
          decimals: Number(row["destPresion"]),
        },
        times,
        pool: {
          //Subsequent versions will modify the structure
          makerAddress: recipientAddress,
          c1ID: fromChainId,
          c2ID: toChainId,
          c1Name: fromChain.name,
          c2Name: toChain.name,
          t1Address: pair.sourceToken,
          t2Address: pair.destToken,
          tName: fromToken?.symbol,
          minPrice,
          maxPrice,
          precision: Number(row["sourcePresion"]),
          avalibleDeposit: 1000,
          tradingFee: new BigNumber(
            Number(row["tradingFee"]) /
              Math.pow(10, Number(row["destPresion"])),
          ).toNumber(),
          gasFee: new BigNumber(
            Number(row["gasFee"]) / Math.pow(10, Number(row["destPresion"])),
          ).toNumber(),
          avalibleTimes: times,
        },
      };

      return lpConfig;
    } catch (error) {
      console.error(`convertChainLPToOldLP error:`, row, error);
      return null;
    }
  });
  return marketList.filter(row => !isEmpty(row)) as any;
}
export function groupWatchAddressByChain(makerList: Array<IMarket>): {
  [key: string]: Array<string>;
} {
  const chainIds = uniq(
    flatten(makerList.map(row => [row.fromChain.id, row.toChain.id])),
  );
  const chain: any = {};
  for (const id of chainIds) {
    const recipientAddress = uniq(
      makerList.filter(m => m.fromChain.id === id).map(m => m.recipient),
    );
    const senderAddress = uniq(
      makerList.filter(m => m.toChain.id === id).map(m => m.sender),
    );
    chain[id] = uniq([...senderAddress, ...recipientAddress]);
  }
  return chain;
}
// getNewMarketList().then((result) => {
//   console.log(groupWatchAddressByChain(result), '===result')
// })
export function convertPool(pool: any): Array<IMarket> {
  return [
    {
      id: "",
      makerId: "",
      ebcId: "",
      recipient: pool.makerAddress,
      sender: pool.makerAddress,
      fromChain: {
        id: Number(pool.c1ID),
        name: pool.c1Name,
        tokenAddress: pool.t1Address,
        symbol: pool.tName,
        decimals: pool.precision,
        minPrice: pool.c1MinPrice * Math.pow(10, 18),
        maxPrice: pool.c1MaxPrice * Math.pow(10, 18),
      },
      toChain: {
        id: Number(pool.c2ID),
        name: pool.c2Name,
        tokenAddress: pool.t2Address,
        symbol: pool.tName,
        decimals: pool.precision,
      },
      times: [
        pool["c1AvalibleTimes"][0].startTime,
        pool["c1AvalibleTimes"][0].endTime,
      ],
      pool: {
        //Subsequent versions will modify the structure
        makerAddress: pool.makerAddress,
        c1ID: pool.c1ID,
        c2ID: pool.c2ID,
        c1Name: pool.c1Name,
        c2Name: pool.c2Name,
        t1Address: pool.t1Address,
        t2Address: pool.t2Address,
        tName: pool.tName,
        minPrice: pool.c1MinPrice,
        maxPrice: pool.c1MaxPrice,
        precision: pool.precision,
        avalibleDeposit: pool.c1AvalibleDeposit,
        tradingFee: pool.c1TradingFee,
        gasFee: pool.c1GasFee,
        avalibleTimes: pool.c1AvalibleTimes,
      },
    },
    {
      id: "",
      makerId: "",
      ebcId: "",
      recipient: pool.makerAddress,
      sender: pool.makerAddress,
      fromChain: {
        id: Number(pool.c2ID),
        name: pool.c2Name,
        tokenAddress: pool.t2Address,
        symbol: pool.tName,
        decimals: pool.precision,
        minPrice: pool.c1MinPrice * Math.pow(10, 18),
        maxPrice: pool.c1MaxPrice * Math.pow(10, 18),
      },
      toChain: {
        id: Number(pool.c1ID),
        name: pool.c1Name,
        tokenAddress: pool.t1Address,
        symbol: pool.tName,
        decimals: pool.precision,
      },
      // minPrice: pool.c2MinPrice,
      // maxPrice: pool.c2MaxPrice,
      // precision: pool.precision,
      // avalibleDeposit: pool.c2AvalibleDeposit,
      // tradingFee: pool.c2TradingFee,
      // gasFee: pool.c2GasFee,
      // avalibleTimes: pool.c2AvalibleTimes,
      times: [
        pool["c2AvalibleTimes"][0].startTime,
        pool["c2AvalibleTimes"][0].endTime,
      ],
      pool: {
        //Subsequent versions will modify the structure
        makerAddress: pool.makerAddress,
        c1ID: pool.c1ID,
        c2ID: pool.c2ID,
        c1Name: pool.c1Name,
        c2Name: pool.c2Name,
        t1Address: pool.t1Address,
        t2Address: pool.t2Address,
        tName: pool.tName,
        minPrice: pool.c2MinPrice,
        maxPrice: pool.c2MaxPrice,
        precision: pool.precision,
        avalibleDeposit: pool.c2AvalibleDeposit,
        tradingFee: pool.c2TradingFee,
        gasFee: pool.c2GasFee,
        avalibleTimes: pool.c2AvalibleTimes,
      },
    },
  ];
}

export async function initMakerList() {
  await checkConfig(axios, path.join(__dirname, "/config"), testnetChains, maker, makerDefault);
  const list:IMaker[] = convertMakerList(testnetChains as IChainCfg[], maker as IMakerCfg, makerDefault as IMakerDefaultCfg[]);
  const newMakerList = [...list];
  for (const maker of oldMakerList) {
    if (!list.find(item=>((item.c1ID === maker.c1ID && item.c2ID === maker.c2ID) ||
      (item.c1ID === maker.c2ID && item.c2ID === maker.c1ID))
      && item.tName === maker.tName)) {
      newMakerList.push(maker);
    }
  }
  makerList.push(...newMakerList);
  return newMakerList;
}

async function checkConfig(curl: AxiosStatic, configPath: string, chains: any[], maker: any, makerDefault: any[]) {
  if (!chains || !chains.length && process.env.IPFS_CHAINS) {
    const { data } = await curl.get(process.env.IPFS_CHAINS as string);
    if (typeof data !== "object") {
      await new Promise(resolve => setTimeout(resolve, 3000));
      await checkConfig(curl, configPath, chains, maker, makerDefault);
    } else {
      fs.writeFileSync(path.join(configPath, process.env.NODE_ENV === "production" ? "testnet.json" : "chain.json"), JSON.stringify(data));
    }
  }
  if (!maker || !Object.keys(maker).length && process.env.IPFS_MAKER) {
    const { data } = await curl.get(process.env.IPFS_MAKER as string);
    if (typeof data !== "object") {
      await new Promise(resolve => setTimeout(resolve, 3000));
      await checkConfig(curl, configPath, chains, maker, makerDefault);
    } else {
      fs.writeFileSync(path.join(configPath, "maker.json"), JSON.stringify(data));
    }
  }
  if (!makerDefault || !makerDefault.length && process.env.IPFS_MAKER_DEFAULT) {
    const { data } = await curl.get(process.env.IPFS_MAKER_DEFAULT as string);
    if (typeof data !== "object") {
      await new Promise(resolve => setTimeout(resolve, 3000));
      await checkConfig(curl, configPath, chains, maker, makerDefault);
    } else {
      fs.writeFileSync(path.join(configPath, "maker_default.json"), JSON.stringify(data));
    }
  }
}

function convertMakerList(chainList: IChainCfg[], makerMap: IMakerCfg, makerDefaultList?: IMakerDefaultCfg[]):IMaker[] {
  const v1makerList: IMaker[] = [];
  const noMatchMap:any = {};

  if (makerDefaultList) {
    const defaultMakerMap:any = {};
    for (const makerDefault of makerDefaultList) {
      const chainIdList = makerDefault.chainIdList;
      const symbolList = makerDefault.symbolList;
      const makerData = makerDefault.data;
      for (const fromChainId of chainIdList) {
        for (const toChainId of chainIdList) {
          for (const fromSymbol of symbolList) {
            for (const toSymbol of symbolList) {
              if (fromChainId !== toChainId) {
                const chainIdPair = `${toChainId}-${fromChainId}`;
                const symbolPair = `${fromSymbol}-${toSymbol}`;
                defaultMakerMap[chainIdPair] = defaultMakerMap[chainIdPair] || {};
                defaultMakerMap[chainIdPair][symbolPair] = makerData;
              }
            }
          }
        }
      }
    }
    Object.assign(makerMap, defaultMakerMap);
  }

  for (const chain of chainList) {
    if (chain.tokens && chain.nativeCurrency) {
      chain.tokens.push(chain.nativeCurrency);
    }
  }

  for (const chainIdPair in makerMap) {
    if (!makerMap.hasOwnProperty(chainIdPair)) continue;
    const symbolPairMap = makerMap[chainIdPair];
    const [fromChainId, toChainId] = chainIdPair.split("-");
    const c1Chain = chainList.find(item => +item.internalId === +fromChainId);
    const c2Chain = chainList.find(item => +item.internalId === +toChainId);
    if (!c1Chain) {
      noMatchMap[fromChainId] = {};
      continue;
    }
    if (!c2Chain) {
      noMatchMap[toChainId] = {};
      continue;
    }
    for (const symbolPair in symbolPairMap) {
      if (!symbolPairMap.hasOwnProperty(symbolPair)) continue;
      const makerData: IMakerDataCfg = symbolPairMap[symbolPair];
      const [fromChainSymbol, toChainSymbol] = symbolPair.split("-");
      // handle v1makerList
      if (fromChainSymbol === toChainSymbol) {
        handleV1MakerList(symbolPair, fromChainSymbol, toChainId, fromChainId, c1Chain, c2Chain, makerData);
      }
    }
  }

  function handleV1MakerList(symbolPair: string, symbol: string,
                             toChainId: string, fromChainId: string,
                             c1Chain: IChainCfg, c2Chain: IChainCfg,
                             c1MakerData: IMakerDataCfg) {
    // duplicate removal
    if (v1makerList.find(item =>
      item.c1ID === +toChainId && item.c2ID === +fromChainId &&
      item.tName === symbol)) {
      return;
    }
    const c1Token = c1Chain.tokens.find(item => item.symbol === symbol);
    const c2Token = c2Chain.tokens.find(item => item.symbol === symbol);
    if (!c1Token) {
      noMatchMap[fromChainId] = noMatchMap[fromChainId] || {};
      noMatchMap[fromChainId][symbol] = 1;
      return;
    }
    if (!c2Token) {
      noMatchMap[toChainId] = noMatchMap[toChainId] || {};
      noMatchMap[toChainId][symbol] = 1;
      return;
    }
    // reverse chain data
    const reverseChainIdPair = `${toChainId}-${fromChainId}`;
    if (!makerMap.hasOwnProperty(reverseChainIdPair)) return;
    const reverseSymbolPairMap = makerMap[reverseChainIdPair];
    if (!reverseSymbolPairMap.hasOwnProperty(symbolPair)) return;
    const c2MakerData: IMakerDataCfg = reverseSymbolPairMap[symbolPair];
    if (c1MakerData.makerAddress === c2MakerData.makerAddress) {
      v1makerList.push({
        makerAddress: c1MakerData.makerAddress,
        c1ID: +fromChainId,
        c2ID: +toChainId,
        c1Name: c1Chain.name,
        c2Name: c2Chain.name,
        t1Address: c1Token.address,
        t2Address: c2Token.address,
        tName: symbol,
        c1MinPrice: c1MakerData.minPrice,
        c1MaxPrice: c1MakerData.maxPrice,
        c2MinPrice: c2MakerData.minPrice,
        c2MaxPrice: c2MakerData.maxPrice,
        precision: c1Token.decimals,
        c1TradingFee: c1MakerData.tradingFee,
        c2TradingFee: c2MakerData.tradingFee,
        c1GasFee: c1MakerData.gasFee,
        c2GasFee: c2MakerData.gasFee,
        c1AvalibleTimes: [
          {
            startTime: c1MakerData.startTime,
            endTime: c1MakerData.endTime,
          },
        ],
        c2AvalibleTimes: [
          {
            startTime: c2MakerData.startTime,
            endTime: c2MakerData.endTime,
          },
        ],
      });
    }
  }

  if (Object.keys(noMatchMap).length) {
    for (const chainId in noMatchMap) {
      const symbolMap = noMatchMap[chainId];
      if (Object.keys(symbolMap).length) {
        for (const symbol in symbolMap) {
          if (!symbolMap.hasOwnProperty(symbol)) continue;
          console.warn(`[chains,makerList] Matching failed：chainId-->${chainId},symbol-->${symbol}`);
        }
      } else {
        console.warn(`[chains,makerList] Matching failed：chainId-->${chainId}`);
      }
    }
  } else {
    console.log("[chains,makerList] Matching succeeded");
  }


  return v1makerList;
}
export async function convertMarketListToXvmList(makerList: Array<IMarket>) {
  const chains: IChainCfg[] = process.env.NODE_ENV === "production" ? <IChainCfg[]>mainnetChains : <IChainCfg[]>testnetChains;
  chains.find(item => item.internalId);
  const xvmContractMap: any = {};
  for (const chain of chains) {
    if (chain.xvmList && chain.xvmList.length) {
      xvmContractMap[+chain.internalId] = chain.xvmList[0];
    }
  }
  const cloneMakerList: Array<IMarket> = JSON.parse(JSON.stringify(makerList));
  const allXvmList: IXvm[] = [];
  const targetList: { chainId: number, tokenAddress: string, symbol: string, precision: number, toChains: IToChain[] }[] = [];
  const toChainList: { id: number, name: string, tokenAddress: string, symbol: string, decimals: number }[] =
    cloneMakerList.map(item => item.toChain);
  let fromChainIdList: number[] = [];
  for (const maker of cloneMakerList) {
    const chainId: number = maker.fromChain.id;
    fromChainIdList.push(chainId);
    const tokenAddress: string = maker.fromChain.tokenAddress;
    const symbol: string = maker.fromChain.symbol;
    const precision: number = maker.fromChain.decimals;
    const toChains: IToChain[] = [];
    for (const toChain of toChainList) {
      if (!xvmContractMap[toChain.id]) continue;
      if (!toChains.find(item => item.chainId === toChain.id && item.symbol === toChain.symbol)) {
        toChains.push({
          chainId: toChain.id,
          tokenAddress: toChain.tokenAddress,
          symbol: toChain.symbol,
          precision: toChain.decimals,
          rate: 200,
        });
      }
    }
    targetList.push({ chainId, tokenAddress, symbol, precision, toChains });
  }
  fromChainIdList = Array.from(new Set(fromChainIdList));
  fromChainIdList = fromChainIdList.sort(function(a, b) {
    return a - b;
  });
  for (const chainId of fromChainIdList) {
    const contractAddress: string = xvmContractMap[chainId];
    if (!contractAddress) continue;
    const target: ITarget[] = [];
    for (const tar of targetList) {
      if (tar.chainId === chainId && !target.find(item => item.symbol === tar.symbol)) {
        target.push({
          tokenAddress: tar.tokenAddress,
          symbol: tar.symbol,
          precision: tar.precision,
          toChains: tar.toChains.filter(item => item.chainId !== chainId),
        });
      }
    }
    allXvmList.push({ chainId, contractAddress, target });
  }
  xvmList.push(...allXvmList);
  return allXvmList;
}
export function getXVMContractToChainInfo(fromChainID: number, toChainID: number, fromTokenAddress: string, toTokenAddress: string): any {
  const xvm = xvmList.find(item => item.chainId === fromChainID);
  const target = xvm?.target;
  if (!target) return null;
  const targetData = target.find(item => item.tokenAddress.toLowerCase() === fromTokenAddress.toLowerCase());
  const toChains = targetData?.toChains;
  if (!toChains) return null;
  const toChain = toChains.find(item => item.chainId === toChainID && item.tokenAddress.toLowerCase() === toTokenAddress.toLowerCase());
  return { target: targetData, toChain };
}
