import {
  CreationOptional,
  DataTypes,
  InferCreationAttributes,
  InferAttributes,
  Model,
  Sequelize,
} from "sequelize";
import { Json } from "../types";

export class Transaction extends Model<
  InferAttributes<Transaction>,
  InferCreationAttributes<Transaction>
> {
  declare id: CreationOptional<number>;
  declare hash: string;
  declare nonce: string;
  declare blockHash: string | null;
  declare blockNumber: number | null;
  declare transactionIndex: number | null;
  declare from: string;
  declare to: string;
  declare value: string;
  declare symbol: string;
  declare gasPrice: number | null;
  declare gas: number | null;
  declare input: string | null;
  declare status: number;
  declare tokenAddress: string | null;
  declare timestamp: Date;
  declare fee: string | null;
  declare feeToken: string | null;
  declare chainId: number;
  declare source: string | null;
  declare memo: string | null;
  declare side: number;
  declare makerId: string | null;
  declare transferId: string;
  declare expectValue: string | null;
  declare lpId: string | null;
  declare extra: Json | null;
  declare replyAccount: string | null;
  declare replySender: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  static initModel(sequelize: Sequelize): typeof Transaction {
    return Transaction.init(
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
          comment:
            "status:0=PENDING,1=COMPLETE,2=REJECT,3=MatchFailed,4=refund,5=Timers Not Match,99=MatchSuccess,98=MakerDelayTransfer",
        },
        tokenAddress: {
          type: DataTypes.STRING(255),
          allowNull: false,
          comment: "tokenAddress",
        },
        timestamp: {
          type: DataTypes.DATE,
          allowNull: false,
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
        makerId: {
          type: DataTypes.STRING,
          allowNull: true,
          comment: "maker id",
        },
        transferId: {
          type: DataTypes.STRING(32),
          allowNull: true,
          comment: "transferId",
        },
        expectValue: {
          type: DataTypes.STRING(32),
          allowNull: false,
          defaultValue: "",
          comment: "expectValue",
        },
        lpId: {
          type: DataTypes.STRING,
          allowNull: true,
          comment: "lp id",
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
        createdAt: {
          type: DataTypes.DATE,
        },
        updatedAt: {
          type: DataTypes.DATE,
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
            fields: [{ name: "id" }],
            // fields: [{ name: "id" }, { name: "timestamp" }],
          },
          {
            name: "hash",
            unique: true,
            using: "BTREE",
            fields: [{ name: "hash" }],
            // fields: [{ name: "chainId" }, { name: "hash" }],
          },
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
