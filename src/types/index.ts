export interface IMarket {
  recipient: string;
  sender: string;
  fromChain: {
    id: string;
    name: string;
    tokenAddress: string;
    symbol: string;
  };
  toChain: {
    id: string;
    name: string;
    tokenAddress: string;
    symbol: string;
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
  chains: Array<any>;
}
