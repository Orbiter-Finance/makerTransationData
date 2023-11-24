/* eslint-disable */

import { BigNumber } from "bignumber.js";
import { IChainCfg, IMarket } from "../types";
import moment from "moment";
import * as zksync from 'zksync';
import { chainConfigList } from "./maker";
import { validateAndParseAddress } from "starknet";

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
  arbitrum_nova: 256,
  polygon_zkevm: 256,
  scroll_l1_test: 256,
  scroll_l2_test: 256,
  orbiter: 256,
  taiko_a1_test: 256,
};
const precisionResolverMap: any = {
  // pay attention:  the type of field "userAmount" in the following methods is not BigNumber
  // but string in decimal!!!
  "18": (userAmount: any) => userAmount.slice(0, 6),
  default: (userAmount: any) => userAmount,
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
  14: "zksync2",
  514: "zksync2",
  15: "bnbchain",
  515: "bnbchain",
  16: "arbitrum_nova",
  516: "arbitrum_nova",
  17: "polygon_zkevm",
  517: "polygon_zkevm",
  518: "scroll_l1_test",
  519: "scroll_l2_test",
  599: "orbiter",
  20: "taiko",
  520: "taiko_a1_test",
};

export const SIZE_OP = {
  P_NUMBER: 4,
};

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

/**
 * @description {
 *  This method is to confirm the legitimacy of the amount
 *  if the amount u passed is legal, it will return it intact
 *  otherwise the data we processed will be returned
 * }
 * @param userAmount the amount user given
 * @param chain config of the current chain
 */
const performUserAmountLegality = (userAmount: BigNumber, chain: any) => {
  const { precision } = chain;
  const decimalData = userAmount.toFormat(); // convert BigNumber instance to decimal
  // if the precision that current chain support equals 18, the maximum precision of userAmount u passed is 6
  const matchResolver =
    precisionResolverMap[precision] || precisionResolverMap["default"];
  // eg: precision equals 18, but the value of userAmount is 0.3333333333
  // covert result after matchResolver processed was 0.333333
  const convertResult = matchResolver(decimalData, chain);
  return new BigNumber(convertResult);
};
function getToAmountFromUserAmount(
  userAmount: any,
  market: IMarket,
  isWei: any,
) {
  let toAmount_tradingFee = new BigNumber(userAmount).minus(
    new BigNumber(market.tradingFee),
  );
  let gasFee = toAmount_tradingFee
    .multipliedBy(new BigNumber(market.gasFee))
    .dividedBy(new BigNumber(1000));
  let digit = market.toChain.decimals === 18 ? 5 : 2;
  // accessLogger.info('digit =', digit)
  let gasFee_fix = gasFee.decimalPlaces(digit, BigNumber.ROUND_UP);
  // accessLogger.info('gasFee_fix =', gasFee_fix.toString())
  let toAmount_fee = toAmount_tradingFee.minus(gasFee_fix);
  // accessLogger.info('toAmount_fee =', toAmount_fee.toString())
  if (!toAmount_fee || isNaN(Number(toAmount_fee))) {
    return 0;
  }
  if (isWei) {
    return toAmount_fee.multipliedBy(
      new BigNumber(10 ** market.toChain.decimals),
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
  amount = new BigNumber(String(amount)).toFixed();
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

function isChainSupport(chainId: string | number) {
  // if (CHAIN_INDEX[chain] && MAX_BITS[CHAIN_INDEX[chain]]) {
  //   return true;
  // }
  return !!getChainInfo(chainId);
}

export function getChainInfo(chainId: any): IChainCfg | null {
  const chainInfo = chainConfigList.find(item => +item.internalId === +chainId);
  if (!chainInfo) return null;
  return JSON.parse(JSON.stringify(chainInfo));
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

/**
 * Get return amount
 * @param fromChainID
 * @param toChainID
 * @param amountStr
 * @param market
 * @param nonce
 * @returns
 */
export function getAmountToSend(
  fromChainID: number,
  toChainID: number,
  amountStr: string,
  market: IMarket,
  nonce: string | number,
) {
  const realAmount = getRAmountFromTAmount(fromChainID, amountStr);
  if (!realAmount.state) {
    console.error(realAmount.error);
    return;
  }
  let rAmount = <any>realAmount.rAmount;
  if (+nonce > 8999) {
    console.error("nonce too high, not allowed");
    return;
  }
  if (toChainID === 3 || toChainID === 3) {
    var prefix = rAmount.substr(0, 11);
    rAmount = `${prefix}${"0".repeat(rAmount.length - prefix.length)}`;
  }
  const nonceStr = pTextFormatZero(String(nonce));
  const readyAmount = getToAmountFromUserAmount(
    new BigNumber(rAmount).dividedBy(
      new BigNumber(10 ** market.fromChain.decimals),
    ),
    market,
    true,
  );
  const result = getTAmountFromRAmount(toChainID, readyAmount.toFixed(), nonceStr);
  if (!result.state) {
    console.error(result);
  }
  if (toChainID === 3 || toChainID === 33) {
    if (result.state) {
      const amount = zksync.utils.closestPackableTransactionAmount(String(result.tAmount)).toString();
      result.tAmount = amount;
    }
  } else if(+toChainID === 8 || +toChainID ==88) {
    if (result.state) {
        const convertValue = String(+result.tAmount / 10**market.toChain.decimals);
        const splitValue = convertValue.split('.');
        if (splitValue[1].length>10) {
          splitValue[1] = `${splitValue[1].substring(0,6)}${nonceStr}`;
          const value = new BigNumber(splitValue.join('.')).times(10**market.toChain.decimals);
          result.tAmount = value.toFixed(0);
        }
    }
  }
  return result;
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
  const value = Number(rst.pText).toString().substring(0, 4)
  return (+value % 9000).toString();
}

export function getFormatDate(date: number | string) {
  if (date && String(date).length === 10) {
    date = Number(date) * 1000;
  }
  const timestamp = new Date(date);
  return moment(timestamp)
    .utcOffset(getTimeZoneString(8))
    .format("YYYY-MM-DD HH:mm:ss");
}

function getTimeZoneString(timeZone: any) {
  return `${timeZone < 0 ? "-" : "+"}${Math.abs(timeZone) < 10 ? "0" + Math.abs(timeZone) : Math.abs(timeZone)
    }:00`;
}

function getAccountAddressError(address, chainId): string | null {
  if (Number(chainId) == 4 || Number(chainId) == 44) {
    try {
      validateAndParseAddress(address);
      return null;
    } catch (e) {
      return e.message;
    }
  } else {
    if ((new RegExp(/^0x[a-fA-F0-9]{40}$/)).test(address)) {
      return null;
    } else {
      return "Invalid evm address";
    }
  }
}

export {
  getTAmountFromRAmount,
  getRAmountFromTAmount,
  getPTextFromTAmount,
  pTextFormatZero,
  isLimitNumber,
  getToAmountFromUserAmount,
  getAccountAddressError
};
