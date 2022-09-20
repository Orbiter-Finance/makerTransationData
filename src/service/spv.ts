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
  private maxTxId = {
    user: 0,
    maker: 0,
  };
  private rpcPovider!: providers.JsonRpcProvider;
  constructor(private readonly ctx: Context, private chainId: number) {
    const chain = chains.getChainByChainId(String(chainId));
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
  public async initTree() {
    const userTxList = await this.getUserNotRefundedTransactionList();
    this.ctx.spv.userTxTree = new MerkleTree([], keccak256, {
      sort: false,
    });
    await this.updateUserTxTree(userTxList);
    const makerTxList = await this.getMakerDelayTransactionList();
    this.ctx.spv.makerTxTree = new MerkleTree([], keccak256, {
      sort: false,
    });
    await this.updateMakerTxTree(makerTxList);
    return true;
  }
  public async updateMakerTxTree(txList: Array<transactionAttributes>) {
    txList = orderBy(txList, ["id"], ["asc"]);
    for (const tx of txList) {
      const { hex } = await this.calculateLeaf(tx);
      if (this.ctx.spv.userTxTree.getLeafIndex(Buffer.from(hex)) < 0) {
        if (tx.id > this.maxTxId.maker) {
          this.maxTxId.maker = tx.id;
        }
        this.ctx.spv.makerTxTree.addLeaf(Buffer.from(hex));
      }
    }
    //
    console.debug("makerTxTree:\n", this.ctx.spv.makerTxTree.toString());
    if (txList.length > 0) {
      const nowRoot = this.ctx.spv.makerTxTree.getHexRoot();
      const onChainRoot = await this.getMakerTreeRoot();
      if (onChainRoot != nowRoot) {
        await this.setMakerTxTreeRoot(nowRoot);
      }
    }
  }
  public async updateUserTxTree(txList: Array<transactionAttributes>) {
    txList = orderBy(txList, ["id"], ["asc"]);
    for (const tx of txList) {
      const { hex } = await this.calculateLeaf(tx);
      if (this.ctx.spv.userTxTree.getLeafIndex(Buffer.from(hex)) < 0) {
        if (tx.id > this.maxTxId.user) {
          this.maxTxId.user = tx.id;
        }
        this.ctx.spv.userTxTree.addLeaf(Buffer.from(hex));
      }
    }
    //
    console.debug("userTxTree:\n", this.ctx.spv.userTxTree.toString());
    if (txList.length > 0) {
      const nowRoot = this.ctx.spv.userTxTree.getHexRoot();
      const onChainRoot = await this.getUserTreeRoot();
      if (onChainRoot != nowRoot) {
        await this.setUserTxTreeRoot(nowRoot);
      }
    }
  }
  public checkTree() {
    setInterval(() => {
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
    }, 1000 * 60);
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
    const tx = await spvContract.setUserTxTreeRoot(this.chainId, root);
    return tx;
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
    const tx = await spvContract.setMakerTxTreeRoot(this.chainId, root);
    return tx;
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
