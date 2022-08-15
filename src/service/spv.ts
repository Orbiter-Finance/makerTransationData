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
export class SPV {
  private tree: MerkleTree = new MerkleTree([]);
  private lastTxId: Number = 0;
  private rpcPovider!: providers.JsonRpcProvider;
  constructor(private readonly ctx: Context, private chainId: number) {
    const chain = chains.getChainByChainId("5777");
    if (chain) {
      this.rpcPovider = new providers.JsonRpcProvider(chain.rpc[0]);
    }
  }
  public calculateLeaf(tx: transactionAttributes) {
    const hash = tx.hash.toLowerCase();
    const from = tx.from.toLowerCase();
    const to = tx.to.toLowerCase();
    const nonce = tx.nonce;
    const value = tx.value;
    const chainId = tx.chainId;
    const token = tx.tokenAddress;
    const hex = utils.solidityKeccak256(
      [
        "uint256",
        "bytes32",
        "address",
        "address",
        "uint256",
        "uint256",
        "address",
      ],
      [chainId, hash, from, to, nonce, value, token],
    );
    const leaf = {
      chain: chainId,
      id: hash,
      from,
      to,
      nonce,
      value,
      token,
    };
    return { hex, leaf };
  }
  public async initTree() {
    const txList = await this.getUncollectedTransactionList();
    const tree = new MerkleTree([], keccak256, {
      sort: false,
    });
    this.tree = tree;
    await this.updateTree(txList);
    return tree;
  }
  public async updateTree(txList: Array<transactionAttributes>) {
    txList = orderBy(txList, ["id"], ["asc"]);
    for (const tx of txList) {
      const { hex } = this.calculateLeaf(tx);
      if (this.tree.getLeafIndex(Buffer.from(hex)) < 0) {
        if (tx.id > this.lastTxId) {
          this.lastTxId = tx.id;
        }
        this.tree.addLeaf(Buffer.from(hex));
      }
    }
    //
    console.debug("getHexLeaves", this.tree.getHexLayers());
    console.debug("root", this.tree.getHexRoot());
    if (txList.length > 0) {
      const nowRoot = this.tree.getHexRoot();
      const onChainRoot = await this.getSPVMerkleTreeRoot();
      if (onChainRoot != nowRoot) {
        await this.setSPVMerkleTreeRoot(nowRoot);
      }
    }
  }
  public checkTree() {
    setInterval(() => {
      this.getUncollectedTransactionList()
        .then(txList => {
          txList.length > 0 && this.updateTree(txList);
        })
        .catch(error => {
          this.ctx.logger.error(`checkTree error:`, error);
        });
    }, 1000 * 60);
  }
  public async getUncollectedTransactionList(): Promise<
    Array<transactionAttributes>
  > {
    const where = {
      chainId: this.chainId,
      status: 1,
      id: {
        [Op.gt]: this.lastTxId,
      },
      timestamp: {
        [Op.lte]: dayjs().subtract(5, "m").toDate(),
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
      ],
      raw: true,
      where,
    });
    return txList;
  }
  public async setSPVMerkleTreeRoot(root: string) {
    // TODO: set mk root
    console.log("set root", root);
    const { SPV_CONTRACT, SPV_WALLET } = process.env;
    if (!SPV_CONTRACT) {
      throw new Error("SPV_CONTRACT Not Found");
    }
    if (!SPV_WALLET) {
      throw new Error("SPV_WALLET Not Found");
    }
    // TODO: get mk root
    const wallet = new ethers.Wallet(SPV_WALLET, this.rpcPovider);
    const spvContract = new Contract(SPV_CONTRACT, SPVAbi, wallet);
    const tx = await spvContract.setMerkleRoot(this.chainId, root);
    return tx;
  }
  public async getSPVMerkleTreeRoot() {
    const { SPV_CONTRACT, SPV_WALLET } = process.env;
    if (!SPV_CONTRACT) {
      throw new Error("SPV_CONTRACT Not Found");
    }
    if (!SPV_WALLET) {
      throw new Error("SPV_WALLET Not Found");
    }
    // TODO: get mk root
    const wallet = new ethers.Wallet(SPV_WALLET, this.rpcPovider);
    const spvContract = new Contract(SPV_CONTRACT, SPVAbi, wallet);
    const root = await spvContract.txTree(this.chainId);
    return root;
  }
}
