export interface IMarket {
  id: string;
  makerId: string;
  ebcId: string;
  recipient: string;
  sender: string;
  fromChain: {
    id: string;
    name: string;
    tokenAddress: string;
    symbol: string;
    decimals: number;
  };
  toChain: {
    id: string;
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
