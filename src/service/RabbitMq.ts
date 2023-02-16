import { Buffer } from "buffer";
import { Context } from "../context";
import amqp, { ConfirmChannel, Connection } from "amqplib";
import { getFormatDate } from "../utils/oldUtils";

let mqConnect: Connection;
const bootTime = new Date().valueOf();

export class RabbitMq {
  private connectionName;
  private reconnectCount = 0;
  private exchangeName = "chaincore_txs";

  constructor(public readonly ctx: Context) {
    this.connectionName = `Orbiter MQ ${ctx.instanceId}`;
  }

  async initChannel() {
    const channel = await this.initConnect();
    this.ctx.channel = await channel.createConfirmChannel();
    await this.ctx.channel.assertExchange("chaincore_txs", "direct", {
      autoDelete: false,
      durable: true,
    });
  }

  async initConnect(): Promise<Connection> {
    try {
      mqConnect = await amqp.connect(
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
            connection_name: this.connectionName,
          },
        },
      );

      mqConnect.on("error", (e: any) => {
        console.error("RabbitMQ connection error ", e);
        this.reconnect();
      });

      mqConnect.on("close", (e: any) => {
        console.error("RabbitMQ close ", e);
        this.reconnect();
      });
    } catch (e: any) {
      console.error("RabbitMQ connection error ", e);
      await this.reconnect();
    }
    return mqConnect;
  }

  async reconnect() {
    console.log(
      `RabbitMQ try reconnect 3 seconds later,current reconnect count:${this.reconnectCount}`,
    );
    await new Promise(resolve => setTimeout(resolve, 3000));
    this.reconnectCount++;
    await this.initChannel();
    console.log(`${this.connectionName} reconnect success`);
  }

  async publish(ctx: Context, mqList: any[]) {
    const channel: ConfirmChannel = this.ctx.channel;
    for (const tx of mqList) {
      if (new Date(tx.timestamp).valueOf() < bootTime) {
        ctx.logger.warn(
          `RabbitMq publish fail,Tx has expired ${tx.hash} ${getFormatDate(
            tx.timestamp,
          )}`,
        );
        continue;
      }
      const topic = `chaincore:${tx.chainId}`;
      const str = JSON.stringify(tx);
      const res = await channel.publish(
        this.exchangeName,
        String(tx.chainId),
        Buffer.from(str),
        { persistent: true },
      );
      if (res)
        ctx.logger.info(
          `RabbitMq publish success ${topic} ${tx.source} ${tx.hash} ${res}`,
        );
      else
        ctx.logger.error(
          `RabbitMq publish fail ${topic} ${tx.source} ${tx.hash} ${res}`,
        );
    }
  }
}
