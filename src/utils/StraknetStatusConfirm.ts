import dayjs from "dayjs";
import * as fs from "fs-extra";
import { chains, chainService } from "orbiter-chaincore";
import { Op } from "sequelize";
import { Context } from "./../context";

export class StarknetStatusConfirm {
  constructor(
    private readonly ctx: Context,
    private readonly chainId: string,
  ) {}
  async start(): Promise<void> {
    const { count, rows } = await this.readTxs();
    await fs.outputJSONSync(
      "./runtime/starknet_status/starknet_receive.json",
      rows,
    );
    console.log(`\x1B[31m total:${count}, page:1, size:${rows.length}\x1B[0m`);
    for (let i = 0; i < rows.length; i++) {
      const tx = rows[i];
      const status = await this.getStatusByTxid(tx.hash);
      const content = `Process:${i + 1}/${rows.length}/${count}，Hash:${
        tx.hash
      }，Status:${status}`;
      status === "REJECTED"
        ? console.log(`\x1B[31m${content}\x1B[0m`)
        : console.log(content);
      await fs.appendFileSync(
        `./runtime/starknet_status/${status}`,
        tx.hash + `\n`,
      );
    }
  }
  async readTxs() {
    // query
    const result = await this.ctx.models.Transaction.findAndCountAll({
      raw: true,
      attributes: ["id", "hash", "from", "value", "memo", "symbol"],
      where: {
        chainId: 4,
        timestamp: {
          [Op.gte]: dayjs().subtract(7, "d").startOf("d").toDate(),
          [Op.lte]: dayjs().endOf("d").toDate(),
        },
        status: {
          // [Op.not]: 2
          [Op.in]: [99, 98],
        },
        to: "0x07c57808b9cea7130c44aab2f8ca6147b04408943b48c6d8c3c83eb8cfdd8c0b",
      },
      order: [["id", "desc"]],
      limit: 5000,
    });
    return result;
  }
  async getStatusByTxid(txid: string) {
    const config = chains.getChainInfo(Number(this.chainId));
    if (config) {
      const service = new chainService.Starknet(config);
      const { tx_status } = await service.provider.getTransactionStatus(txid);
      return tx_status;
    }
  }
}
