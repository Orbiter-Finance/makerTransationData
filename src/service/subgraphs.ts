import { convertChainLPToOldLP } from "../utils";

export default class Subgraphs {
  constructor(private readonly endpoint: string) {}

  public async getAllLp() {
    const headers = {
      "content-type": "application/json",
    };
    const graphqlQuery = {
      operationName: "fetchLpList",
      query: `query fetchLpList {
        lpEntities{
          id
          createdAt
          maxPrice
          minPrice
          sourcePresion
          destPresion
          tradingFee
          gasFee
          startTime
          stopTime
            maker {
            id
            owner
          }
            pair {
            id
            sourceChain
            destChain
            sourceToken
            destToken
            ebcId
          }
        }
      }`,
      variables: {},
    };

    const options = {
      method: "POST",
      headers: headers,
      body: JSON.stringify(graphqlQuery),
    };

    const response = await fetch(this.endpoint, options);
    const data = await response.json();
    //
    const lpEntities = data.data["lpEntities"];
    if (!(lpEntities && Array.isArray(lpEntities))) {
      throw new Error("Get LP List Fail");
    }
    const convertData = convertChainLPToOldLP(lpEntities);
    return convertData;
  }

  public async getChains() {
    const headers = {
      "content-type": "application/json",
    };
    const graphqlQuery = {
      operationName: "fetchLpList",
      query: `query  {
        chainEntities {
          id
          maxDisputeTime
          maxReceiptTime
          batchLimit
          tokenList {
            id
            decimals
          }
        }
      }`,
      variables: {},
    };

    const options = {
      method: "POST",
      headers: headers,
      body: JSON.stringify(graphqlQuery),
    };

    const response = await fetch(this.endpoint, options);
    const { data } = await response.json();
    return data.chainEntities.map((row: any) => {
      row.maxDisputeTime = Number(row.maxDisputeTime);
      row.maxReceiptTime = Number(row.maxReceiptTime);
      row.batchLimit = Number(row.batchLimit);
      row.id = Number(row.id);
      return row;
    });
  }
}
