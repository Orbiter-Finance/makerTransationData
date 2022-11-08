import dayjs from "dayjs";
import { padStart } from "orbiter-chaincore/src/utils/core";
import crypto from "crypto";
export * from "./maker";
export async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve();
    }, ms);
  });
}
export function MD5(value: string) {
  const md5 = crypto.createHash("md5");
  return md5.update(value).digest("hex");
}

export function TransactionID(
  fromAddress: string,
  fromChainId: number | string,
  fromTxNonce: string | number,
  symbol: string | undefined,
  timestamp?: number,
) {
  let ext = "";
  if ([8, 88].includes(Number(fromChainId))) {
    ext = timestamp ? `_${dayjs(timestamp).unix()}` : "";
  }
  return `${fromAddress}${padStart(String(fromChainId), 4, "0")}${
    symbol || "NULL"
  }${fromTxNonce}${ext}`.toLowerCase();
}

export function TranferId(
  toChainId: number | string,
  replySender: string,
  replyAccount: string,
  userNonce: number | string,
  toSymbol: string,
  toValue?: string,
) {
  return MD5(
    `${toChainId}_${replySender}_${replyAccount}_${userNonce}_${toSymbol}_${toValue}`.toLowerCase(),
  ).toString();
}
