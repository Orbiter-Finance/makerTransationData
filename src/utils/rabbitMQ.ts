import * as amqp from "amqplib";

interface IRabbitMQConfig {
  url: string;
  reconnectInterval?: number;
}

interface IProducerConfig {
  exchangeName: string;
  exchangeType: "fanout" | "direct" | "topic";
  queueName?: string;
  routingKey?: string;
}

interface IConsumerConfig {
  exchangeName: string;
  exchangeType: "fanout" | "direct" | "topic";
  queueName: string;
  routingKey?: string;
}

export class RabbitMQ {
  private config: IRabbitMQConfig;
  private connection: amqp.Connection | null;
  private channel: amqp.Channel | null;

  constructor(config: IRabbitMQConfig) {
    this.config = {
      ...config,
      reconnectInterval: config.reconnectInterval ?? 5000,
    };
    this.connection = null;
    this.channel = null;
  }

  public connect(): Promise<any> {
    return new Promise((resolve, reject) => {
      if (this.connection) {
        resolve(this.connection);
      }
      amqp
        .connect(this.config.url)
        .then(async connection => {
          console.log(`RabbitMQ connected to ${this.config.url}`);
          this.connection = connection;
          this.connection.on("error", error => {
            console.error(`RabbitMQ connection error: ${error.message}`);
            this.reconnect();
          });
          this.connection.on("close", () => {
            console.warn(`RabbitMQ connection closed`);
            this.reconnect();
          });
          await this.createChannel();
          resolve(this.connection);
        })
        .catch(error => {
          console.error(`Failed to connect to RabbitMQ: ${error.message}`);
          this.reconnect();
          reject(error);
        });
    });
  }

  private createChannel(): Promise<amqp.Channel> {
    return new Promise((resolve, reject) => {
      this.connection
        ?.createChannel()
        .then(channel => {
          console.log(`RabbitMQ channel created`);
          this.channel = channel;
          resolve(channel);
        })
        .catch(error => {
          console.error(`Failed to create RabbitMQ channel: ${error.message}`);
          this.reconnect();
          reject(this.channel);
        });
    });
  }

  private reconnect(): void {
    if (this.connection) {
      this.connection.removeAllListeners();
      this.connection = null;
    }
    if (this.channel) {
      this.channel.removeAllListeners();
      this.channel = null;
    }
    // console.warn(`Reconnecting to RabbitMQ in ${this.config.reconnectInterval / 1000} seconds...`);
    setTimeout(() => this.connect(), this.config.reconnectInterval);
  }

  async disconnect(): Promise<void> {
    await this.channel?.close();
    await this.connection?.close();
  }

  async createProducer(config: IProducerConfig): Promise<Producer> {
    if (!this.channel) {
      await this.createChannel();
    }
    const { exchangeName, exchangeType } = config;
    await this.channel?.assertExchange(exchangeName, exchangeType, {
      durable: true,
    });
    if (!this.channel) {
      throw new Error("channel not found");
    }
    if (config.queueName) {
      const assertQueue = await this.channel?.assertQueue(
        config.queueName || "",
        { durable: true },
      );
      await this.channel?.bindQueue(
        assertQueue?.queue ?? "",
        config.exchangeName,
        config.routingKey || "",
      );
    }

    return new Producer(this.channel, config);
  }
  async bindQueue(config: IProducerConfig) {
    await this.channel?.assertExchange(
      config.exchangeName,
      config.exchangeType,
      { durable: true },
    );
    const assertQueue = await this.channel?.assertQueue(
      config.queueName || "",
      { durable: true },
    );
    await this.channel?.bindQueue(
      assertQueue?.queue ?? "",
      config.exchangeName,
      config.routingKey || "",
    );
    return assertQueue;
  }
  async createConsumer(config: IConsumerConfig): Promise<Consumer> {
    const { exchangeName, exchangeType, queueName, routingKey } = config;
    await this.channel?.assertExchange(exchangeName, exchangeType, {
      durable: true,
    });
    const assertQueue = await this.channel?.assertQueue(queueName, {
      durable: true,
    });
    await this.channel?.bindQueue(
      assertQueue?.queue ?? "",
      exchangeName,
      routingKey || "",
    );
    if (!this.channel) {
      throw new Error("channel not found");
    }
    return new Consumer(this.channel, config);
  }
}
class Consumer {
  private channel: amqp.Channel;
  private exchangeName: string;
  private queueName: string;
  private routingKey: string;

  constructor(channel: amqp.Channel, private readonly config: IConsumerConfig) {
    this.channel = channel;
    this.exchangeName = this.config.exchangeName;
    this.queueName = this.config.queueName || "";
    this.routingKey = this.config.routingKey || "";
  }

  async consume(callback: (message: any) => Promise<boolean>): Promise<void> {
    try {
      await this.channel.assertExchange(
        this.exchangeName,
        this.config.exchangeType,
        { durable: true },
      );
      await this.channel.assertQueue(this.queueName, { durable: true });
      await this.channel.bindQueue(
        this.queueName,
        this.exchangeName,
        this.routingKey,
      );
      console.log(`Waiting for messages from RabbitMQ...`);
      this.channel.prefetch(1, false);
      this.channel.consume(
        this.queueName,
        (message: amqp.ConsumeMessage | null) => {
          if (message !== null) {
            console.log(
              `Received message from RabbitMQ `);
            callback(message.content.toString()).then(result => {
              if (result === true) {
                this.channel.ack(message);
              }
            });
          }
        },
        {
          noAck: false,
        },
      );
    } catch (error) {
      console.error(
        `Failed to consume messages from RabbitMQ: ${(error as Error).message}`,
      );
      throw error;
    }
  }
}

class Producer {
  private channel: amqp.Channel;
  private exchangeName: string;

  constructor(channel: amqp.Channel, private readonly config: IProducerConfig) {
    this.channel = channel;
    this.exchangeName = this.config.exchangeName;
  }

  async publish(message: string | any, routingKey: string): Promise<void> {
    if (typeof message !== "string") {
      message = JSON.stringify(message);
    }
    try {
      await this.channel.publish(
        this.exchangeName,
        routingKey,
        Buffer.from(message),
      );
      console.log(`Sent message to RabbitMQ`);
    } catch (error) {
      console.error(
        `Failed to send message to RabbitMQ: ${(error as Error).message}`,
      );
      throw error;
    }
  }
}
