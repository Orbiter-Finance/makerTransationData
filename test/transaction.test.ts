import { abi, core } from "orbiter-chaincore/src/utils";
import Web3 from "web3";
import { getChainInfo } from "../src/utils/oldUtils";
import BigNumber from "bignumber.js";
import {
  decodeInputContractTransferResponse,
  HashOrBlockNumber,
  ITransaction,
  TransactionStatus,
} from "orbiter-chaincore/src/types";
import { isEmpty } from "orbiter-chaincore/src/utils/core";
import { Context } from "../src/context";
import { processSubTxList } from "../src/service/transaction";
import { IChainCfg } from "../src/types";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";

dayjs.extend(utc);

// const chainId = "5";
// const hash = "0x7ea5555bb72a353dfaff46111887a62fa117bb7a1208f883ba74913789d53d87";
const chainId = "7";
const hash =
  "0xea70a50e43bd364479d381350cc0fa36c863ccf2981637342c4d58b83af721c6";

let chainConfig: IChainCfg;
let web3: any;

describe("Transaction test", function () {
  it("Get chaincore tx", async function () {
    // ...
  });
  it("Submit tx", async function () {
    // Ensure consistent configuration
    const ctx: Context = new Context();
    await ctx.init();
    chainConfig = <IChainCfg>getChainInfo(chainId);
    const rpc = chainConfig?.rpc[0];
    web3 = new Web3(rpc);
    console.log(rpc);

    const tx: ITransaction | null = await imitateChainCoreTx(hash);
    const value = tx?.value?.toString()
    console.log('value ===>>',value);
    console.log("Tx =====>>>", tx);
    if (!tx) {
      return;
    }
    await processSubTxList(ctx, [tx]);
    console.log(
      "---------------------------- exec end ----------------------------",
    );
  });
  it("Clear Cache", async function () {
    const ctx: Context = new Context();
    await ctx.init();
    ctx.redis.del(`subTx_${hash}_1`);
    console.log(
      "---------------------------- exec end ----------------------------",
    );
  });
});

async function imitateChainCoreTx(hash: string) {
  // const count: number = await web3.eth.getBlockNumber();
  // console.log("blockNumber", count);
  let trx: any = await web3.eth.getTransaction(hash);
  const { nonce, value, gasPrice, input, ...extra } = trx;
  let trxReceipt = await web3.eth.getTransactionReceipt(hash);
  if (!trxReceipt) {
    console.error(`[${chainConfig.name}] Get trxReceipt Not found`);
    return null;
  }
  const { to, from, blockHash, blockNumber, gasUsed, transactionIndex } =
    trxReceipt;
  if (!core.equals(trxReceipt.transactionHash, hash)) {
    let web3Trx: any;
    if (chainConfig.rpc.length > 1) {
      const web3 = new Web3(chainConfig.rpc[1]);
      web3Trx = await web3.eth.getTransactionReceipt(hash);
    }
    console.error(
      `[${chainConfig.name}] Hash Inconsistent data ${trxReceipt.transactionHash}!=${hash}:`,
      { receipt: trxReceipt, trx: trx, web3Trx: web3Trx },
    );
    trxReceipt = web3Trx;
    return null;
  }
  const xvmList = chainConfig?.xvmList || [];
  const isXVM = !!xvmList.find(item => item.toLowerCase() === to.toLowerCase());
  // status
  const block = await web3.eth.getBlock(Number(blockNumber), false);
  const confirmations = await getConfirmations(Number(blockNumber));
  const txData: ITransaction = {
    chainId: chainConfig.chainId,
    hash,
    from,
    to: "",
    value: new BigNumber(value),
    nonce,
    blockHash: String(blockHash),
    blockNumber: Number(blockNumber),
    transactionIndex: Number(transactionIndex),
    gas: Number(gasUsed),
    gasPrice: Number(gasPrice),
    fee: new BigNumber(gasUsed).multipliedBy(gasPrice).toString(),
    feeToken: chainConfig.nativeCurrency.symbol,
    input,
    symbol: "",
    tokenAddress: "",
    status: TransactionStatus.Fail,
    timestamp: Number(block.timestamp || 0),
    confirmations,
    extra,
    receipt: trxReceipt,
    source: isXVM ? "xvm" : "rpc",
  };
  if (trxReceipt.status) {
    txData.status = TransactionStatus.COMPLETE;
  }
  // valid main token or contract token
  if (!core.isEmpty(to)) {
    const code = await web3.eth.getCode(to);
    if (code === "0x") {
      txData.to = to;
      txData.tokenAddress = chainConfig.nativeCurrency.address;
      txData.symbol = chainConfig.nativeCurrency.symbol;
    } else {
      // contract
      if (!isEmpty(txData.input) && txData.input) {
        if (isXVM) {
          txData.to = trx.to;
          await decodeInputXVMContractTransfer(txData);
          txData.value = new BigNumber(txData?.extra?.xvm?.params?.value || 0);
        } else {
          txData.tokenAddress = to;
          txData.to = "";
          const inputData = await decodeInputContractTransfer(txData.input, to);
          // transferData
          if (inputData && inputData.transferData) {
            const { tokenAddress, recipient, amount, ...inputExtra } =
              inputData.transferData;
            txData.tokenAddress = tokenAddress || txData.tokenAddress;
            txData.to = recipient || txData.to;
            txData.value = amount.gt(0) ? amount : txData.value;
            Object.assign(txData.extra, inputExtra);
          }
        }
      }
      txData.symbol = await getTokenSymbol(String(txData.tokenAddress));
    }
  }
  return txData;
}

async function decodeInputXVMContractTransfer(
  txData: ITransaction,
): Promise<any> {
  // const callFuncNameSign = input.substring(0, 10);
  // const xvmNameSigns = ["0x471824f7", "0x230f308b", "0x56409ad7"];
  // if (!xvmNameSigns.includes(callFuncNameSign)) return;
  const decodeInputData = abi.decodeMethod(String(txData.input), "XVM");
  const result: any = {
    name: decodeInputData.name,
    params: {},
  };
  if (!decodeInputData || !decodeInputData.params) {
    return result;
  }
  decodeInputData.params.forEach((el: any) => {
    const filedName = el.name.replace("_", "");
    result.params[filedName] = el.value;
  });
  txData.extra["xvm"] = result;
  txData.tokenAddress = result.params.token;
  if (result.name === "multicall") {
    const txList: ITransaction[] = [];
    for (const input of result.params.data) {
      const txDataTmp: ITransaction = JSON.parse(JSON.stringify(txData));
      txDataTmp.input = input;
      await decodeInputXVMContractTransfer(txDataTmp);
      txList.push(txDataTmp);
    }
    txData.extra["txList"] = txList;
  }
  return result;
}

async function decodeInputContractTransfer(
  input: string,
  contractAddress: string,
): Promise<decodeInputContractTransferResponse> {
  const callFuncNameSign = input.substring(0, 10);
  const forwardNameSigns = ["0x29723511", "0x46f506ad"];
  const decodeInputData = abi.decodeMethod(
    String(input),
    forwardNameSigns.includes(callFuncNameSign) ? "Forward" : "ERC20",
  );
  const result: any = {
    name: "",
    transferData: {
      recipient: "",
      // sender: '',
      amount: new BigNumber(0),
      tokenAddress: "",
      ext: "",
    },
    data: {},
  };
  if (!decodeInputData || !decodeInputData.params) {
    return result;
  }
  result.name = decodeInputData.name;
  decodeInputData.params.forEach((el: any) => {
    const filedName = el.name.replace("_", "");
    result.data[filedName] = el.value;
    result[filedName] = el;
  });
  if (forwardNameSigns.includes(callFuncNameSign)) {
    // Forward Contract
    switch (callFuncNameSign) {
      case "0x29723511": // transfer
        result.transferData.recipient = result.data["to"];
        result.transferData.ext = result.data["ext"];
        result.transferData.tokenAddress = chainConfig.nativeCurrency.address;
        break;
      case "0x46f506ad": // transfer erc20
        result.transferData.recipient = result.data["to"];
        result.transferData.ext = result.data["ext"];
        result.transferData.tokenAddress = result.data["token"];
        result.transferData.amount = new BigNumber(result.data["amount"]);
        break;
    }
  } else {
    // Standard ERC20 Transfer
    result.transferData.recipient = result.data["recipient"];
    result.transferData.amount = new BigNumber(result.data["amount"]);
    result.transferData.tokenAddress = contractAddress;
  }
  // delete result.data;
  return result;
}

async function getConfirmations(
  hashOrHeight: HashOrBlockNumber,
): Promise<number> {
  const latestHeight = await web3.eth.getBlockNumber();
  if (typeof hashOrHeight === "string") {
    const { blockNumber } = await web3.eth.getTransaction(hashOrHeight);
    if (blockNumber) {
      return calcConfirmations(blockNumber, latestHeight);
    }
    return 0;
  } else {
    return calcConfirmations(Number(hashOrHeight), latestHeight);
  }
}

async function calcConfirmations(
  targetHeight: number,
  latestHeight: number,
): Promise<number> {
  return Number(latestHeight) - Number(targetHeight) + 1;
}

async function getTokenSymbol(tokenAddress: string): Promise<string> {
  if (!tokenAddress) {
    return "";
  }
  if (core.equals(tokenAddress, chainConfig.nativeCurrency.address)) {
    return chainConfig.nativeCurrency.symbol;
  }
  const token = await chainConfig.tokens.find(token =>
    core.equals(token.address, tokenAddress),
  );
  if (token) {
    return token.symbol;
  }
  return "";
}
