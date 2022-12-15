import { IXvm } from "./types";

export const makerList: any[] = [];

export const makerListHistory = [];

export const xvmList: IXvm[] = [];

const tokenCfg: any = {
  5: {
    name: "goerli",
    token: {
      ETH: "0x0000000000000000000000000000000000000000",
      USDT: "0xf2c4826833e013f3fe19b6eb8cca98e55242db81",
      USDC: "0x807643b805f67918f02eb206ade57a5fc3957299",
      DAI: "0x8b0Cb23D5F77947F7dC3F42EF6038aD3B7434DA2",
    },
  },
  22: {
    name: "arbitrum(G)",
    token: {
      ETH: "0x0000000000000000000000000000000000000000",
      USDT: "0x72b0ff3496d9304D0B82846DE4E6eB05A3c83c98",
      USDC: "0x2c45FB44cE474A56d2E1833F6B642A3849bf8125",
      DAI: "0xF64614adc1EAfB02a5943caF7059efc6F56e3F2c",
    },
  },
  66: {
    name: "polygon(G)",
    token: {
      ETH: "0x0000000000000000000000000000000000000000",
      USDT: "0xAa542058C796777637aa2d6D74670Fe7323E1Ff6",
      USDC: "0x72b0ff3496d9304D0B82846DE4E6eB05A3c83c98",
      DAI: "0xE6AD22003dCc4aE3F1Ee96dDC3d99c5eb64342e8",
    },
  },
  77: {
    name: "optimism(G)",
    token: {
      ETH: "0x0000000000000000000000000000000000000000",
      USDT: "0x2c45FB44cE474A56d2E1833F6B642A3849bf8125",
      UDSC: "0xF64614adc1EAfB02a5943caF7059efc6F56e3F2c",
      DAI: "0xf2C4826833E013f3fe19b6eB8ccA98E55242Db81",
    },
  },
  515: {
    name: "bsc(G)",
    token: {
      ETH: "0x0000000000000000000000000000000000000000",
      USDT: "0x72b0ff3496d9304D0B82846DE4E6eB05A3c83c98",
      USDC: "0x2c45FB44cE474A56d2E1833F6B642A3849bf8125",
      DAI: "0xAa542058C796777637aa2d6D74670Fe7323E1Ff6",
    },
  },
};

function initMakerList() {
  const list: any[] = [];
  for (const fromChainId in tokenCfg) {
    const fromChain = tokenCfg[fromChainId];
    const c1Name = fromChain.name;
    const t1Map = fromChain.token;
    for (const t1Name in t1Map) {
      const t1Address = t1Map[t1Name];
      for (const toChainId in tokenCfg) {
        const toChain = tokenCfg[toChainId];
        const c2Name = toChain.name;
        const t2Map = toChain.token;
        for (const t2Name in t2Map) {
          const t2Address = t2Map[t2Name];
          if (fromChainId !== toChainId && t1Name === t2Name) {
            list.push({
              makerAddress: "0x0043d60e87c5dd08C86C3123340705a1556C4719",
              c1ID: +fromChainId,
              c2ID: +toChainId,
              c1Name,
              c2Name,
              t1Address,
              t2Address,
              tName: t1Name,
              c1MinPrice: t1Name === "ETH" ? 0.005 : 0.1,
              c1MaxPrice: t1Name === "ETH" ? 0.01 : 10,
              c2MinPrice: t2Name === "ETH" ? 0.005 : 0.1,
              c2MaxPrice: t2Name === "ETH" ? 0.01 : 10,
              precision: t1Name === "ETH" ? 18 : 6,
              c1AvalibleDeposit: 1000,
              c2AvalibleDeposit: 1000,
              c1TradingFee: t1Name === "ETH" ? 0.0001 : 0.1,
              c2TradingFee: t2Name === "ETH" ? 0.0001 : 0.1,
              c1GasFee: t1Name === "ETH" ? 2 : 1,
              c2GasFee: t2Name === "ETH" ? 2 : 1,
              c1AvalibleTimes: [
                {
                  startTime: 1636019587,
                  endTime: 99999999999999,
                },
              ],
              c2AvalibleTimes: [
                {
                  startTime: 1636019587,
                  endTime: 99999999999999,
                },
              ],
            });
          }
        }
      }
    }
  }
  makerList.push(...list);
}

initMakerList();
