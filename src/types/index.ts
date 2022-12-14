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
  toChains: IToChain[]
}

export interface IToChain {
  chainId: number,
  tokenAddress: string,
  symbol: string,
  precision: number,
  rate: number   // Ten thousandth ratio
}
