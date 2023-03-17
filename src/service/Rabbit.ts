import { Channel, connect, Connection } from "amqplib";
import { Context } from "../context";
import { Transaction } from "orbiter-chaincore/src/types";
import BigNumber from "bignumber.js";

const makerTxChannel = "chaincore_maker_txlist";
const txQueueName = "chaincore_tx_list";
const txRoutingKeyName = "chaincore_txlist";

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
      const queueName = `chaincore:${chainId}`;
      const routingKey = String(chainId);
      await channel.assertQueue(queueName, {
        durable: true,
      });
      await channel.bindQueue(queueName, this.exchangeName, routingKey);
    }
    this.channels[makerTxChannel] = channel;
    const txChannel = await this.connection.createChannel();
    await txChannel.assertQueue(txQueueName, {
      durable: true,
    });
    this.channels[txRoutingKeyName] = txChannel;
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
    const channel = this.channels[makerTxChannel];
    if (!channel) {
      this.ctx.logger.error(`channel ${makerTxChannel} not found`);
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
  public async publishTxList(msg: any) {
    const channel = this.channels[txRoutingKeyName];
    if (!channel) {
      this.ctx.logger.error(`channel txlist not found`);
      return;
    }
    let hashList: any[] = [];
    try {
      hashList = (<any[]>msg).map(item => {
        return { chainId: item.chainId, hash: item.hash };
      });
    } catch (e) {}
    if (typeof msg === "object") {
      msg = JSON.stringify(msg);
    }
    const result = await channel.sendToQueue(txQueueName, Buffer.from(msg));
    this.ctx.logger.info(`create msg: ${JSON.stringify(hashList)} ${result}`);
  }
  public async subscribe(self: any) {
    const ctx = self.ctx;
    const channel = this.channels[txRoutingKeyName];
    if (!channel) {
      console.log("reconnect channel...");
      setTimeout(() => {
        this.subscribe(self);
      }, 1000);
      return;
    }
    ctx.logger.info(`subscribe ${txRoutingKeyName} channel success`);
    const messageHandle = async (msg: any) => {
      if (msg) {
        try {
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
            ctx.logger.error(`processSubTxList error:`, error);
          });
          ctx.logger.info(
            `consume msg: ${JSON.stringify(
              txList.map(item => {
                return { chainId: item.chainId, hash: item.hash };
              }),
            )}`,
          );
        } catch (e: any) {
          ctx.logger.error(`${msg.content.toString()}  ${e.message}`);
        }
      }
      // ack
      msg && (await channel.ack(msg));
    };
    await channel.consume(txQueueName, messageHandle, {
      noAck: false,
    });
  }
}
