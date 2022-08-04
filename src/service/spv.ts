import dayjs from "dayjs";
import { ethers, providers } from "ethers";
import keccak256 from "keccak256";
import MerkleTree from "merkletreejs";
import { Op } from "sequelize";
import { Context } from "../context";
export class SPV {
  private tree: MerkleTree = new MerkleTree([]);
  private rpcPovider!: providers.JsonRpcProvider;
  constructor(private readonly ctx: Context, private chainId: number) {
    this.rpcPovider = new providers.JsonRpcProvider(
      "https://mainnet.infura.io/v3/b05e00d568ac421ebb76cf518e162c6b",
    );
  }
  public async initTree() {
    const txList = await this.getUncollectedTransaction(this.chainId);
    const leafs = txList.map((tx: any) => {
      // from , to, value, nonce
      const from = tx["in.from"].toLowerCase();
      const to = tx["in.to"].toLowerCase();
      const nonce = tx["in.nonce"];
      const value = tx["in.value"];
      const hex = ethers.utils.solidityKeccak256(
        ["address", "address", "uint256", "uint256"],
        [from, to, value, nonce],
      );
      return Buffer.from(hex);
    });
    this.tree = new MerkleTree(leafs, keccak256, {
      sort: true,
      hashLeaves: true,
    });
    console.log("getHexLeaves", this.tree.getHexLayers());
    console.log("root", this.tree.getHexRoot());
    const nowRoot = this.tree.getHexRoot();
    const onChainRoot = await this.getSPVMerkleTreeRoot();
    if (onChainRoot != nowRoot) {
      await this.setSPVMerkleTreeRoot(nowRoot);
    }
  }
  public async getUncollectedTransaction(chainId: number) {
    const where = {
      outId: null,
      fromChain: chainId,
    };
    const txList = await this.ctx.models.maker_transaction.findAll({
      where: <any>where,
      attributes: [
        "id",
        "transcationId",
        "fromChain",
        "toChain",
        "toAmount",
        "replySender",
        "replyAccount",
      ],
      raw: true,
      include: [
        {
          as: "in",
          attributes: ["hash", "from", "to", "nonce", "value", "timestamp"],
          model: this.ctx.models.transaction,
          where: {
            status: 1,
            // chainId, TAG:
            timestamp: {
              [Op.lte]: dayjs().subtract(5, "m").toDate(),
            },
          },
        },
      ],
    });
    return txList;
  }
  public async setSPVMerkleTreeRoot(hash: string) {
    // TODO: set mk root
  }
  public async getSPVMerkleTreeRoot() {
    // TODO: get mk root
    // const contract = new Contract(
    //   "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    //   IERC20_ABI_JSON,
    //   this.rpcPovider,
    // );

    // const hash = await contract.callStatic.symbol();
    const hash = "";
    return hash;
  }
}
