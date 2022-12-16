import { AlchemyWeb3 } from "@alch/alchemy-web3";
import BigNumber from "bignumber.js";
import { decodeInputContractTransferResponse, HashOrBlockNumber, ITransaction, QueryTxFilterEther, TokeBalanceResponse, Transaction, TransactionHashOrObject } from "../types";
import { IChainConfig, IEVMChain, QueryTransactionsResponse } from "../types/chain";
import Web3 from "web3";
export declare abstract class EVMChain implements IEVMChain {
    readonly chainConfig: IChainConfig;
    web3: AlchemyWeb3 | Web3;
    constructor(chainConfig: IChainConfig);
    abstract getTransactions(address: string, filter?: Partial<QueryTxFilterEther>): Promise<QueryTransactionsResponse>;
    abstract getTokenTransactions(address: string, tokenAddress?: string | null, filter?: Partial<QueryTxFilterEther>): Promise<QueryTransactionsResponse>;
    abstract getInternalTransactions(address: string, filter?: Partial<QueryTxFilterEther>): Promise<QueryTransactionsResponse>;
    getWeb3(): AlchemyWeb3 | Web3;
    getLatestHeight(): Promise<number>;
    getConfirmations(hashOrHeight: HashOrBlockNumber): Promise<number>;
    calcConfirmations(targetHeight: number, latestHeight: number): Promise<number>;
    getTransactionByHash(txHash: string): Promise<ITransaction | null>;
    protected decodeInputXVMContractTransfer(txData: ITransaction): Promise<any>;
    protected decodeInputContractTransfer(input: string, contractAddress: string): Promise<decodeInputContractTransferResponse>;
    convertTxToEntity(hashOrobject: TransactionHashOrObject): Promise<Transaction | null>;
    getBalance(address: string): Promise<BigNumber>;
    getBalances(_address: string): Promise<TokeBalanceResponse[]>;
    getDecimals(): Promise<number>;
    getTokenBalance(address: string, tokenAddress: string): Promise<BigNumber>;
    getTokenDecimals(tokenAddress: string): Promise<number>;
    getTokenSymbol(tokenAddress: string): Promise<string>;
}
