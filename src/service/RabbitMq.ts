import amqp from "amqplib";
import { Buffer } from "buffer";

export class RabbitMq {
  private mqConnect;
  private exchangeName = 'chaincore_txs';

  constructor() {
    this.mqConnect = amqp.connect({
      protocol: "amqp",
      hostname: process.env.RABBITMQ_DEFAULT_HOSTNAME || 'localhost',
      port: Number(process.env.RABBITMQ_DEFAULT_PORT) || 5672,
      vhost: process.env.RABBITMQ_DEFAULT_VHOST || "/",
      username: process.env.RABBITMQ_DEFAULT_USER || "guest",
      password: process.env.RABBITMQ_DEFAULT_PASS || "guest",
    });
  }

  async publish(chainList: any[]) {
    const connection = await this.mqConnect;
    const channel = await connection.createConfirmChannel();
    for (const chain of chainList) {
      const topic = `chaincore:${chain.chainId}`;
      console.log(`RabbitMq publish ${topic}`);
      await channel.assertExchange(this.exchangeName, "direct", {
        autoDelete: false,
        durable: true,
      });
      const str = JSON.stringify(chain);
      await channel.publish(this.exchangeName, chain.chainId, Buffer.from(str));
    }
    channel.close();
  }

  async subscribe(chainIdList: string[], callback: Function) {
    if (typeof callback !== "function") {
      throw new TypeError(
        "When subscribing for an event, a callback function must be defined.",
      );
    }

    const connection = await this.mqConnect;
    const channel = await connection.createChannel();
    for (const chainId of chainIdList) {
      const topic = `chaincore:${chainId}`;
      console.log(`RabbitMq receive ${topic}`);
      const routingKey = chainId;
      await channel.assertQueue(topic, {
        autoDelete: false,
        durable: true,
      });
      await channel.bindQueue(topic, this.exchangeName, routingKey);
      // await channel.prefetch(1, false);
      await channel.consume(topic, (msg: any) => {
        try {
          // channel.ack(msg); // reply msg
          callback(JSON.parse(msg.content.toString()));
        } catch (e) {
          callback(msg.content.toString());
        }
      });
    }
  }
}
