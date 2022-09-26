import { transactionAttributes } from "./../models/transaction";
import { chains } from "orbiter-chaincore";
import dayjs from "dayjs";
import { Contract, ethers, providers, utils } from "ethers";
import keccak256 from "keccak256";
import MerkleTree from "merkletreejs";
import { Op } from "sequelize";
import { Context } from "../context";
import SPVAbi from "../abi/spv.json";
import { orderBy } from "lodash";
import { calcMakerSendAmount } from "./transaction";
export class SPV {
  private rpcPovider!: providers.JsonRpcProvider;
  public static tree: {
    [key: string]: {
      uncollectedPayment: MerkleTree;
      delayedPayment: MerkleTree;
    };
  } = {};
  constructor(private readonly ctx: Context, private contractChainId: number) {
    const chain = chains.getChainByChainId(String(contractChainId));
    if (chain) {
      this.rpcPovider = new providers.JsonRpcProvider(chain.rpc[0]);
    }
  }
  public static getTreeTxHash(
    chainId: number,
    hash: string,
    from: string,
    to: string,
    nonce: string,
    value: string,
    token: string,
    timestamp: number,
    respAmount: string,
    ebcId: number,
  ) {
    const hex = utils.solidityKeccak256(
      [
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
      ],
      [
        chainId,
        hash,
        from,
        to,
        nonce,
        value,
        token,
        timestamp,
        respAmount,
        ebcId,
      ],
    );
    return hex;
  }
  public async start() {
    // const chainGroup = groupWatchAddressByChain(this.ctx.makerConfigs);
    const chainGroup = {
      "2": [],
    };
    for (const chainId in chainGroup) {
      const tree = {
        uncollectedPayment: new MerkleTree([], keccak256, {
          sort: false,
        }),
        delayedPayment: new MerkleTree([], keccak256, {
          sort: false,
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

  private async calculateLeaf(tx: transactionAttributes) {
    let responseAmount = tx.value;
    if (tx.side === 0) {
      const makerConfigs = this.ctx.makerConfigs;
      responseAmount = String(await calcMakerSendAmount(makerConfigs, tx));
    }
    const extra: any = tx.extra || {};
    const ebcid = extra.ebcId || 0;
    const leaf = {
      chain: tx.chainId,
      id: tx.hash,
      from: tx.from.toLowerCase(),
      to: tx.to.toLowerCase(),
      nonce: tx.nonce,
      value: tx.value,
      token: tx.tokenAddress,
      timestamp: dayjs(tx.timestamp).unix(),
      responseAmount: responseAmount,
      ebcid,
    };
    const hash = SPV.getTreeTxHash(
      leaf.chain,
      leaf.id,
      leaf.from,
      leaf.to,
      leaf.nonce,
      leaf.value,
      leaf.token,
      leaf.timestamp,
      leaf.responseAmount,
      leaf.ebcid,
    );
    return { hex: hash, leaf };
  }

  public async updateMakerTxTree(txList: Array<transactionAttributes>) {
    txList = orderBy(txList, ["id"], ["asc"]);
    for (const tx of txList) {
      const { hex } = await this.calculateLeaf(tx);
      if (this.tree.makerTxTree.getLeafIndex(Buffer.from(hex)) < 0) {
        if (tx.id > this.maxTxId.maker) {
          this.maxTxId.maker = tx.id;
        }
        this.tree.makerTxTree.addLeaf(Buffer.from(hex));
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
      const { hex } = await this.calculateLeaf(tx);
      if (this.tree.userTxTree.getLeafIndex(Buffer.from(hex)) < 0) {
        if (tx.id > this.maxTxId.user) {
          this.maxTxId.user = tx.id;
        }
        this.tree.userTxTree.addLeaf(Buffer.from(hex));
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
    const where = {
      chainId: this.chainId,
      status: 1,
      side: 0,
      id: {
        [Op.gt]: this.maxTxId.user,
      },
      timestamp: {
        [Op.lte]: dayjs()
          .subtract(this.ctx.config.makerTransferTimeout, "m")
          .toDate(),
      },
    };
    const txList = await this.ctx.models.transaction.findAll({
      attributes: [
        "id",
        "hash",
        "from",
        "to",
        "value",
        "nonce",
        "tokenAddress",
        "symbol",
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
    const txList = await this.ctx.models.transaction.findAll({
      attributes: [
        "id",
        "hash",
        "from",
        "to",
        "value",
        "nonce",
        "tokenAddress",
        "symbol",
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
