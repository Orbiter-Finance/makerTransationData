import amqp from "amqplib";
import { Buffer } from "buffer";

enum EExchangeName {
  MTU = "MakerToUser",
  UTM = "UserToMaker"
}

export class RabbitMq {
  mqConnect;

  constructor() {
    this.mqConnect = amqp.connect({
      protocol: "amqp",
      hostname: process.env.RABBITMQ_DEFAULT_HOSTNAME,
      port: process.env.RABBITMQ_DEFAULT_PORT,
      vhost: process.env.RABBITMQ_DEFAULT_VHOST,
      username: process.env.RABBITMQ_DEFAULT_USER,
      password: process.env.RABBITMQ_DEFAULT_PASS,
    });
  }

  async publish(side: number, chainId: number | string, data: any) {
    const exchangeName: EExchangeName = side ? EExchangeName.MTU : EExchangeName.UTM;
    const topic = `${chainId}:mqtxlist`;
    console.log(`RabbitMq produce ${exchangeName} ${topic}`);
    const connection = await this.mqConnect;
    const channel = await connection.createConfirmChannel();
    await channel.assertExchange(exchangeName, "fanout", {
      durable: true,
    });
    await channel.assertQueue(topic);
    if (typeof data == 'object') {
      data = JSON.stringify(data);
    }
    channel.sendToQueue(topic, Buffer.from(data));
    channel.close();
  }

  async subscribe(side: number, chainId: number | string, callback: Function) {
    if (typeof callback !== "function") {
      throw new TypeError(
        "When subscribing for an event, a callback function must be defined.",
      );
    }
    const exchangeName: EExchangeName = side ? EExchangeName.MTU : EExchangeName.UTM;
    const topic = `${chainId}:mqtxlist`;
    const connection = await this.mqConnect;
    const channel = await connection.createChannel();
    await channel.assertExchange(exchangeName, "fanout", {
      durable: true,
    });
    await channel.assertQueue(topic);
    await channel.bindQueue(topic, exchangeName, topic);
    await channel.consume(topic, (msg: any) => {
      try {
        callback(JSON.parse(msg.content.toString()));
      } catch (e) {
        callback(msg.content.toString());
      }
    });
  }
}
