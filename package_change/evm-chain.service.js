"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EVMChain = void 0;
const lodash_1 = require("lodash");
const alchemy_web3_1 = require("@alch/alchemy-web3");
const bignumber_js_1 = __importDefault(require("bignumber.js"));
const types_1 = require("../types");
const utils_1 = require("../utils");
const logger_1 = __importDefault(require("../utils/logger"));
const web3_1 = __importDefault(require("web3"));
class EVMChain {
    constructor(chainConfig) {
        this.chainConfig = chainConfig;
        this.web3 = (0, alchemy_web3_1.createAlchemyWeb3)(this.chainConfig.rpc[0]);
    }
    getWeb3() {
        return this.web3;
    }
    getLatestHeight() {
        return this.web3.eth.getBlockNumber();
    }
    getConfirmations(hashOrHeight) {
        return __awaiter(this, void 0, void 0, function* () {
            const latestHeight = yield this.getLatestHeight();
            if (typeof hashOrHeight === "string") {
                const { blockNumber } = yield this.web3.eth.getTransaction(hashOrHeight);
                if (blockNumber) {
                    return this.calcConfirmations(blockNumber, latestHeight);
                }
                return 0;
            }
            else {
                return this.calcConfirmations(Number(hashOrHeight), latestHeight);
            }
        });
    }
    calcConfirmations(targetHeight, latestHeight) {
        return __awaiter(this, void 0, void 0, function* () {
            return Number(latestHeight) - Number(targetHeight) + 1;
        });
    }
    getTransactionByHash(txHash) {
        return __awaiter(this, void 0, void 0, function* () {
            const trx = yield this.web3.eth.getTransaction(txHash);
            if (trx) {
                const tx = yield this.convertTxToEntity(trx);
                return tx;
            }
            return null;
        });
    }
    decodeInputXVMContractTransfer(txData) {
        return __awaiter(this, void 0, void 0, function* () {
            // const callFuncNameSign = input.substring(0, 10);
            // const xvmNameSigns = ["0x471824f7", "0x230f308b", "0x56409ad7"];
            // if (!xvmNameSigns.includes(callFuncNameSign)) return;
            const decodeInputData = utils_1.abi.decodeMethod(String(txData.input), "XVM");
            const result = {
                name: decodeInputData.name,
                params: {},
            };
            if (!decodeInputData || !decodeInputData.params) {
                return result;
            }
            decodeInputData.params.forEach((el) => {
                const filedName = el.name.replace("_", "");
                result.params[filedName] = el.value;
            });
            txData.extra["xvm"] = result;
            txData.tokenAddress = result.params.token;
            if (result.name === "multicall") {
                const txList = [];
                for (const input of result.params.data) {
                    const txDataTmp = JSON.parse(JSON.stringify(txData));
                    txDataTmp.input = input;
                    yield this.decodeInputXVMContractTransfer(txDataTmp);
                    txList.push(txDataTmp);
                }
                txData.extra["txList"] = txList;
            }
            return result;
        });
    }
    decodeInputContractTransfer(input, contractAddress) {
        return __awaiter(this, void 0, void 0, function* () {
            const callFuncNameSign = input.substring(0, 10);
            const forwardNameSigns = ["0x29723511", "0x46f506ad"];
            const decodeInputData = utils_1.abi.decodeMethod(String(input), forwardNameSigns.includes(callFuncNameSign) ? "Forward" : "ERC20");
            const result = {
                name: "",
                transferData: {
                    recipient: "",
                    // sender: '',
                    amount: new bignumber_js_1.default(0),
                    tokenAddress: "",
                    ext: "",
                },
                data: {},
            };
            if (!decodeInputData || !decodeInputData.params) {
                return result;
            }
            result.name = decodeInputData.name;
            decodeInputData.params.forEach((el) => {
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
                        result.transferData.tokenAddress =
                            this.chainConfig.nativeCurrency.address;
                        break;
                    case "0x46f506ad": // transfer erc20
                        result.transferData.recipient = result.data["to"];
                        result.transferData.ext = result.data["ext"];
                        result.transferData.tokenAddress = result.data["token"];
                        result.transferData.amount = new bignumber_js_1.default(result.data["amount"]);
                        break;
                }
            }
            else {
                // Standard ERC20 Transfer
                result.transferData.recipient = result.data["recipient"];
                result.transferData.amount = new bignumber_js_1.default(result.data["amount"]);
                result.transferData.tokenAddress = contractAddress;
            }
            // delete result.data;
            return result;
        });
    }
    convertTxToEntity(hashOrobject) {
        var _a;
        return __awaiter(this, void 0, void 0, function* () {
            let trx = hashOrobject;
            if (typeof hashOrobject === "string") {
                trx = yield this.web3.eth.getTransaction(hashOrobject);
            }
            if ((0, lodash_1.isEmpty)(trx)) {
                return null;
            }
            const { hash, nonce, value, gasPrice, input } = trx, extra = __rest(trx, ["hash", "nonce", "value", "gasPrice", "input"]);
            let trxReceipt = yield this.web3.eth.getTransactionReceipt(hash);
            if (!trxReceipt) {
                logger_1.default.error(`[${this.chainConfig.name}] Get trxReceipt Not found`);
                return null;
            }
            const { to, from, blockHash, blockNumber, gasUsed: gas, transactionIndex, } = trxReceipt;
            if (!utils_1.core.equals(trxReceipt.transactionHash, hash)) {
                let web3Trx;
                if (this.chainConfig.rpc.length > 1) {
                    const web3 = new web3_1.default(this.chainConfig.rpc[1]);
                    web3Trx = yield web3.eth.getTransactionReceipt(hash);
                }
                logger_1.default.error(`[${this.chainConfig.name}] Hash Inconsistent data ${trxReceipt.transactionHash}!=${hash}:`, { receipt: trxReceipt, trx: trx, web3Trx: web3Trx });
                trxReceipt = web3Trx;
                return null;
            }
            const xvmList = ((_a = this.chainConfig) === null || _a === void 0 ? void 0 : _a.xvmList) || [];
            const isXVM = !!xvmList.find(item => item.toLowerCase() === to.toLowerCase());
            // status
            const block = yield this.web3.eth.getBlock(Number(blockNumber), false);
            const confirmations = yield this.getConfirmations(Number(blockNumber));
            const txData = new types_1.Transaction({
                chainId: this.chainConfig.chainId,
                hash,
                from,
                to: "",
                value: new bignumber_js_1.default(value),
                nonce,
                blockHash: String(blockHash),
                blockNumber: Number(blockNumber),
                transactionIndex: Number(transactionIndex),
                gas: Number(gas),
                gasPrice: Number(gasPrice),
                fee: new bignumber_js_1.default(gas).multipliedBy(gasPrice).toString(),
                feeToken: this.chainConfig.nativeCurrency.symbol,
                input,
                symbol: "",
                tokenAddress: "",
                status: types_1.TransactionStatus.Fail,
                timestamp: Number(block.timestamp),
                confirmations,
                extra,
                receipt: trxReceipt,
                source: isXVM ? "xvm" : "rpc",
            });
            if (trxReceipt.status) {
                txData.status = types_1.TransactionStatus.COMPLETE;
            }
            // valid main token or contract token
            if (!utils_1.core.isEmpty(to)) {
                const code = yield this.web3.eth.getCode(to);
                if (code === "0x") {
                    txData.to = to;
                    txData.tokenAddress = this.chainConfig.nativeCurrency.address;
                    txData.symbol = this.chainConfig.nativeCurrency.symbol;
                }
                else {
                    // contract
                    if (!(0, lodash_1.isEmpty)(txData.input) && txData.input) {
                        if (isXVM) {
                            txData.to = trx.to;
                            yield this.decodeInputXVMContractTransfer(txData);
                        }
                        else {
                            txData.tokenAddress = to;
                            txData.to = "";
                            let inputData = yield this.decodeInputContractTransfer(txData.input, to);
                            // transferData
                            if (inputData && inputData.transferData) {
                                const _b = inputData.transferData, { tokenAddress, recipient, amount } = _b, inputExtra = __rest(_b, ["tokenAddress", "recipient", "amount"]);
                                txData.tokenAddress = tokenAddress || txData.tokenAddress;
                                txData.to = recipient || txData.to;
                                txData.value = amount.gt(0) ? amount : txData.value;
                                Object.assign(txData.extra, inputExtra);
                            }
                        }
                    }
                    txData.symbol = yield this.getTokenSymbol(String(txData.tokenAddress));
                }
            }
            return txData;
        });
    }
    getBalance(address) {
        return __awaiter(this, void 0, void 0, function* () {
            const value = yield this.web3.eth.getBalance(address);
            return new bignumber_js_1.default(value);
        });
    }
    getBalances(_address) {
        return __awaiter(this, void 0, void 0, function* () {
            //
            return [];
        });
    }
    getDecimals() {
        return __awaiter(this, void 0, void 0, function* () {
            return this.chainConfig.nativeCurrency.decimals;
        });
    }
    getTokenBalance(address, tokenAddress) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!tokenAddress) {
                return new bignumber_js_1.default(0);
            }
            const tokenContract = new this.web3.eth.Contract(utils_1.abi.IERC20_ABI_JSON, tokenAddress);
            const tokenBalance = yield tokenContract.methods.balanceOf(address).call();
            return new bignumber_js_1.default(tokenBalance);
        });
    }
    getTokenDecimals(tokenAddress) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!tokenAddress) {
                return 0;
            }
            if (utils_1.core.equals(tokenAddress, this.chainConfig.nativeCurrency.address)) {
                return this.chainConfig.nativeCurrency.decimals;
            }
            const token = yield this.chainConfig.tokens.find(token => utils_1.core.equals(token.address, tokenAddress));
            if (token) {
                return token.decimals;
            }
            try {
                const tokenContract = new this.web3.eth.Contract(utils_1.abi.IERC20_ABI_JSON, tokenAddress);
                const decimals = yield tokenContract.methods.decimals().call();
                return decimals;
            }
            catch (error) {
                logger_1.default.error(`getTokenDecimals Error:${tokenAddress}`, error);
            }
            return NaN;
        });
    }
    getTokenSymbol(tokenAddress) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!tokenAddress) {
                return "";
            }
            if (utils_1.core.equals(tokenAddress, this.chainConfig.nativeCurrency.address)) {
                return this.chainConfig.nativeCurrency.symbol;
            }
            const token = yield this.chainConfig.tokens.find(token => utils_1.core.equals(token.address, tokenAddress));
            if (token) {
                return token.symbol;
            }
            try {
                const tokenContract = new this.web3.eth.Contract(utils_1.abi.IERC20_ABI_JSON, tokenAddress);
                const symbol = yield tokenContract.methods.symbol().call();
                return symbol;
            }
            catch (error) {
                logger_1.default.error(`${this.chainConfig.name} getTokenSymbol Error:${tokenAddress}`, error);
            }
            return "";
        });
    }
}
exports.EVMChain = EVMChain;
