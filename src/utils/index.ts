import dayjs from "dayjs";
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
  timestamp?: number,
) {
  let ext = "";
  if ([8, 8].includes(Number(fromChainId))) {
    ext = timestamp ? `_${dayjs(timestamp).unix()}` : "";
  }
  return `${fromAddress}${padStart(String(fromChainId), 4, "0")}${
    symbol || "NULL"
  }${fromTxNonce}${ext}`.toLowerCase();
}
