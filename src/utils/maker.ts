import { IMarket } from "../types";
import { uniq, flatten } from "lodash";
export async function convertMarketListToFile(
  makerList: Array<any>,
  L1L2Mapping: any
): Promise<Array<IMarket>> {
  const configs = flatten(
    makerList.map((row) => {
      return convertPool(row);
    })
  ).map((row) => {
    if (["4", "44"].includes(row.toChain.id)) {
      row.sender = L1L2Mapping[row.toChain.id][row.sender.toLowerCase()];
    }
    if (["4", "44"].includes(row.fromChain.id)) {
      // starknet mapping
      row.recipient = L1L2Mapping[row.fromChain.id][row.recipient.toLowerCase()];
    }
    return row;
  });
  return configs;
}
export function groupWatchAddressByChain(makerList: Array<IMarket>): {
  [key: string]: Array<string>;
} {
  const chainIds = uniq(
    flatten(makerList.map((row) => [row.fromChain.id, row.toChain.id]))
  );
  const chain: any = {};
  for (const id of chainIds) {
    const recipientAddress = uniq(
      makerList.filter((m) => m.fromChain.id === id).map((m) => m.recipient)
    );
    const senderAddress = uniq(
      makerList.filter((m) => m.toChain.id === id).map((m) => m.sender)
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
      recipient: pool.makerAddress,
      sender: pool.makerAddress,
      fromChain: {
        id: String(pool.c1ID),
        name: pool.c1Name,
        tokenAddress: pool.t1Address,
        symbol: pool.tName,
      },
      toChain: {
        id: String(pool.c2ID),
        name: pool.c2Name,
        tokenAddress: pool.t2Address,
        symbol: pool.tName,
      },
      // minPrice: pool.c1MinPrice,
      // maxPrice: pool.c1MaxPrice,
      // precision: pool.precision,
      // avalibleDeposit: pool.c1AvalibleDeposit,
      // tradingFee: pool.c1TradingFee,
      // gasFee: pool.c1GasFee,
      // avalibleTimes: pool.c1AvalibleTimes,
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
      recipient: pool.makerAddress,
      sender: pool.makerAddress,
      fromChain: {
        id: String(pool.c2ID),
        name: pool.c2Name,
        tokenAddress: pool.t2Address,
        symbol: pool.tName,
      },
      toChain: {
        id: String(pool.c1ID),
        name: pool.c1Name,
        tokenAddress: pool.t1Address,
        symbol: pool.tName,
      },
      // minPrice: pool.c2MinPrice,
      // maxPrice: pool.c2MaxPrice,
      // precision: pool.precision,
      // avalibleDeposit: pool.c2AvalibleDeposit,
      // tradingFee: pool.c2TradingFee,
      // gasFee: pool.c2GasFee,
      // avalibleTimes: pool.c2AvalibleTimes,
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
