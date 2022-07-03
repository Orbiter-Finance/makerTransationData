import { Context, processMakerSendUserTx, processUserSendMakerTx } from "../..";
import { ImmutableX } from "orbiter-chaincore/src/chain";
import { getAmountFlag } from "../utils/oldUtils";
import {
  IChainWatch,
  QueryTxFilterIMX,
  TransactionStatus,
  ITransaction,
  QueryTxFilterEther,
  QueryTxFilterZKSpace,
  QueryTxFilterZKSync,
} from "orbiter-chaincore/src/types";
import { Op } from "sequelize";
import { core, chains, dydx } from "orbiter-chaincore/src/utils";
export async function bulkCreateTransaction(
  ctx: Context,
  txlist: Array<ITransaction>
) {
  const txsList = [];
  for (const tx of txlist) {
    // ctx.logger.info(`processSubTx:${tx.hash}`);
    const chainConfig = chains.getChainByChainId(tx.chainId);
    if (!chainConfig) {
      throw new Error(`chainId ${tx.chainId} not found`);
    }
    // ctx.logger.info(
    //   `[${chainConfig.name}] chain:${chainConfig.internalId}, hash:${tx.hash}`
    // );
    let memo = getAmountFlag(Number(chainConfig.internalId), String(tx.value));
    if (["9", "99"].includes(chainConfig.internalId) && tx.extra) {
      memo = ((<any>tx.extra).memo % 9000) + "";
    } else if (
      ["11", "511"].includes(chainConfig.internalId) &&
      tx.extra["type"] === "TRANSFER_OUT"
    ) {
      if (!tx.to) {
        tx.to = dydx.getEthereumAddressFromClientId(tx.extra["clientId"]);
      }
      // makerAddress
      if (!tx.from) {
        const makerItem = await ctx.makerConfigs.find(
          (row) => row.toChain.id === chainConfig.internalId
        );
        tx.from = (makerItem && makerItem.sender) || "";
      }
    }
    const txData: any = {
      hash: tx.hash,
      nonce: String(tx.nonce),
      blockHash: tx.blockHash,
      blockNumber: tx.blockNumber,
      transactionIndex: tx.transactionIndex,
      from: tx.from || "",
      to: tx.to || "",
      value: tx.value.toString(),
      symbol: tx.symbol,
      gasPrice: tx.gasPrice,
      gas: tx.gas,
      input: tx.input != "0x" ? tx.input : null,
      status: tx.status,
      tokenAddress: tx.tokenAddress || "",
      timestamp: new Date(tx.timestamp * 1000),
      fee: tx.fee.toString(),
      feeToken: tx.feeToken,
      chainId: Number(chainConfig.internalId),
      source: tx.source,
      extra: tx.extra,
      memo,
    };
    if (
      [3, 33, 8, 88, 12, 512].includes(Number(txData.chainId)) &&
      txData.status === TransactionStatus.PENDING
    ) {
      txData.status = TransactionStatus.COMPLETE;
    }

    txsList.push(txData);
  }
  try {
    const result = await ctx.models.transaction.bulkCreate(txsList, {
      returning: true,
      updateOnDuplicate: [
        "from",
        "to",
        "value",
        "fee",
        "feeToken",
        "symbol",
        "status",
        "input",
        "extra",
        "timestamp",
        "tokenAddress",
        "nonce",
        "memo",
      ],
    });
    return result.map((row) => row.toJSON());
  } catch (error: any) {
    ctx.logger.error("processSubTx error:", error);
    throw error;
  }
}

export async function loopPullImxHistory(
  ctx: Context,
  chainService: IChainWatch,
  address: string
) {
  const chainId = Number(chainService.chain.chainConfig.internalId);
  const filter: Partial<QueryTxFilterIMX> = {
    page_size: 100,
    direction: "desc",
    receiver: address,
    // user: address,
  };
  const imxService = <ImmutableX>chainService.chain;
  const client = await imxService.createClient();
  let isFinish = false;
  let isLock = false;
  const requestTx = async (filterParams: any) => {
    const response: any = {
      txlist: [],
    };
    const { result, ...resExtra } = await client.getTransfers(filterParams);
    Object.assign(response, resExtra);
    for (const txRaw of result) {
      const tx = await imxService.convertTxToEntity(txRaw);
      if (tx) {
        response.txlist.push(tx);
      }
    }
    return response;
  };
  const getData = () => {
    return new Promise(async (resolve, reject) => {
      try {
        const result = await requestTx(filter);
        ctx.logger.debug(
          `--------- ${chainId} = ${address} getData History data: ${result.txlist.length}`,
          filter,
          result
        );
        if (result && result.txlist.length > 0) {
          const returnTxList: Array<any> = await bulkCreateTransaction(
            ctx,
            result.txlist
          );
          filter.cursor = result.cursor;
          return resolve(returnTxList);
        }
        resolve(true);
      } catch (error) {
        console.error(error);
        resolve(true);

        // reject(error);
      }
    });
  };
  const timer = setInterval(async () => {
    if (isFinish) {
      clearInterval(timer);
    }
    if (!isLock) {
      try {
        await getData();
      } catch (error) {
        console.error("pullZpaceTrxList error:", error);
      } finally {
        isLock = false;
      }
    }
  }, 1000);
}

export async function loopPullZKSpaceHistory(
  ctx: Context,
  chainService: IChainWatch,
  address: string
) {
  const chainId = Number(chainService.chain.chainConfig.internalId);
  const filter: Partial<QueryTxFilterZKSpace> = {
    types: "Transfer",
    limit: 100,
    start: 0,
  };
  let isFinish = false;
  let isLock = false;
  const getData = () => {
    return new Promise(async (resolve, reject) => {
      try {
        const result = await chainService?.chain.getTransactions(
          address,
          filter
        );
        ctx.logger.debug(
          `--------- ${chainId} = ${address} getData History data: ${result.txlist.length}`,
          filter
        );
        if (result && result.txlist.length > 0) {
          const returnTxList: Array<any> = await bulkCreateTransaction(
            ctx,
            result.txlist
          );
          filter.start = Number(filter.start) + 1;
          return resolve(returnTxList);
        }
        resolve(true);
      } catch (error) {
        console.error(error);
        resolve(true);

        // reject(error);
      }
    });
  };
  const timer = setInterval(async () => {
    if (isFinish) {
      clearInterval(timer);
    }
    if (!isLock) {
      try {
        await getData();
      } catch (error) {
        console.error("pullZpaceTrxList error:", error);
      } finally {
        isLock = false;
      }
    }
  }, 1000);
}
export async function loopPullZKSyncHistory(
  ctx: Context,
  chainService: IChainWatch,
  address: string
) {
  const chainId = Number(chainService.chain.chainConfig.internalId);

  const firstTx = await ctx.models.transaction.findOne({
    raw: true,
    attributes: ["id", "hash"],
    where: {
      chainId: Number(chainService.chain.chainConfig.internalId),
      from: address,
      timestamp: {
        [Op.lte]: "2022-06-23 13:00:00",
      },
    },
    order: [["timestamp", "asc"]],
  });
  const filter: Partial<QueryTxFilterZKSync> = {
    from: firstTx?.hash,
    limit: 100,
    direction: "newer",
  };
  let isFinish = false;
  let isLock = false;
  const getData = () => {
    return new Promise(async (resolve, reject) => {
      try {
        const result = await chainService?.chain.getTransactions(
          address,
          filter
        );
        ctx.logger.debug(`${chainId} = ${address} getData History`, filter);
        console.log("data length:", result.txlist.length);

        if (result && result.txlist.length > 0) {
          const returnTxList: Array<any> = await bulkCreateTransaction(
            ctx,
            result.txlist
          );
          filter.from = returnTxList[returnTxList.length - 1].hash;
          return resolve(returnTxList);
        }
        resolve(true);
      } catch (error) {
        console.error(error);
        resolve(true);

        // reject(error);
      }
    });
  };
  const timer = setInterval(async () => {
    if (isFinish) {
      clearInterval(timer);
    }
    if (!isLock) {
      try {
        await getData();
      } catch (error) {
        console.error("pullZkTrxList error:", error);
      } finally {
        isLock = false;
      }
    }
  }, 1000);
}
export async function loopOptimisticHistory(
  ctx: Context,
  chainService: IChainWatch,
  address: string
) {
  const chainId = Number(chainService.chain.chainConfig.internalId);
  // https://api.etherscan.io/api?module=account&action=txlist&address=0x80C67432656d59144cEFf962E8fAF8926599bCF8&startblock=0&endblock=99999999&page=1&offset=10&sort=asc
  const filter: Partial<QueryTxFilterEther> = {
    address,
    sort: "asc",
    startblock: 0,
    endblock: 999999999,
    page: 1,
    offset: 100,
  };
  let isFinish = false;
  let isLock = false;
  const getData = () => {
    ctx.logger.debug(`${chainId} ${address} getData History`, filter);
    return new Promise(async (resolve, reject) => {
      try {
        const result = await chainService?.chain.getTransactions(
          address,
          filter
        );
        if (result && result.txlist.length > 0) {
          const returnTxList: Array<any> = await bulkCreateTransaction(
            ctx,
            result.txlist
          );
          filter.startblock = returnTxList[returnTxList.length - 1].blockNumber;
          return resolve(returnTxList);
        }
        resolve(true);
      } catch (error) {
        console.error(error);
        resolve(true);

        // reject(error);
      }
    });
  };
  const timer = setInterval(async () => {
    if (isFinish) {
      clearInterval(timer);
    }
    if (!isLock) {
      try {
        await getData();
      } catch (error) {
        console.error("pullZkTrxList error:", error);
      } finally {
        isLock = false;
      }
    }
  }, 5000);
}
export async function matchSourceDataByTx(ctx: Context, txData: any) {
  const tx = await ctx.models.transaction.findOne({
    raw: true,
    where: {
      chainId: txData.chainId,
      hash: txData.hash
    }
  })
  if (!tx || !tx.id) {
    throw new Error('Tx Not Found')
  }
  const isMakerSend =
    ctx.makerConfigs.findIndex((row) => core.equals(row.sender, tx.from)) !==
    -1;
  const isUserSend =
    ctx.makerConfigs.findIndex((row) => core.equals(row.recipient, tx.to)) !==
    -1;
  if (isMakerSend) {
    return await processMakerSendUserTx(ctx, tx);
  } else if (isUserSend) {
    return await processUserSendMakerTx(ctx, tx);
  } else {
    ctx.logger.error(
      `matchSourceData This transaction is not matched to the merchant address: ${tx.hash}`
    );
  }
}
export async function matchSourceData(
  ctx: Context,
  pageIndex: number = 1,
  pageSize: number = 500
) {
  const [result] = await ctx.sequelize.query(
    "select t1.id,t1.hash from `transaction` as t1 left join maker_transaction as mt on t1.id = mt.inId where mt.id is null order by t1.id desc  limit " +
      pageSize +
      " offset " +
      pageSize * (pageIndex - 1) +
      "",
    {
      raw: true,
    }
  );
  const trxIds = result.map((row: any) => row["id"]);
  if (result.length <= 0 || !result) {
    throw new Error("match last");
  }
  const trxs = await ctx.models.transaction.findAll({
    raw: true,
    where: {
      id: {
        [Op.in]: trxIds,
      },
    },
  });
  for (const tx of trxs) {
    console.log(`page ${pageIndex} process match:`, tx.id);
    await matchSourceDataByTx(ctx, tx);
  }
  return result;
}
