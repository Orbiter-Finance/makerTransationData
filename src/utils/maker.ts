import { Context } from "./../context";
import { BigNumber } from "bignumber.js";
import { equals, isEmpty } from "orbiter-chaincore/src/utils/core";
import { IMarket, ITarget, IToChain, IXvm } from "../types";
import { uniq, flatten, clone } from "lodash";
import { chains } from "orbiter-chaincore";
import { xvmList } from "../maker";
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

export async function convertMarketListToXvmList(makerList: Array<IMarket>) {
  const xvmContractMap: any = {
    5: "0xE6AD22003dCc4aE3F1Ee96dDC3d99c5eb64342e8",
    22: "0xc9C56E28F1f2Be4885844CAE9B9e974453683e28",
    77: "0xc9C56E28F1f2Be4885844CAE9B9e974453683e28",
  };
  const cloneMakerList: Array<IMarket> = JSON.parse(JSON.stringify(makerList));
  const allXvmList: IXvm[] = [];
  const targetList: { chainId: number, tokenAddress: string, symbol: string, toChains: IToChain[] }[] = [];
  const toChainList: { id: number, name: string, tokenAddress: string, symbol: string, decimals: number }[] =
    cloneMakerList.map(item => item.toChain);
  let fromChainIdList: number[] = [];
  for (const maker of cloneMakerList) {
    const chainId: number = maker.fromChain.id;
    fromChainIdList.push(chainId);
    const tokenAddress: string = maker.fromChain.tokenAddress;
    const symbol: string = maker.fromChain.symbol;
    const toChains: IToChain[] = [];
    for (const toChain of toChainList) {
      if (!xvmContractMap[toChain.id]) continue;
      if (!toChains.find(item => item.chainId === toChain.id && item.tokenAddress === toChain.tokenAddress)) {
        toChains.push({
          chainId: toChain.id,
          tokenAddress: toChain.tokenAddress,
          symbol: toChain.symbol,
          precision: toChain.decimals,
          rate: 200,
        });
      }
    }
    targetList.push({ chainId, tokenAddress, symbol, toChains });
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
      if (tar.chainId === chainId && !target.find(item => item.tokenAddress === tar.tokenAddress)) {
        target.push({
          tokenAddress: tar.tokenAddress,
          symbol: tar.symbol,
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
