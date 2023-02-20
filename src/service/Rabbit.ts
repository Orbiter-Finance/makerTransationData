import { Channel, connect, Connection } from "amqplib";
import { Context } from "../context";
export default class MQProducer {
  private connection?: Connection;
  private exchangeName =
    process.env["RABBITMQ_DEFAULT_EXCHANGE"] || "chaincore_txs";
  private channels: { [key: string]: Channel } = {};
  constructor(
    public readonly ctx: Context,
    private readonly chainsIds: string[],
  ) {
    void this.connectionMqServer();
  }
  public async connectionMqServer(): Promise<void> {
    this.connection = await connect(
      {
        protocol: "amqp",
        hostname: process.env.RABBITMQ_DEFAULT_HOSTNAME || "localhost",
        port: Number(process.env.RABBITMQ_DEFAULT_PORT) || 5672,
        vhost: process.env.RABBITMQ_DEFAULT_VHOST || "/",
        username: process.env.RABBITMQ_DEFAULT_USER || "guest",
        password: process.env.RABBITMQ_DEFAULT_PASS || "guest",
      },
      {
        clientProperties: {
          connection_name: `instance: ${this.ctx.instanceId}`,
        },
      },
    );
    this.ctx.logger.info(
      "RabbitMQ Connection Success:",
      this.connection.connection.serverProperties,
    );
    const channel = await this.connection.createChannel();
    await channel.assertExchange(this.exchangeName, "direct", {
      durable: false,
      autoDelete: true,
    });
    for (const chainId of this.chainsIds) {
      const channel = await this.connection.createChannel();
      const queueName = `chaincore:${chainId}`;
      const routingKey = String(chainId);
      await channel.assertQueue(queueName, {
        autoDelete: true,
        durable: false,
      });
      await channel.bindQueue(queueName, this.exchangeName, routingKey);
      this.channels[routingKey] = channel;
    }
    const handleDisconnections = (e: any) => {
      try {
        this.ctx.logger.error(`handleDisconnections`, e);
        this.connection && this.connection.close();
        void this.connectionMqServer();
      } catch (error) {
        this.ctx.logger.error(`handleDisconnections error`, error);
      }
    };
    this.connection.on("disconnect", handleDisconnections);
    this.connection.on("reconnect", handleDisconnections);
    this.connection.on("error", handleDisconnections);
  }
  public async publish(routingKey: string, msg: object | string) {
    const channel = this.channels[routingKey];
    if (!channel) {
      console.log(`channel ${routingKey} not found`);
      return;
    }
    if (typeof msg === "object") {
      msg = JSON.stringify(msg);
    }
    const result = await channel.publish(
      this.exchangeName,
      routingKey,
      Buffer.from(msg),
    );
    this.ctx.logger.info(`mq send result msg:${msg}, result:${result}`);
  }
}
