import { IXvm } from "./types";

export const makerList: any[] = [];

export const makerListHistory = [];

export const xvmList: IXvm[] = [];

const tokenCfg: any = {
  5: {
    name: "goerli",
    token: {
      ETH: "0x0000000000000000000000000000000000000000",
      USDT: "0x6b56404816A1CB8ab8E8863222d8C1666De942d5",
      USDC: "0x1c8f9D9C1D74c38c8Aeb5033126EA1133728b32f",
      DAI: "0xFEf68eb974c562B0dCBF307d9690e0BD10e35cEa",
    },
  },
  22: {
    name: "arbitrum(G)",
    token: {
      ETH: "0x0000000000000000000000000000000000000000",
      USDT: "0x6b56404816A1CB8ab8E8863222d8C1666De942d5",
      USDC: "0x1c8f9D9C1D74c38c8Aeb5033126EA1133728b32f",
      DAI: "0xFEf68eb974c562B0dCBF307d9690e0BD10e35cEa",
    },
  },
  66: {
    name: "polygon(G)",
    token: {
      ETH: "0x0000000000000000000000000000000000000000",
      USDT: "0x6b56404816A1CB8ab8E8863222d8C1666De942d5",
      USDC: "0x1c8f9D9C1D74c38c8Aeb5033126EA1133728b32f",
      DAI: "0xFEf68eb974c562B0dCBF307d9690e0BD10e35cEa",
    },
  },
  77: {
    name: "optimism(G)",
    token: {
      ETH: "0x0000000000000000000000000000000000000000",
      USDT: "0x6b56404816A1CB8ab8E8863222d8C1666De942d5",
      UDSC: "0x1c8f9D9C1D74c38c8Aeb5033126EA1133728b32f",
      DAI: "0xFEf68eb974c562B0dCBF307d9690e0BD10e35cEa",
    },
  },
  515: {
    name: "bsc(G)",
    token: {
      ETH: "0x0000000000000000000000000000000000000000",
      USDT: "0x6b56404816A1CB8ab8E8863222d8C1666De942d5",
      USDC: "0x1c8f9D9C1D74c38c8Aeb5033126EA1133728b32f",
      DAI: "0xFEf68eb974c562B0dCBF307d9690e0BD10e35cEa",
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
              precision: (t1Name === "ETH" || t1Name == "DAI") ? 18 : 6,
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
