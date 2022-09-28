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
  subgraphEndpoint: string;
  makerTransferTimeout: number;
  chains: Array<any>;
}
