export interface IMarket {
    recipient: string
    sender: string
    fromChain: {
      id: string
      name: string
      tokenAddress: string
      symbol: string
    }
    toChain: {
      id: string
      name: string
      tokenAddress: string
      symbol: string
    }
    pool?: any
  }