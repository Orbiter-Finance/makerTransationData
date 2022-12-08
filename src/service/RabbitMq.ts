import { Buffer } from "buffer";
import { Context } from "../context";

export class RabbitMq {
  constructor(public readonly ctx: Context) {}
  private exchangeName = "chaincore_txs";

  async publish(chainList: any[]) {
    const channel = this.ctx.channel;
    for (const chain of chainList) {
      const topic = `chaincore:${chain.chainId}`;
      const str = JSON.stringify(chain);
      const res = await channel.publish(this.exchangeName, chain.chainId + "", Buffer.from(str));
      if (res) console.log(`RabbitMq publish success ${topic} ${chain.source} ${res}`);
      else console.log(`RabbitMq publish fail ${topic} ${chain.source} ${res}`);
    }
  }
}
