import { Channel, connect, Connection } from "amqplib";
import { Context } from "../context";
import { Transaction } from "orbiter-chaincore/src/types";
import BigNumber from "bignumber.js";

export const mqPrefixMap: any = {
  maker: {
    queueName: "chaincore:",
    routingKey: "",
  },
  transactionData: {
    queueName: "tx:",
    routingKey: "txkey:",
  },
};

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
      durable: true,
    });
    for (const chainId of this.chainsIds) {
      for (const key in mqPrefixMap) {
        const queueNamePrefix: string = mqPrefixMap[key].queueName;
        const routingKeyPrefix: string = mqPrefixMap[key].routingKey;
        const channel = await this.connection.createChannel();
        const queueName = `${queueNamePrefix}${chainId}`;
        const routingKey = `${routingKeyPrefix}${String(chainId)}`;
        await channel.assertQueue(queueName, {
          durable: true,
        });
        await channel.bindQueue(queueName, this.exchangeName, routingKey);
        this.channels[routingKey] = channel;
      }
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
  public async publish(routingKey: string, msg: any) {
    const channel = this.channels[routingKey];
    if (!channel) {
      console.log(`channel ${routingKey} not found`);
      return;
    }
    if (typeof msg === "object") {
      msg.pushTime = Date.now();
      msg = JSON.stringify(msg);
    }
    const result = await channel.publish(
      this.exchangeName,
      routingKey,
      Buffer.from(msg),
    );
    this.ctx.logger.info(`mq send result msg:${msg}, result:${result}`);
  }

  public async subscribe(self: any, chainId: string) {
    const ctx = self.ctx;
    const queueName = `${mqPrefixMap.transactionData.queueName}${chainId}`;
    const routingKey = `${mqPrefixMap.transactionData.routingKey}${chainId}`;
    const channel = this.channels[routingKey];
    if (!channel) {
      console.log("reconnect channel...");
      setTimeout(() => {
        this.subscribe(self, chainId);
      }, 1000);
      return;
    }
    ctx.logger.info(`subscribe channels ${queueName} ${routingKey}`);
    const messageHandle = async (msg: any) => {
      if (msg) {
        const txList = JSON.parse(msg.content.toString()) as Transaction[];
        const result: Transaction[] = [];
        for (const tx of txList) {
          if (
            tx.source == "xvm" &&
            tx?.extra?.xvm?.name === "multicall" &&
            tx?.extra.txList.length
          ) {
            const multicallTxList: any[] = tx.extra.txList;
            result.push(
              ...multicallTxList.map((item, index) => {
                item.fee = new BigNumber(item.fee)
                  .dividedBy(multicallTxList.length)
                  .toFixed(0);
                item.hash = `${item.hash}#${index + 1}`;
                return item;
              }),
            );
          } else {
            result.push(tx);
          }
        }
        await self.processSubTxList(result).catch((error: any) => {
          ctx.logger.error(`${chainId} processSubTxList error:`, error);
        });
      }
      // ack
      msg && (await channel.ack(msg));
    };
    await channel.consume(queueName, messageHandle, { noAck: false });
  }
}
