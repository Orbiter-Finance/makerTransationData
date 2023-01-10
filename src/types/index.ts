export interface IMarket {
  id: string;
  makerId: string;
  ebcId: string;
  recipient: string;
  sender: string;
  fromChain: {
    id: number;
    name: string;
    tokenAddress: string;
    symbol: string;
    decimals: number;
    maxPrice: number;
    minPrice: number;
  };
  toChain: {
    id: number;
    name: string;
    tokenAddress: string;
    symbol: string;
    decimals: number;
  };
  times: Number[];
  pool?: any;
}
export interface Config {
  L1L2Mapping: {
    [key: string]: string;
  };
  crossAddressTransferMap: {
    [key: string]: string;
  };
  chainsTokens: Array<any>;
  subgraphEndpoint: string;
  chains: Array<any>;
}

export interface JsonMap {
  [member: string]: string | number | boolean | null | JsonArray | JsonMap;
}

export type JsonArray = Array<
  string | number | boolean | null | JsonArray | JsonMap
>;

export type Json = JsonMap | JsonArray | string | number | boolean | null;

export interface IXvm {
  chainId: number,
  contractAddress: string,
  target: ITarget[]
}

export interface ITarget {
  tokenAddress: string;
  symbol: string;
  precision: number;
  toChains: IToChain[]
}

export interface IToChain {
  chainId: number;
  tokenAddress: string;
  symbol: string;
  precision: number;
  rate: number;   // Ten thousandth ratio
}

export interface IMaker {
  makerAddress: string;
  c1ID: number;
  c2ID: number;
  c1Name: string;
  c2Name: string;
  t1Address: string;
  t2Address: string;
  tName: string;
  c1MinPrice: number;
  c1MaxPrice: number;
  c2MinPrice: number;
  c2MaxPrice: number;
  precision: number;
  c1TradingFee: number;
  c2TradingFee: number;
  c1GasFee: number;
  c2GasFee: number;
  c1AvalibleTimes: [
    {
      startTime: number;
      endTime: number;
    },
  ],
  c2AvalibleTimes: [
    {
      startTime: number;
      endTime: number;
    },
  ],
}

export interface IMakerCfg {
  [chainIdPair: string]: {
    [symbolPair: string]: IMakerDataCfg;
  }
}

export interface IMakerDefaultCfg {
  chainIdList: number[];
  symbolList: string[];
  data: IMakerDataCfg;
}

export interface IMakerDataCfg {
  makerAddress: string;
  sender: string;
  gasFee: number;
  tradingFee: number;
  maxPrice: number;
  minPrice: number;
  slippage: number;
  startTime: number;
  endTime: number;
}

export interface IChainCfg {
  name: string;
  chainId: string;
  internalId: string;
  networkId?: string;
  rpc: string[];
  api?: {
    url: string;
    key?: string;
    intervalTime?: number;
  };
  debug?: boolean;
  nativeCurrency: IToken;
  watch?: string[];
  explorers?: IExplorerConfig[];
  tokens: IToken[];
  contracts?: string[];
  xvmList?: string[];
  workingStatus?: IChainConfigWorkingStatus;
}

export interface IToken {
  id?: number;
  name: string;
  symbol: string;
  decimals: 18;
  address: string;
  mainCoin?: boolean;
}

export interface IExplorerConfig {
  name: string;
  url: string;
  standard: string;
}

export type IChainConfigWorkingStatus = "running" | "pause" | "stop";
