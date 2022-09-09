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
  private userTxTree: MerkleTree = new MerkleTree([], {
    sort: false,
  });
  private makerTxTree: MerkleTree = new MerkleTree([], {
    sort: false,
  });
  private maxTxId = {
    user: 0,
    maker: 0,
  };
  private rpcPovider!: providers.JsonRpcProvider;
  constructor(private readonly ctx: Context, private chainId: number) {
    const chain = chains.getChainByChainId("5777");
    if (chain) {
      this.rpcPovider = new providers.JsonRpcProvider(chain.rpc[0]);
    }
  }
  public calculateLeaf(tx: transactionAttributes) {
    const responseAmount = calcMakerSendAmount(this.ctx.makerConfigs, tx);
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
      timestamp: tx.timestamp,
      responseAmount: responseAmount,
      ebcid,
    };
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
      ],
    );

    return { hex, leaf };
  }
  public async initTree() {
    const userTxList = await this.getUserNotRefundedTransactionList();
    this.userTxTree = new MerkleTree([], keccak256, {
      sort: false,
    });
    await this.updateUserTxTree(userTxList);
    const makerTxList = await this.getMakerDelayTransactionList();
    this.makerTxTree = new MerkleTree([], keccak256, {
      sort: false,
    });
    await this.updateMakerTxTree(makerTxList);
    return true;
  }
  public async updateMakerTxTree(txList: Array<transactionAttributes>) {
    txList = orderBy(txList, ["id"], ["asc"]);
    for (const tx of txList) {
      const { hex } = this.calculateLeaf(tx);
      if (this.userTxTree.getLeafIndex(Buffer.from(hex)) < 0) {
        if (tx.id > this.maxTxId.maker) {
          this.maxTxId.maker = tx.id;
        }
        this.makerTxTree.addLeaf(Buffer.from(hex));
      }
    }
    //
    console.debug("makerTxTree:\n", this.makerTxTree.toString());
    if (txList.length > 0) {
      const nowRoot = this.makerTxTree.getHexRoot();
      const onChainRoot = await this.getMakerTreeRoot();
      if (onChainRoot != nowRoot) {
        await this.setMakerTxTreeRoot(nowRoot);
      }
    }
  }
  public async updateUserTxTree(txList: Array<transactionAttributes>) {
    txList = orderBy(txList, ["id"], ["asc"]);
    for (const tx of txList) {
      const { hex } = this.calculateLeaf(tx);
      if (this.userTxTree.getLeafIndex(Buffer.from(hex)) < 0) {
        if (tx.id > this.maxTxId.user) {
          this.maxTxId.user = tx.id;
        }
        this.userTxTree.addLeaf(Buffer.from(hex));
      }
    }
    //
    console.debug("userTxTree:\n", this.userTxTree.toString());
    if (txList.length > 0) {
      const nowRoot = this.userTxTree.getHexRoot();
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
