import { IChainCfg, IMakerCfg, IMakerDataCfg, IMarket } from "../types";
import { uniq, flatten } from "lodash";
import chainMain from "../config/chain.json";
import chainTest from "../config/chainTest.json";

import { isProd } from "../config/config";
import { Context } from "../context";

export const chain: IChainCfg[] = <any[]>(isProd() ? chainMain : chainTest);

export function groupWatchAddressByChain(
  ctx: Context,
  makerList: Array<IMarket>,
): {
  [key: string]: Array<string>;
} {
  const chainIds = uniq(
    flatten(makerList.map(row => [row.fromChain.id, row.toChain.id])),
  );
  const chain: any = {};
  for (const id of chainIds) {
    //
    const recipientAddress = uniq(
      makerList.filter(m => m.fromChain.id === id).map(m => m.recipient),
    );
    const senderAddress = uniq(
      makerList.filter(m => m.toChain.id === id).map(m => m.sender),
    );
    const crossAddressTransfers = [];
    // maker json
    for (const addr of senderAddress) {
      if (ctx.config.crossAddressTransferMap[addr.toLocaleLowerCase()]) {
        const crossAddr =
          ctx.config.crossAddressTransferMap[addr.toLocaleLowerCase()];
        if (addr.length === crossAddr.length) {
          crossAddressTransfers.push(
            ctx.config.crossAddressTransferMap[addr.toLocaleLowerCase()],
          );
        }
      }
    }
    chain[id] = uniq([
      ...senderAddress,
      ...recipientAddress,
      ...crossAddressTransfers,
    ]);
  }
  return chain;
}

export function convertMakerConfig(makerMap: IMakerCfg, makerAddress?: string): IMarket[] {
  // const makerMap: IMakerCfg = <any>maker;
  const chainList: IChainCfg[] = <any>chain;
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
        recipient: makerAddress || makerData.makerAddress,
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
        },
        toChain: {
          id: +toChainId,
          name: c2Chain.name,
          tokenAddress: toToken.address,
          symbol: toChainSymbol,
          decimals: toToken.decimals,
        },
        times: [makerData.startTime, makerData.endTime],
        crossAddress: {
          recipient: makerData.crossAddress?.makerAddress,
          sender: makerData.crossAddress?.sender,
          tradingFee: makerData.crossAddress?.tradingFee,
          gasFee: makerData.crossAddress?.gasFee,
        },
      });
    }
  }
  return JSON.parse(JSON.stringify(configs));
}

export function convertChainConfig(env_prefix: string, chainList?: any[]): IChainCfg[] {
  chainConfigList = (chainList ? chainList : chain);
  for (const chain of chainConfigList) {
    chain.rpc = chain.rpc || [];
    const apiKey =
      process.env[`${env_prefix}_CHAIN_API_KEY_${chain.internalId}`];
    const wpRpc = process.env[`${env_prefix}_WP_${chain.internalId}`];
    const hpRpc = process.env[`${env_prefix}_HP_${chain.internalId}`];
    if (chain.api && apiKey) {
      chain.api.key = apiKey;
    }
    if (wpRpc) {
      chain.rpc.unshift(wpRpc);
    }
    if (hpRpc) {
      chain.rpc.unshift(hpRpc);
    }
  }
  return JSON.parse(JSON.stringify(chainConfigList));
}

export let chainConfigList: IChainCfg[] = [];
