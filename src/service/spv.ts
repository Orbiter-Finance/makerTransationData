import { isEmpty } from "orbiter-chaincore/src/utils/core";
import { Transaction as transactionAttributes } from "../models/Transactions";
import { chains } from "orbiter-chaincore";
import dayjs from "dayjs";
import { Contract, ethers, providers, utils } from "ethers";
import keccak256 from "keccak256";
import MerkleTree from "merkletreejs";
import { Op } from "sequelize";
import { Context } from "../context";
import SPVAbi from "../abi/spv.json";
import { orderBy } from "lodash";
import { groupWatchAddressByChain } from "../utils";
export class SPV {
  private rpcPovider!: providers.JsonRpcProvider;
  public static tree: {
    [key: string]: {
      uncollectedPayment: MerkleTree;
      delayedPayment: MerkleTree;
    };
  } = {};
  constructor(
    private readonly ctx: Context,
    private readonly contractChainId: number,
  ) {
    const chain = chains.getChainByInternalId(String(this.contractChainId));
    if (chain) {
      this.rpcPovider = new providers.JsonRpcProvider(chain.rpc[0]);
    }
  }

  public static async calculateLeaf(tx: transactionAttributes) {
    let expectValue;
    let expectSafetyCode = 0;
    const extra: any = tx.extra || {};
    if (tx.side === 0 && extra) {
      // user
      expectValue = tx.expectValue || "0";
      expectSafetyCode = Number(tx.nonce);
    } else if (tx.side === 1) {
      expectValue = tx.value || "0";
      expectSafetyCode = Number(tx.memo);
    }
    const ebcid = extra.ebcId || 0;
    const leaf = {
      lpId: tx.lpId,
      chain: tx.chainId,
      id: tx.hash,
      from: tx.from.toLowerCase(),
      to: tx.to.toLowerCase(),
      nonce: tx.nonce,
      value: tx.value,
      token: tx.tokenAddress,
      timestamp: dayjs(tx.timestamp).utc().unix(),
      expectValue,
      expectSafetyCode,
      ebcId: ebcid,
    };
    const args = [
      String(leaf.lpId),
      leaf.chain,
      leaf.id,
      leaf.from,
      leaf.to,
      Number(leaf.nonce),
      leaf.value,
      leaf.token,
      leaf.timestamp,
      leaf.expectValue,
      leaf.expectSafetyCode,
      Number(leaf.ebcId),
    ];
    if (isEmpty(args[0])) {
      throw new Error("Missing parameter LPID");
    }
    const hex = utils.solidityKeccak256(
      [
        "bytes32",
        "uint256",
        "bytes32",
        "address",
        "address",
        "uint256",
        "uint256",
        "address",
        "uint256",
        "uint256",
        "uint256",
        "uint256",
      ],
      args,
    );
    return { hex, leaf };
  }
  public async start() {
    const chainGroup = groupWatchAddressByChain(this.ctx.makerConfigs);
    console.log("chainGroup：", chainGroup);
    for (const chainId in chainGroup) {
      const defaultLeafs = [
        Buffer.from(
          "0000000000000000000000000000000000000000000000000000000000000000",
          "hex",
        ),
      ];
      const tree = {
        uncollectedPayment: new MerkleTree(defaultLeafs, keccak256, {
          sort: true,
        }),
        delayedPayment: new MerkleTree(defaultLeafs, keccak256, {
          sort: true,
        }),
      };
      SPV.tree[chainId] = tree;
      const spvByChain = new ChainSPVTree(
        this.ctx,
        Number(chainId),
        this.rpcPovider,
        tree,
      );
      spvByChain.initTree().catch(error => {
        this.ctx.logger.error(`${chainId} initTree error:`, error);
      });
    }
  }
}

export class ChainSPVTree {
  public tree: {
    userTxTree: MerkleTree;
    makerTxTree: MerkleTree;
  };
  private maxTxId = {
    user: 0,
    maker: 0,
  };
  constructor(
    private readonly ctx: Context,
    private readonly chainId: number,
    private readonly rpcPovider: providers.JsonRpcProvider,
    tree: any,
  ) {
    this.tree = {
      makerTxTree: tree["delayedPayment"],
      userTxTree: tree["uncollectedPayment"],
    };
  }
  public async initTree() {
    // Timer refresh
    const refresh = () => {
      this.getUserNotRefundedTransactionList()
        .then(txList => {
          txList.length > 0 && this.updateUserTxTree(txList);
        })
        .catch(error => {
          this.ctx.logger.error(`checkTree User error:`, error);
        });
      this.getMakerDelayTransactionList()
        .then(txList => {
          txList.length > 0 && this.updateMakerTxTree(txList);
        })
        .catch(error => {
          this.ctx.logger.error(`checkTree Maker error:`, error);
        });
    };
    refresh();
    setInterval(refresh, 1000 * 60);
    return true;
  }

  public async updateMakerTxTree(txList: Array<transactionAttributes>) {
    txList = orderBy(txList, ["id"], ["asc"]);
    for (const tx of txList) {
      const { hex } = await SPV.calculateLeaf(tx);
      if (this.tree.makerTxTree.getLeafIndex(Buffer.from(hex)) < 0) {
        if (tx.id > this.maxTxId.maker) {
          this.maxTxId.maker = tx.id;
        }
        this.tree.makerTxTree.addLeaf(<any>hex);
        // this.tree.makerTxTree.addLeaf(Buffer.from(hex));
      }
    }
    //
    if (txList.length > 0) {
      const nowRoot = this.tree.makerTxTree.getHexRoot();
      const onChainRoot = await this.getMakerTreeRoot();
      console.debug(
        "makerTxTree:\n",
        this.tree.makerTxTree.toString(),
        `\ndiff:${onChainRoot}/${nowRoot}`,
      );
      if (onChainRoot != nowRoot) {
        await this.setMakerTxTreeRoot(nowRoot);
      }
    }
  }
  public async updateUserTxTree(txList: Array<transactionAttributes>) {
    txList = orderBy(txList, ["id"], ["asc"]);
    for (const tx of txList) {
      const { hex } = await SPV.calculateLeaf(tx);
      if (this.tree.userTxTree.getLeafIndex(Buffer.from(hex)) < 0) {
        if (tx.id > this.maxTxId.user) {
          this.maxTxId.user = tx.id;
        }
        this.tree.userTxTree.addLeaf(hex as any);
      }
    }
    //
    if (txList.length > 0) {
      const nowRoot = this.tree.userTxTree.getHexRoot();
      const onChainRoot = await this.getUserTreeRoot();
      console.debug(
        "userTxTree:\n",
        this.tree.userTxTree.toString(),
        `\ndiff:${onChainRoot}/${nowRoot}`,
      );
      if (onChainRoot != nowRoot) {
        await this.setUserTxTreeRoot(nowRoot);
      }
    }
  }
  public async getUserNotRefundedTransactionList(): Promise<
    Array<transactionAttributes>
  > {
    const chainData = this.ctx.config.chainsTokens.find(
      row => row.id === this.chainId,
    );
    if (!chainData) {
      this.ctx.logger.error(
        "getUserNotRefundedTransactionList getChain Not Found",
      );
      return [];
    }
    const maxReceiptTime = chainData.maxReceiptTime;
    const where = {
      chainId: this.chainId,
      status: 1,
      side: 0,
      id: {
        [Op.gt]: this.maxTxId.user,
      },
      timestamp: {
        [Op.lte]: dayjs().subtract(maxReceiptTime, "s").toDate(),
      },
    };
    const txList = await this.ctx.models.Transaction.findAll({
      attributes: [
        "id",
        "hash",
        "from",
        "to",
        "value",
        "nonce",
        "memo",
        "side",
        "tokenAddress",
        "symbol",
        "expectValue",
        "lpId",
        "makerId",
        "chainId",
        "timestamp",
        "extra",
      ],
      raw: true,
      where,
    });
    return txList;
  }

  public async getMakerDelayTransactionList(): Promise<
    Array<transactionAttributes>
  > {
    // TODO:
    const where = {
      chainId: this.chainId,
      status: 98,
      side: 1,
      id: {
        [Op.gt]: this.maxTxId.maker,
      },
    };
    const txList = await this.ctx.models.Transaction.findAll({
      attributes: [
        "id",
        "hash",
        "from",
        "to",
        "value",
        "nonce",
        "memo",
        "side",
        "tokenAddress",
        "symbol",
        "expectValue",
        "lpId",
        "makerId",
        "chainId",
        "timestamp",
        "extra",
      ],
      raw: true,
      where,
    });
    return txList;
  }
  public async setUserTxTreeRoot(root: string) {
    const { SPV_CONTRACT, SPV_WALLET } = process.env;
    if (!SPV_CONTRACT) {
      throw new Error("SPV_CONTRACT Not Found");
    }
    if (!SPV_WALLET) {
      throw new Error("SPV_WALLET Not Found");
    }
    const wallet = new ethers.Wallet(SPV_WALLET, this.rpcPovider);
    const spvContract = new Contract(SPV_CONTRACT, SPVAbi, wallet);
    try {
      const params: any = {};
      if (process.env["GAS_LIMIT"])
        params["gasLimit"] = Number(process.env["GAS_LIMIT"]);
      const tx = await spvContract.setUserTxTreeRoot(
        this.chainId,
        root,
        params,
      );
      this.ctx.logger.info(
        `${this.chainId} setUserTxTreeRoot success:${tx.hash}`,
      );
      return tx;
    } catch (error) {
      this.ctx.logger.error(`${this.chainId} setUserTxTreeRoot error:`, error);
    }
  }
  public async setMakerTxTreeRoot(root: string) {
    const { SPV_CONTRACT, SPV_WALLET } = process.env;
    if (!SPV_CONTRACT) {
      throw new Error("SPV_CONTRACT Not Found");
    }
    if (!SPV_WALLET) {
      throw new Error("SPV_WALLET Not Found");
    }
    const wallet = new ethers.Wallet(SPV_WALLET, this.rpcPovider);
    const spvContract = new Contract(SPV_CONTRACT, SPVAbi, wallet);
    try {
      const params: any = {};
      if (process.env["GAS_LIMIT"])
        params["gasLimit"] = Number(process.env["GAS_LIMIT"]);
      const tx = await spvContract.setMakerTxTreeRoot(
        this.chainId,
        root,
        params,
      );
      this.ctx.logger.info(
        `${this.chainId} setMakerTxTreeRoot success:${tx.hash}`,
      );
      return tx;
    } catch (error) {
      this.ctx.logger.error(`${this.chainId} setMakerTxTreeRoot error:`, error);
    }
  }
  public async getUserTreeRoot() {
    const { SPV_CONTRACT, SPV_WALLET } = process.env;
    if (!SPV_CONTRACT) {
      throw new Error("SPV_CONTRACT Not Found");
    }
    if (!SPV_WALLET) {
      throw new Error("SPV_WALLET Not Found");
    }
    const wallet = new ethers.Wallet(SPV_WALLET, this.rpcPovider);
    const spvContract = new Contract(SPV_CONTRACT, SPVAbi, wallet);
    const root = await spvContract.userTxTree(this.chainId);
    return root;
  }
  public async getMakerTreeRoot() {
    const { SPV_CONTRACT, SPV_WALLET } = process.env;
    if (!SPV_CONTRACT) {
      throw new Error("SPV_CONTRACT Not Found");
    }
    if (!SPV_WALLET) {
      throw new Error("SPV_WALLET Not Found");
    }
    const wallet = new ethers.Wallet(SPV_WALLET, this.rpcPovider);
    const spvContract = new Contract(SPV_CONTRACT, SPVAbi, wallet);
    const root = await spvContract.makerTxTree(this.chainId);
    return root;
  }
}
