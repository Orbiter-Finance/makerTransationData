import * as Sequelize from "sequelize";
import { DataTypes, Model, Optional } from "sequelize";

export interface transactionAttributes {
  id: number;
  hash: string;
  nonce: string;
  blockHash?: string;
  blockNumber?: number;
  transactionIndex?: number;
  from: string;
  to: string;
  value: string;
  symbol: string;
  gasPrice?: number;
  gas?: number;
  input?: string;
  status: number;
  tokenAddress: string;
  timestamp: Date;
  fee?: string;
  feeToken?: string;
  chainId: number;
  source?: string;
  memo?: string;
  extra?: object;
  side?: number;
  createdAt?: Date;
  updatedAt?: Date;
  replyAccount?: string;
  replySender?: string;
}

export type transactionPk = "id" | "timestamp";
export type transactionId = transaction[transactionPk];
export type transactionOptionalAttributes =
  | "id"
  | "blockHash"
  | "blockNumber"
  | "transactionIndex"
  | "gasPrice"
  | "gas"
  | "input"
  | "timestamp"
  | "fee"
  | "feeToken"
  | "source"
  | "memo"
  | "extra"
  | "side"
  | "createdAt"
  | "updatedAt"
  | "replyAccount"
  | "replySender";
export type transactionCreationAttributes = Optional<
  transactionAttributes,
  transactionOptionalAttributes
>;

export class transaction
  extends Model<transactionAttributes, transactionCreationAttributes>
  implements transactionAttributes
{
  id!: number;
  hash!: string;
  nonce!: string;
  blockHash?: string;
  blockNumber?: number;
  transactionIndex?: number;
  from!: string;
  to!: string;
  value!: string;
  symbol!: string;
  gasPrice?: number;
  gas?: number;
  input?: string;
  status!: number;
  tokenAddress!: string;
  timestamp!: Date;
  fee?: string;
  feeToken?: string;
  chainId!: number;
  side!: number;
  source?: string;
  memo?: string;
  extra?: object;
  createdAt!: Date;
  updatedAt!: Date;
  replyAccount?: string;
  replySender?: string;

  static initModel(sequelize: Sequelize.Sequelize): typeof transaction {
    return transaction.init(
      {
        id: {
          autoIncrement: true,
          type: DataTypes.BIGINT,
          allowNull: false,
          primaryKey: true,
          comment: "ID",
        },
        hash: {
          type: DataTypes.STRING(255),
          allowNull: false,
          comment: "Hash",
        },
        nonce: {
          type: DataTypes.STRING(20),
          allowNull: false,
          comment: "Nonce",
        },
        blockHash: {
          type: DataTypes.STRING(255),
          allowNull: true,
          comment: "blockHash",
        },
        blockNumber: {
          type: DataTypes.BIGINT,
          allowNull: true,
          comment: "blockNumber",
        },
        transactionIndex: {
          type: DataTypes.INTEGER,
          allowNull: true,
          comment: "transactionIndex",
        },
        from: {
          type: DataTypes.STRING(255),
          allowNull: false,
          comment: "from",
        },
        to: {
          type: DataTypes.STRING(255),
          allowNull: false,
          comment: "to",
        },
        value: {
          type: DataTypes.STRING(32),
          allowNull: false,
          comment: "value",
        },
        symbol: {
          type: DataTypes.STRING(20),
          allowNull: false,
          comment: "symbol",
        },
        gasPrice: {
          type: DataTypes.BIGINT,
          allowNull: true,
          comment: "gasPrice",
        },
        gas: {
          type: DataTypes.BIGINT,
          allowNull: true,
          comment: "gas",
        },
        input: {
          type: DataTypes.TEXT,
          allowNull: true,
          comment: "input",
        },
        status: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          comment: "status:0=PENDING,1=COMPLETE,2=FAIL",
        },
        tokenAddress: {
          type: DataTypes.STRING(255),
          allowNull: false,
          comment: "tokenAddress",
        },
        timestamp: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: Sequelize.Sequelize.literal("CURRENT_TIMESTAMP"),
          primaryKey: true,
          comment: "timestamp",
        },
        fee: {
          type: DataTypes.STRING(20),
          allowNull: true,
          comment: "fee",
        },
        feeToken: {
          type: DataTypes.STRING(20),
          allowNull: true,
          comment: "feeToken",
        },
        chainId: {
          type: DataTypes.INTEGER,
          allowNull: false,
          comment: "chainId",
        },
        source: {
          type: DataTypes.STRING(20),
          allowNull: true,
          comment: "source",
        },
        memo: {
          type: DataTypes.STRING(50),
          allowNull: true,
          comment: "memo",
        },
        side: {
          type: DataTypes.TINYINT,
          allowNull: false,
          comment: "side:0=user,1=maker",
        },
        extra: {
          type: DataTypes.JSON,
          allowNull: true,
          comment: "extra",
        },
        replyAccount: {
          type: DataTypes.STRING(255),
          allowNull: true,
        },
        replySender: {
          type: DataTypes.STRING(255),
          allowNull: true,
        },
      },
      {
        sequelize,
        tableName: "transaction",
        timestamps: true,
        indexes: [
          {
            name: "PRIMARY",
            unique: true,
            using: "BTREE",
            fields: [{ name: "id" }, { name: "timestamp" }],
          },
          // {
          //   name: "hash",
          //   unique: true,
          //   using: "BTREE",
          //   fields: [{ name: "chainId" }, { name: "hash" }],
          // },
          {
            name: "symbol",
            using: "BTREE",
            fields: [
              { name: "replySender" },
              { name: "chainId" },
              { name: "symbol" },
            ],
          },
        ],
      },
    );
  }
}
