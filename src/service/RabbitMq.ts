import amqp from "amqplib";
import { Buffer } from "buffer";
import { Context } from "../context";

export class RabbitMq {
  public ctx: Context = new Context();
  private exchangeName = "chaincore_txs";

  async publish(chainList: any[]) {
    const channel = this.ctx.channel;
    for (const chain of chainList) {
      const topic = `chaincore:${chain.chainId}`;
      console.log(`RabbitMq publish ${topic}`);
      const str = JSON.stringify(chain);
      await channel.publish(this.exchangeName, chain.chainId, Buffer.from(str));
    }
  }
}
