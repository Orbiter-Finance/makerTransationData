import { Context } from "./../context";
import { BigNumber } from "bignumber.js";
import { equals, isEmpty } from "orbiter-chaincore/src/utils/core";
import { IChainCfg, IMakerCfg, IMakerDataCfg, IMarket } from "../types";
import { uniq, flatten } from "lodash";
import { chains } from "orbiter-chaincore";
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
        },
        toChain: {
          id: +toChainId,
          name: c2Chain.name,
          tokenAddress: toToken.address,
          symbol: toChainSymbol,
          decimals: toToken.decimals,
        },
        times: [makerData.startTime, makerData.endTime],
      });
    }
  }
  return configs;
}
