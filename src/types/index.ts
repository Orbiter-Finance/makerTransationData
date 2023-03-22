import { IChainConfig } from "orbiter-chaincore/src/types";

export interface IMarket {
  id: string;
  makerId: string;
  ebcId: string;
  recipient: string;
  sender: string;
  slippage: number;
  tradingFee: number;
  gasFee: number;
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
  crossAddress?: {
    recipient: string;
    sender: string;
    tradingFee: number;
    gasFee: number;
  };
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
  chains: IChainConfig[];
}

export interface JsonMap {
  [member: string]: string | number | boolean | null | JsonArray | JsonMap;
}

export type JsonArray = Array<
  string | number | boolean | null | JsonArray | JsonMap
>;

export type Json = JsonMap | JsonArray | string | number | boolean | null;

export interface IMakerCfg {
  [chainIdPair: string]: {
    [symbolPair: string]: IMakerDataCfg;
  };
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
  crossAddress: {
    makerAddress: string;
    sender: string;
    gasFee: number;
    tradingFee: number;
  };
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
