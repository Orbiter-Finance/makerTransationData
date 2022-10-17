export interface IMarket {
  recipient: string;
  sender: string;
  fromChain: {
    id: number;
    name: string;
    tokenAddress: string;
    symbol: string;
  };
  toChain: {
    id: number;
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
  makerTransferTimeout: number;
  chains: Array<any>;
}
