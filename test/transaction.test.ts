import "dotenv/config";
import { Context } from "../src/context";
import {
  bulkCreateTransaction,
} from "../src/service/transaction";
import { ChainFactory } from "orbiter-chaincore/src/watch/chainFactory";
import { Watch } from "../src/service/watch";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { StarknetWatch } from "orbiter-chaincore/src/watch/starknet.watch";
import { convertMakerConfig, sleep } from "../src/utils";
dayjs.extend(utc);
const ctx: Context = new Context();

// loopring need api key, zkspace、dydx、boba have no tx
// // imx - loopring
// {
//   fromChain: {
//     id: 8,
//     hash: "222484137",
//   },
//   toChain: {
//     id: 9,
//     hash: "0x22a6a125ae2a5d3e705d0e1c0ee984e9ba773628c70789fed298f253409acdef"
//   },
// },
// {
//   fromChain: {
//     id: 9,
//     hash: "0x05434e5087536c9f8d758d056683255b32f135884fd770a835caf4e62acce63c"
//   },
//   toChain: {
//     id: 8,
//     hash: "222485583"
//   },
// },
const dataMap = {
  "0x80C67432656d59144cEFf962E8fAF8926599bCF8": [
    // eth - ar
    {
      fromChain: {
        id: 1,
        hash: "0xa21739557aadc3756079a3161a959ee84151224ae46f6aa61492450af3805e83",
      },
      toChain: {
        id: 2,
        hash: "0xd525aa9fc2716f0d5e85516f6023b820bcca083baf0f8bbe19562c8b9ad99f6e",
      },
    },
    // {
    //   fromChain: {
    //     id: 2,
    //     hash: "0xaa51ea671de011151cc2e99b77405c70afd6e3e099eb067bab8de339b84fcb09",
    //   },
    //   toChain: {
    //     id: 1,
    //     hash: "0xed7284eb1c6e876af4530c2d71d23767fe6bdc1df95f99af3e6fcf585b19a768",
    //   },
    // },
    //
    // // zk - zk era
    // {
    //   fromChain: {
    //     id: 3,
    //     hash: "0x56a41241f72fe3ceb9599e6099c254e9af3dd68ef236b78a5a74a1e550117b53",
    //   },
    //   toChain: {
    //     id: 14,
    //     hash: "0xef541e611418cbf58f5d4441ac6c0d97dbfd1d7716a1cbb1d5125f12cb081ba5",
    //   },
    // },
    // {
    //   fromChain: {
    //     id: 14,
    //     hash: "0x5d6d93d1be827049fab7f6258106657c2e618d1ce5aefa13041485affe427f3c",
    //   },
    //   toChain: {
    //     id: 3,
    //     hash: "0x9a4492949fe791ea1fae675c3a1a1a812e637f354f06bfcfc085d6a345c00110",
    //   },
    // },
    //
    // // starknet - op
    // {
    //   fromChain: {
    //     id: 7,
    //     hash: "0x60535d71dab34579527abcf979bc5569aa0d3a42576c315848d3e3638c69fbcf",
    //   },
    //   toChain: {
    //     id: 4,
    //     hash: "0x05dcf73ecb2f32c483849347b1c4c66b24b5608eaa62d15a63fe6d05001b3241",
    //     blockNumber: 68499,
    //   },
    // },
    // {
    //   fromChain: {
    //     id: 4,
    //     hash: "0x06208278cc0ddbbb0a47703a0dbae28f2b97c2697d9ea5427469be29b53e1299",
    //     blockNumber: 68528,
    //   },
    //   toChain: {
    //     id: 7,
    //     hash: "0x87e9fa9140927d68e3882cfdb3c1f743dc0cab0920e95f6e9b77b2de56148807",
    //   },
    // },
    //
    // // polygon - polygon zkevm
    // {
    //   fromChain: {
    //     id: 6,
    //     hash: "0x900e0e17526231de6ec814371fe4a937a7247d42ac5b8412e3410762a7ebf9de",
    //   },
    //   toChain: {
    //     id: 17,
    //     hash: "0x68f20d58172be1cf627052c915e240dd3ceb8fcb674d8c3f65cc078412972c45"
    //   },
    // },
    // {
    //   fromChain: {
    //     id: 17,
    //     hash: "0x1df6f27d16bce1a7efc8613af334255279402e0463295967154572158f478221"
    //   },
    //   toChain: {
    //     id: 6,
    //     hash: "0xcaa652408541bd4abcc45dc43cfdb4ec272983eba0c6de1059634898e44c3139"
    //   },
    // },
    //
    // // imx - bnb
    // {
    //   fromChain: {
    //     id: 8,
    //     hash: "222580712",
    //   },
    //   toChain: {
    //     id: 15,
    //     hash: "0x7dfb44d639cdeac3b3ef72296729560aafa964eafe91c5eedb5105eb3a9e7a4f"
    //   },
    // },
    // {
    //   fromChain: {
    //     id: 15,
    //     hash: "0x769e32ebf1ded27c7575ef850387d0bb2e6800a7d786eebad01b6b862bf53f7f"
    //   },
    //   toChain: {
    //     id: 8,
    //     hash: "222479081"
    //   },
    // },
    //
    // // ethereum - nova
    // {
    //   fromChain: {
    //     id: 1,
    //     hash: "0x0aa96de047eaa91b0d8fb8d98b34906d6ed6c80ef25ab9b8821d9a1c08c5c080",
    //   },
    //   toChain: {
    //     id: 16,
    //     hash: "0x0ab6a8f13b9ff485e0a2db961aff3d3a6abbce610c30af20b7a86a4c565c9ca8"
    //   },
    // },
    // {
    //   fromChain: {
    //     id: 16,
    //     hash: "0x26d01907b573a090b5142e5f9576b265d7e6d897ef9ff207096689368f4ac9aa"
    //   },
    //   toChain: {
    //     id: 1,
    //     hash: "0x7ee0fa94336e6703962e4a575167b13bac649f4f7c60aab1a9b4d5c07726e1aa"
    //   },
    // },
  ],

  // ERC20
  "0xd7Aa9ba6cAAC7b0436c91396f22ca5a7F31664fC":[
    {
      fromChain: {
        id: 6,
        hash: "0x9c0a29491ef283eb83316c10394e267953cf833fa0634e506c1cd2b5ce9ce88a",
      },
      toChain: {
        id: 2,
        hash: "0x2efe7b6a95b3dc0e774a1c8657fae0480436cf9befe328e4a7606acb7f06920e",
      },
    }
  ],

  // OrbiterX
  "0x1C84DAA159cf68667A54bEb412CDB8B2c193fb32":[
    {
      fromChain: {
        id: 2,
        hash: "0xc230ebdbe0c8de483eee1199b13e1325d784fb241d0f97cf075fb859e314c324",
      },
      toChain: {
        id: 6,
        hash: "0xb513b3b59c19f005db3f941ff2eeae97dcacab5c0c9db72407c19ad76dc2c6a6",
      },
    }
  ]
};
async function main() {
  await ctx.init();
  ctx.makerConfigs = convertMakerConfig(require(`./maker-80c.json`));
  for (const chain of ctx.config.chains) {
    chain.watch = chain.watch.filter(item => item !== "alchemy-api");
  }
  console.log(`support chainId ${ctx.config.chains.map(item => item.internalId)}`);
  console.log("init ctx success");
  const watch = new Watch(ctx);

  const hashList: string[] = [];
  for (const makerAddress in dataMap) {
    const list: { id, fromChain, toChain }[] = dataMap[makerAddress];
    list.map(item => item.fromChain.hash);
    for (const dt of list) {
      hashList.push(dt.fromChain.hash);
      hashList.push(dt.toChain.hash);
    }
  }
  // TODO local
  // const deleteCount: number = await ctx.models.Transaction.destroy({
  //   where: {
  //     hash: hashList,
  //   },
  // });
  // await ctx.redis.del("TXHASH_STATUS");
  // console.log(`delete data count ${deleteCount}`);

  const handleTx = async (tx) => {
    // await ctx.mq.producer.publish([tx], "");
    return await bulkCreateTransaction(ctx, [tx]);
  };

  const insertDB = async (id, hash, makerAddress, blockNumber?) => {
    if (+id === 4 || +id === 44) {
      const chainWatch = <StarknetWatch>ChainFactory.createWatchChainByIntranetId(id + "");
      chainWatch.addWatchAddress(makerAddress);
      const txMap = await chainWatch.replayByBlockSequencerProvider(blockNumber);
      const txList = txMap.get(makerAddress);
      const tx = txList.find(item => item.hash.toLowerCase() === hash.toLowerCase());
      if (!tx) {
        console.error(`can't find starknet tx ${hash}`);
      }
      await handleTx(tx);
      return;
    }
    const chainWatch = ChainFactory.createWatchChainByIntranetId(id + "");
    const tx = await chainWatch.chain.getTransactionByHash(hash);
    await handleTx(tx);
  };

  for (const makerAddress in dataMap) {
    const dataList: { id, fromChain, toChain }[] = dataMap[makerAddress];
    for (const data of dataList) {
      await insertDB(data.fromChain.id, data.fromChain.hash, ctx.makerConfigs.find(item => +item.fromChain.id === +data.fromChain.id).recipient, data.fromChain.blockNumber);
      await insertDB(data.toChain.id, data.toChain.hash, ctx.makerConfigs.find(item => +item.toChain.id === +data.toChain.id).sender, data.toChain.blockNumber);
      console.log(`${data.fromChain.id}-${data.toChain.id} complete`);
    }
  }

  await sleep(2000);
  // match  TODO delete return await this.readMakerendReMatch();
  await watch.readMakerendReMatch();
  const txList = await ctx.models.Transaction.findAll({
    raw: true,
    attributes: ["hash", "chainId", "symbol", "source", "side", "status"],
    order: [["timestamp", "desc"]],
    where: {
      hash: hashList,
    },
  });
  for (const hash of hashList) {
    if (!txList.find(item => item.hash.toLowerCase() === hash.toLowerCase())) {
      console.error(`can't find ${hash}`);
    }
  }
  console.log("==================================================");
  for (const tx of txList) {
    console.log(tx.hash, `chainId: ${tx.chainId}`, tx.symbol, tx.source, tx.side ? "toUser" : "toMaker", tx.status);
  }
  console.log("==================================================");
}


describe("Transaction test", function() {
  it("match test", async function() {
    await main();
  });
});
