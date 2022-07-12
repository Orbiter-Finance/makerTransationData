import { padStart } from "orbiter-chaincore/src/utils/core";

export * from "./maker";
export async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve();
    }, ms);
  });
}

export function TransactionID(
  fromAddress: string,
  fromChainId: number | string,
  fromTxNonce: string | number,
  symbol: string | undefined,
) {
  return `${fromAddress}${padStart(String(fromChainId), 4, "00")}${
    symbol || "NULL"
  }${fromTxNonce}`.toLowerCase();
}
