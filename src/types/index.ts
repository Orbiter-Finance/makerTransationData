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
    [key: string]: {
      [key: string]: string;
    };
  };
  chainsTokens: Array<any>;
  subgraphEndpoint: string;
  chains: Array<any>;
}
