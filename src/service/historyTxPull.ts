import { Op } from "sequelize";
import { Context } from "../context";
import { findByHashTxMatch } from "./transaction";

// export async function loopPullImxHistory(
//   ctx: Context,
//   chainService: IChainWatch,
//   address: string,
// ) {
//   const chainId = Number(chainService.chain.chainConfig.internalId);
//   const filter: Partial<QueryTxFilterIMX> = {
//     page_size: 100,
//     direction: "desc",
//     receiver: address,
//     // user: address,
//   };
//   const imxService = <ImmutableX>chainService.chain;
//   const client = await imxService.createClient();
//   const isFinish = false;
//   let isLock = false;
//   const requestTx = async (filterParams: any) => {
//     const response: any = {
//       txlist: [],
//     };
//     const { result, ...resExtra } = await client.getTransfers(filterParams);
//     Object.assign(response, resExtra);
//     for (const txRaw of result) {
//       const tx = await imxService.convertTxToEntity(txRaw);
//       if (tx) {
//         response.txlist.push(tx);
//       }
//     }
//     return response;
//   };
//   const getData = () => {
//     return new Promise(async (resolve, _reject) => {
//       try {
//         const result = await requestTx(filter);
//         ctx.logger.debug(
//           `--------- ${chainId} = ${address} getData History data: ${result.txlist.length}`,
//           filter,
//           result,
//         );
//         if (result && result.txlist.length > 0) {
//           const returnTxList: Array<any> = await bulkCreateTransaction(
//             ctx,
//             result.txlist,
//           );
//           filter.cursor = result.cursor;
//           return resolve(returnTxList);
//         }
//         resolve(true);
//       } catch (error) {
//         console.error(error);
//         resolve(true);
//         // reject(error);
//       }
//     });
//   };
//   const timer = setInterval(async () => {
//     if (isFinish) {
//       clearInterval(timer);
//     }
//     if (!isLock) {
//       try {
//         await getData();
//       } catch (error) {
//         console.error("pullZpaceTrxList error:", error);
//       } finally {
//         isLock = false;
//       }
//     }
//   }, 1000);
// }

// export async function loopPullZKSpaceHistory(
//   ctx: Context,
//   chainService: IChainWatch,
//   address: string,
// ) {
//   const chainId = Number(chainService.chain.chainConfig.internalId);
//   const filter: Partial<QueryTxFilterZKSpace> = {
//     types: "Transfer",
//     limit: 100,
//     start: 0,
//   };
//   const isFinish = false;
//   let isLock = false;
//   const getData = () => {
//     return new Promise(async (resolve, reject) => {
//       try {
//         const result = await chainService?.chain.getTransactions(
//           address,
//           filter,
//         );
//         ctx.logger.debug(
//           `--------- ${chainId} = ${address} getData History data: ${result.txlist.length}`,
//           filter,
//         );
//         if (result && result.txlist.length > 0) {
//           const returnTxList: Array<any> = await bulkCreateTransaction(
//             ctx,
//             result.txlist,
//           );
//           filter.start = Number(filter.start) + 1;
//           return resolve(returnTxList);
//         }
//         resolve(true);
//       } catch (error) {
//         console.error(error);
//         resolve(true);

//         // reject(error);
//       }
//     });
//   };
//   const timer = setInterval(async () => {
//     if (isFinish) {
//       clearInterval(timer);
//     }
//     if (!isLock) {
//       try {
//         await getData();
//       } catch (error) {
//         console.error("pullZpaceTrxList error:", error);
//       } finally {
//         isLock = false;
//       }
//     }
//   }, 1000);
// }
// export async function loopPullZKSyncHistory(
//   ctx: Context,
//   chainService: IChainWatch,
//   address: string,
// ) {
//   const chainId = Number(chainService.chain.chainConfig.internalId);

//   const firstTx = await ctx.models.transaction.findOne({
//     raw: true,
//     attributes: ["id", "hash"],
//     where: {
//       chainId: Number(chainService.chain.chainConfig.internalId),
//       from: address,
//       timestamp: {
//         [Op.lte]: "2022-06-23 13:00:00",
//       },
//     },
//     order: [["timestamp", "asc"]],
//   });
//   const filter: Partial<QueryTxFilterZKSync> = {
//     from: firstTx?.hash,
//     limit: 100,
//     direction: "newer",
//   };
//   const isFinish = false;
//   let isLock = false;
//   const getData = () => {
//     return new Promise(async (resolve, reject) => {
//       try {
//         const result = await chainService?.chain.getTransactions(
//           address,
//           filter,
//         );
//         ctx.logger.debug(`${chainId} = ${address} getData History`, filter);
//         console.log("data length:", result.txlist.length);

//         if (result && result.txlist.length > 0) {
//           const returnTxList: Array<any> = await bulkCreateTransaction(
//             ctx,
//             result.txlist,
//           );
//           filter.from = returnTxList[returnTxList.length - 1].hash;
//           return resolve(returnTxList);
//         }
//         resolve(true);
//       } catch (error) {
//         console.error(error);
//         resolve(true);

//         // reject(error);
//       }
//     });
//   };
//   const timer = setInterval(async () => {
//     if (isFinish) {
//       clearInterval(timer);
//     }
//     if (!isLock) {
//       try {
//         await getData();
//       } catch (error) {
//         console.error("pullZkTrxList error:", error);
//       } finally {
//         isLock = false;
//       }
//     }
//   }, 1000);
// }
// export async function loopOptimisticHistory(
//   ctx: Context,
//   chainService: IChainWatch,
//   address: string,
// ) {
//   const chainId = Number(chainService.chain.chainConfig.internalId);
//   // https://api.etherscan.io/api?module=account&action=txlist&address=0x80C67432656d59144cEFf962E8fAF8926599bCF8&startblock=0&endblock=99999999&page=1&offset=10&sort=asc
//   const filter: Partial<QueryTxFilterEther> = {
//     address,
//     sort: "asc",
//     startblock: 0,
//     endblock: 999999999,
//     page: 1,
//     offset: 100,
//   };
//   const isFinish = false;
//   let isLock = false;
//   const getData = () => {
//     ctx.logger.debug(`${chainId} ${address} getData History`, filter);
//     return new Promise(async (resolve, reject) => {
//       try {
//         const result = await chainService?.chain.getTransactions(
//           address,
//           filter,
//         );
//         if (result && result.txlist.length > 0) {
//           const returnTxList: Array<any> = await bulkCreateTransaction(
//             ctx,
//             result.txlist,
//           );
//           filter.startblock = returnTxList[returnTxList.length - 1].blockNumber;
//           return resolve(returnTxList);
//         }
//         resolve(true);
//       } catch (error) {
//         console.error(error);
//         resolve(true);

//         // reject(error);
//       }
//     });
//   };
//   const timer = setInterval(async () => {
//     if (isFinish) {
//       clearInterval(timer);
//     }
//     if (!isLock) {
//       try {
//         await getData();
//       } catch (error) {
//         console.error("pullZkTrxList error:", error);
//       } finally {
//         isLock = false;
//       }
//     }
//   }, 5000);
// }
export async function matchSourceData(
  ctx: Context,
  pageIndex = 1,
  pageSize = 500,
) {
  const sql = `select t1.id,t1.hash from transaction as t1 left join maker_transaction as mt on t1.id = mt.inId where mt.id is null order by t1.id desc  limit ${pageSize} offset ${
    pageSize * (pageIndex - 1)
  }`;
  const [result] = await ctx.sequelize.query(sql, {
    raw: true,
  });
  const trxIds = result.map((row: any) => row["id"]);
  if (result.length <= 0 || !result) {
    throw [];
  }
  const txlist = await ctx.models.transaction.findAll({
    raw: true,
    where: {
      id: {
        [Op.in]: trxIds,
      },
    },
  });
  for (const tx of txlist) {
    console.log(`page ${pageIndex} process match:`, tx.id);
    await findByHashTxMatch(ctx, tx.chainId, tx.hash);
  }
  return result;
}
