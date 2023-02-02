import { Context } from "./../context";
import { BigNumber } from "bignumber.js";
import { equals, isEmpty } from "orbiter-chaincore/src/utils/core";
import {
  IChainCfg,
  IMakerCfg,
  IMakerDataCfg,
  IMarket,
  ITarget,
  IToChain,
  IXvm,
} from "../types";
import { uniq, flatten } from "lodash";
import { chains } from "orbiter-chaincore";
import { xvmList } from "../maker";
import testnetChains from "../config/testnet.json";
import mainnetChains from "../config/chains.json";
import maker from "../config/maker.json";
export function convertChainLPToOldLP(oldLpList: Array<any>): Array<IMarket> {
  const marketList: Array<IMarket | null> = oldLpList.map(row => {
    try {
      const pair = row["pair"];
      const maker = row["maker"];
      const fromChain = chains.getChainByInternalId(pair.sourceChain);
      if (!fromChain) {
        return {} as any;
      }
      const fromToken = fromChain.tokens.find(row =>
        equals(row.address, pair.sourceToken),
      );
      const toChain = chains.getChainByInternalId(pair.destChain);
      if (!toChain) {
        return {} as any;
      }
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
        slippage: 200,
        tradingFee: new BigNumber(
          Number(row["tradingFee"]) / Math.pow(10, Number(row["destPresion"])),
        ).toNumber(),
        gasFee: new BigNumber(
          Number(row["gasFee"]) / Math.pow(10, Number(row["destPresion"])),
        ).toNumber(),
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

export function convertMakerConfig(ctx: Context): IMarket[] {
  const makerMap: IMakerCfg = <any>maker;
  const chainList: IChainCfg[] =
    ctx.NODE_ENV === "production"
      ? <IChainCfg[]>mainnetChains
      : <IChainCfg[]>testnetChains;
  const configs: IMarket[] = [];
  for (const chainIdPair in makerMap) {
    if (!makerMap.hasOwnProperty(chainIdPair)) continue;
    const symbolPairMap = makerMap[chainIdPair];
    const [fromChainId, toChainId] = chainIdPair.split("-");
    const c1Chain = chainList.find(item => +item.internalId === +fromChainId);
    const c2Chain = chainList.find(item => +item.internalId === +toChainId);
    if (!c1Chain || !c2Chain) continue;
    for (const symbolPair in symbolPairMap) {
      if (!symbolPairMap.hasOwnProperty(symbolPair)) continue;
      const makerData: IMakerDataCfg = symbolPairMap[symbolPair];
      const [fromChainSymbol, toChainSymbol] = symbolPair.split("-");
      const fromToken = [...c1Chain.tokens, c1Chain.nativeCurrency].find(
        item => item.symbol === fromChainSymbol,
      );
      const toToken = [...c2Chain.tokens, c2Chain.nativeCurrency].find(
        item => item.symbol === toChainSymbol,
      );
      if (!fromToken || !toToken) continue;
      // handle makerConfigs
      configs.push({
        id: "",
        makerId: "",
        ebcId: "",
        slippage: makerData.slippage || 0,
        recipient: makerData.makerAddress,
        sender: makerData.sender,
        tradingFee: makerData.tradingFee,
        gasFee: makerData.gasFee,
        fromChain: {
          id: +fromChainId,
          name: c1Chain.name,
          tokenAddress: fromToken.address,
          symbol: fromChainSymbol,
          decimals: fromToken.decimals,
          minPrice: makerData.minPrice,
          maxPrice: makerData.maxPrice,
          xvmList: c1Chain.xvmList || [],
        },
        toChain: {
          id: +toChainId,
          name: c2Chain.name,
          tokenAddress: toToken.address,
          symbol: toChainSymbol,
          decimals: fromToken.decimals,
          xvmList: c2Chain.xvmList || [],
        },
        times: [makerData.startTime, makerData.endTime],
      });
    }
  }
  return configs;
}
export function convertMarketListToXvmList(makerList: Array<IMarket>) {
  const chains: IChainCfg[] =
    process.env.NODE_ENV === "production"
      ? <IChainCfg[]>mainnetChains
      : <IChainCfg[]>testnetChains;
  const xvmContractMap: any = {};
  for (const chain of chains) {
    if (chain.xvmList && chain.xvmList.length) {
      xvmContractMap[+chain.internalId] = chain.xvmList[0];
    }
  }
  const cloneMakerList: Array<IMarket> = JSON.parse(JSON.stringify(makerList));
  const allXvmList: IXvm[] = [];
  const targetList: {
    chainId: number;
    tokenAddress: string;
    symbol: string;
    precision: number;
    toChains: IToChain[];
  }[] = [];
  const toChainList: {
    id: number;
    name: string;
    tokenAddress: string;
    symbol: string;
    decimals: number;
    slippage: number;
  }[] = cloneMakerList.map(item => {
    return { ...item.toChain, slippage: item.slippage };
  });
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
      if (
        !toChains.find(
          item => item.chainId === toChain.id && item.symbol === toChain.symbol,
        )
      ) {
        toChains.push({
          chainId: toChain.id,
          tokenAddress: toChain.tokenAddress,
          symbol: toChain.symbol,
          precision: toChain.decimals,
          slippage: toChain.slippage,
        });
      }
    }
    targetList.push({ chainId, tokenAddress, symbol, precision, toChains });
  }
  fromChainIdList = Array.from(new Set(fromChainIdList));
  fromChainIdList = fromChainIdList.sort(function (a, b) {
    return a - b;
  });
  for (const chainId of fromChainIdList) {
    const contractAddress: string = xvmContractMap[chainId];
    if (!contractAddress) continue;
    const target: ITarget[] = [];
    for (const tar of targetList) {
      if (
        tar.chainId === chainId &&
        !target.find(item => item.symbol === tar.symbol)
      ) {
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
export function getXVMContractToChainInfo(
  fromChainID: number,
  toChainID: number,
  fromTokenAddress: string,
  toTokenAddress: string,
): any {
  const xvm = xvmList.find(item => item.chainId === fromChainID);
  const target = xvm?.target;
  if (!target) return null;
  const targetData = target.find(
    item => item.tokenAddress.toLowerCase() === fromTokenAddress.toLowerCase(),
  );
  const toChains = targetData?.toChains;
  if (!toChains) return null;
  const toChain = toChains.find(
    item =>
      item.chainId === toChainID &&
      item.tokenAddress.toLowerCase() === toTokenAddress.toLowerCase(),
  );
  return { target: targetData, toChain };
}
