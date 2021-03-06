/* eslint-disable */
import { BigNumber } from "bignumber.js";

const MAX_BITS: any = {
  eth: 256,
  arbitrum: 256,
  zksync: 35,
  zksync2: 256,
  starknet: 256,
  polygon: 256,
  optimism: 256,
  immutablex: 28,
  loopring: 256,
  metis: 256,
  dydx: 28,
  boba: 256,
  zkspace: 35,
  bnbchain: 256,
};

export const CHAIN_INDEX: any = {
  1: "eth",
  2: "arbitrum",
  22: "arbitrum",
  3: "zksync",
  33: "zksync",
  4: "starknet",
  44: "starknet",
  5: "eth",
  6: "polygon",
  66: "polygon",
  7: "optimism",
  77: "optimism",
  8: "immutablex",
  88: "immutablex",
  9: "loopring",
  99: "loopring",
  10: "metis",
  510: "metis",
  11: "dydx",
  511: "dydx",
  12: "zkspace",
  512: "zkspace",
  13: "boba",
  513: "boba",
  514: "zksync2",
  15: "bnbchain",
  515: "bnbchain",
};

export const SIZE_OP = {
  P_NUMBER: 4,
};

/**
 * @deprecated
 * @param chain
 * @returns
 */
function isZKChain(chain: string | number) {
  if (chain === 3 || chain === 33 || chain === "zksync") {
    return true;
  }
  return false;
}

function isLimitNumber(chain: string | number) {
  if (chain === 3 || chain === 33 || chain === "zksync") {
    return true;
  }
  if (chain === 8 || chain === 88 || chain === "immutablex") {
    return true;
  }
  if (chain === 11 || chain === 511 || chain === "dydx") {
    return true;
  }
  if (chain === 12 || chain === 512 || chain === "zkspace") {
    return true;
  }
  return false;
}

function isLPChain(chain: string | number) {
  if (chain === 9 || chain === 99 || chain === "loopring") {
    return true;
  }
  return false;
}

function isAmountValid(chain: number, amount: any) {
  if (!isChainSupport(chain)) {
    return {
      state: false,
      error: "The chain did not support",
    };
  }
  if (amount < 1) {
    return {
      state: false,
      error: "the token doesn't support that many decimal digits",
    };
  }

  const validDigit = AmountValidDigits(chain, amount); // 10 11
  const amountLength = amount.toString().length;
  if (amountLength < SIZE_OP.P_NUMBER) {
    return {
      state: false,
      error: "Amount size must be greater than pNumberSize",
    };
  }

  let rAmount = amount;
  if (isLimitNumber(chain)) {
    rAmount = removeSidesZero(amount.toString());
  }
  if (!isAmountInRegion(rAmount, chain)) {
    return {
      state: false,
      error: "Amount exceeds the spending range",
    };
  }
  if (isLimitNumber(chain) && amountLength > validDigit) {
    const zkAmount = amount.toString().slice(0, validDigit);
    const op_text = zkAmount.slice(-SIZE_OP.P_NUMBER);
    if (Number(op_text) === 0) {
      return {
        state: true,
      };
    }
    return {
      state: false,
      error: "Insufficient number of flag bits",
    };
  } else {
    const op_text = amount.toString().slice(-SIZE_OP.P_NUMBER);
    if (Number(op_text) === 0) {
      return {
        state: true,
      };
    }
    return {
      state: false,
      error: "Insufficient number of flag bits",
    };
  }
}

function getToAmountFromUserAmount(
  userAmount: BigNumber.Value,
  selectMakerInfo: {
    tradingFee: BigNumber.Value;
    gasFee: BigNumber.Value;
    precision: number;
  },
  isWei: any,
) {
  const toAmount_tradingFee = new BigNumber(userAmount).minus(
    new BigNumber(selectMakerInfo.tradingFee),
  );
  const gasFee = toAmount_tradingFee
    .multipliedBy(new BigNumber(selectMakerInfo.gasFee))
    .dividedBy(new BigNumber(1000));
  const digit = selectMakerInfo.precision === 18 ? 5 : 2;
  // accessLogger.info('digit =', digit)
  const gasFee_fix = gasFee.decimalPlaces(digit, BigNumber.ROUND_UP);
  // accessLogger.info('gasFee_fix =', gasFee_fix.toString())
  const toAmount_fee = toAmount_tradingFee.minus(gasFee_fix);
  // accessLogger.info('toAmount_fee =', toAmount_fee.toString())
  if (!toAmount_fee || isNaN(Number(toAmount_fee))) {
    return 0;
  }
  if (isWei) {
    return toAmount_fee.multipliedBy(
      new BigNumber(10 ** selectMakerInfo.precision),
    );
  } else {
    return toAmount_fee;
  }
}
function getTAmountFromRAmount(
  chain: number,
  amount: string,
  pText: string | any[],
) {
  if (!isChainSupport(chain)) {
    return {
      state: false,
      error: "The chain did not support",
    };
  }
  if (Number(amount) < 1) {
    return {
      state: false,
      error: "the token doesn't support that many decimal digits",
    };
  }
  if (pText.length > SIZE_OP.P_NUMBER) {
    return {
      state: false,
      error: "the pText size invalid",
    };
  }

  const validDigit = AmountValidDigits(chain, amount); // 10 11
  const amountLength = amount.toString().length;
  if (amountLength < SIZE_OP.P_NUMBER) {
    return {
      state: false,
      error: "Amount size must be greater than pNumberSize",
    };
  }
  if (isLimitNumber(chain) && amountLength > validDigit) {
    const tAmount =
      amount.toString().slice(0, validDigit - pText.length) +
      pText +
      amount.toString().slice(validDigit);
    return {
      state: true,
      tAmount: tAmount,
    };
  } else if (isLPChain(chain)) {
    return {
      state: true,
      tAmount: amount + "",
    };
  } else {
    const tAmount =
      amount.toString().slice(0, amountLength - pText.length) + pText;
    return {
      state: true,
      tAmount: tAmount,
    };
  }
}

function getPTextFromTAmount(chain: number, amount: string) {
  if (!isChainSupport(chain)) {
    return {
      state: false,
      error: "The chain did not support",
    };
  }
  if (Number(amount) < 1) {
    return {
      state: false,
      error: "the token doesn't support that many decimal digits",
    };
  }
  //Get the effective number of digits
  const validDigit = AmountValidDigits(chain, amount); // 10 11
  const amountLength = amount.toString().length;
  if (amountLength < SIZE_OP.P_NUMBER) {
    return {
      state: false,
      error: "Amount size must be greater than pNumberSize",
    };
  }
  if (isLimitNumber(chain) && amountLength > validDigit) {
    const zkAmount = amount.toString().slice(0, validDigit);
    const op_text = zkAmount.slice(-SIZE_OP.P_NUMBER);
    return {
      state: true,
      pText: op_text,
    };
  } else {
    const op_text = amount.toString().slice(-SIZE_OP.P_NUMBER);
    return {
      state: true,
      pText: op_text,
    };
  }
}
function getRAmountFromTAmount(chain: number, amount: string) {
  let pText = "";
  for (let index = 0; index < SIZE_OP.P_NUMBER; index++) {
    pText = pText + "0";
  }
  if (!isChainSupport(chain)) {
    return {
      state: false,
      error: "The chain did not support",
    };
  }
  if (Number(amount) < 1) {
    return {
      state: false,
      error: "the token doesn't support that many decimal digits",
    };
  }

  const validDigit = AmountValidDigits(chain, amount); // 10 11
  const amountLength = amount.toString().length;
  if (amountLength < SIZE_OP.P_NUMBER) {
    return {
      state: false,
      error: "Amount size must be greater than pNumberSize",
    };
  }
  if (isLimitNumber(chain) && amountLength > validDigit) {
    const rAmount =
      amount.toString().slice(0, validDigit - SIZE_OP.P_NUMBER) +
      pText +
      amount.toString().slice(validDigit);
    return {
      state: true,
      rAmount: rAmount,
    };
  } else {
    const rAmount =
      amount.toString().slice(0, amountLength - SIZE_OP.P_NUMBER) + pText;
    return {
      state: true,
      rAmount: rAmount,
    };
  }
}

function isChainSupport(chain: string | number) {
  if (CHAIN_INDEX[chain] && MAX_BITS[CHAIN_INDEX[chain]]) {
    return true;
  }
  return false;
}

/**
 * 0 ~ (2 ** N - 1)
 * @param { any } chain
 * @returns { any }
 */
function AmountRegion(chain: number): any {
  if (!isChainSupport(chain)) {
    return {
      error: "The chain did not support",
    };
  }
  if (typeof chain === "number") {
    const max = new BigNumber(2 ** MAX_BITS[CHAIN_INDEX[chain]] - 1);
    return {
      min: new BigNumber(0),
      max: max,
    };
  } else if (typeof chain === "string") {
    const n = MAX_BITS[String(chain).toLowerCase()];
    const max = new BigNumber(2 ** n - 1);
    return {
      min: new BigNumber(0),
      max: max,
    };
  }
}

function AmountMaxDigits(chain: number) {
  const amountRegion = AmountRegion(chain);
  if (amountRegion?.error) {
    return amountRegion;
  }
  return amountRegion.max.toFixed().length;
}

function AmountValidDigits(chain: number, amount: string) {
  const amountMaxDigits = AmountMaxDigits(chain);
  if (amountMaxDigits.error) {
    return amountMaxDigits.error;
  }
  const amountRegion = AmountRegion(chain);

  const ramount = removeSidesZero(amount.toString());
  if (ramount.length > amountMaxDigits) {
    return "amount is inValid";
  }
  //note:the compare is one by one,not all by all
  if (ramount > amountRegion.max.toFixed()) {
    return amountMaxDigits - 1;
  } else {
    return amountMaxDigits;
  }
}

function removeSidesZero(param: string) {
  if (typeof param !== "string") {
    return "param must be string";
  }
  return param.replace(/^0+(\d)|(\d)0+$/gm, "$1$2");
}

function isAmountInRegion(amount: BigNumber.Value, chain: number) {
  if (!isChainSupport(chain)) {
    return {
      state: false,
      error: "The chain did not support",
    };
  }
  const amountRegion = AmountRegion(chain);
  if (amountRegion.error) {
    return false;
  }
  if (
    new BigNumber(amount).gte(amountRegion.min) &&
    new BigNumber(amount).lte(amountRegion.max)
  ) {
    return true;
  }
  return false;
}

function pTextFormatZero(num: string) {
  if (String(num).length > SIZE_OP.P_NUMBER) return num;
  return (Array(SIZE_OP.P_NUMBER).join("0") + num).slice(-SIZE_OP.P_NUMBER);
}

function transferTimeStampToTime(timestamp: string | number | Date) {
  if (!timestamp) {
    return timestamp;
  }
  if (timestamp.toString().length === 10) {
    timestamp = Number(timestamp) * 1000;
  }
  const date = new Date(timestamp);
  const Y = date.getFullYear() + "-";
  const M =
    (date.getMonth() + 1 < 10
      ? "0" + (date.getMonth() + 1)
      : date.getMonth() + 1) + "-";
  const D = date.getDate() + " ";
  const h = date.getHours() + ":";
  const m = date.getMinutes() + ":";
  const s = date.getSeconds();
  const result = Y + M + D + h + m + s;
  return result;
}

/**
 * Get return amount
 * @param fromChainID
 * @param toChainID
 * @param amountStr
 * @param pool
 * @param nonce
 * @returns
 */
export function getAmountToSend(
  fromChainID: number,
  toChainID: number,
  amountStr: string,
  pool: { precision: number; tradingFee: number; gasFee: number },
  nonce: string | number,
) {
  const realAmount = getRAmountFromTAmount(fromChainID, amountStr);
  if (!realAmount.state) {
    console.error(realAmount.error);
    return;
  }
  const rAmount = <any>realAmount.rAmount;
  if (nonce > 8999) {
    console.error("nonce too high, not allowed");
    return;
  }
  const nonceStr = pTextFormatZero(String(nonce));
  const readyAmount = getToAmountFromUserAmount(
    new BigNumber(rAmount).dividedBy(new BigNumber(10 ** pool.precision)),
    pool,
    true,
  );

  return getTAmountFromRAmount(toChainID, readyAmount.toString(), nonceStr);
}
/**
 * @param chainId
 * @param amount
 * @returns
 */
export function getAmountFlag(chainId: number, amount: string): string {
  const rst = getPTextFromTAmount(chainId, amount);
  if (!rst.state) {
    return "0";
  }
  return (Number(rst.pText) % 9000) + "";
}

export {
  isAmountValid,
  transferTimeStampToTime,
  getTAmountFromRAmount,
  getRAmountFromTAmount,
  getPTextFromTAmount,
  pTextFormatZero,
  isZKChain,
  isLimitNumber,
  getToAmountFromUserAmount,
};
