import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';
import type { maker_transaction, maker_transactionCreationAttributes, maker_transactionId } from './maker_transaction';

export interface transactionAttributes {
  id: number;
  hash: string;
  nonce: string;
  blockHash?: string;
  blockNumber: number;
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
  fee: string;
  feeToken: string;
  chainId: number;
  source?: string;
  memo?: string;
  extra?: object;
  createdAt?: Date;
  updatedAt?: Date;
}

export type transactionPk = "id";
export type transactionId = transaction[transactionPk];
export type transactionOptionalAttributes = "id" | "blockHash" | "transactionIndex" | "gasPrice" | "gas" | "input" | "timestamp" | "source" | "memo" | "extra" | "createdAt" | "updatedAt";
export type transactionCreationAttributes = Optional<transactionAttributes, transactionOptionalAttributes>;

export class transaction extends Model<transactionAttributes, transactionCreationAttributes> implements transactionAttributes {
  id!: number;
  hash!: string;
  nonce!: string;
  blockHash?: string;
  blockNumber!: number;
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
  fee!: string;
  feeToken!: string;
  chainId!: number;
  source?: string;
  memo?: string;
  extra?: object;
  createdAt!: Date;
  updatedAt!: Date;

  // transaction hasOne maker_transaction via inId
  maker_transaction!: maker_transaction;
  getMaker_transaction!: Sequelize.HasOneGetAssociationMixin<maker_transaction>;
  setMaker_transaction!: Sequelize.HasOneSetAssociationMixin<maker_transaction, maker_transactionId>;
  createMaker_transaction!: Sequelize.HasOneCreateAssociationMixin<maker_transaction>;
  // transaction hasOne maker_transaction via outId
  out_maker_transaction!: maker_transaction;
  getOut_maker_transaction!: Sequelize.HasOneGetAssociationMixin<maker_transaction>;
  setOut_maker_transaction!: Sequelize.HasOneSetAssociationMixin<maker_transaction, maker_transactionId>;
  createOut_maker_transaction!: Sequelize.HasOneCreateAssociationMixin<maker_transaction>;

  static initModel(sequelize: Sequelize.Sequelize): typeof transaction {
    return transaction.init({
    id: {
      autoIncrement: true,
      type: DataTypes.BIGINT,
      allowNull: false,
      primaryKey: true,
      comment: "ID"
    },
    hash: {
      type: DataTypes.STRING(255),
      allowNull: false,
      comment: "Hash"
    },
    nonce: {
      type: DataTypes.STRING(20),
      allowNull: false,
      comment: "Nonce"
    },
    blockHash: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: "blockHash"
    },
    blockNumber: {
      type: DataTypes.BIGINT,
      allowNull: false,
      comment: "blockNumber"
    },
    transactionIndex: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: "transactionIndex"
    },
    from: {
      type: DataTypes.STRING(255),
      allowNull: false,
      comment: "from"
    },
    to: {
      type: DataTypes.STRING(255),
      allowNull: false,
      comment: "to"
    },
    value: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "value"
    },
    symbol: {
      type: DataTypes.STRING(20),
      allowNull: false,
      comment: "symbol"
    },
    gasPrice: {
      type: DataTypes.BIGINT,
      allowNull: true,
      comment: "gasPrice"
    },
    gas: {
      type: DataTypes.BIGINT,
      allowNull: true,
      comment: "gas"
    },
    input: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "input"
    },
    status: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      comment: "status:0=PENDING,1=COMPLETE,2=FAIL"
    },
    tokenAddress: {
      type: DataTypes.STRING(255),
      allowNull: false,
      comment: "tokenAddress"
    },
    timestamp: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: Sequelize.Sequelize.literal('CURRENT_TIMESTAMP'),
      comment: "timestamp"
    },
    fee: {
      type: DataTypes.STRING(20),
      allowNull: false,
      comment: "fee"
    },
    feeToken: {
      type: DataTypes.STRING(20),
      allowNull: false,
      comment: "feeToken"
    },
    chainId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: "chainId"
    },
    source: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: "source"
    },
    memo: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: "memo"
    },
    extra: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: "extra"
    }
  }, {
    sequelize,
    tableName: 'transaction',
    timestamps: true,
    indexes: [
      {
        name: "PRIMARY",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "id" },
        ]
      },
      {
        name: "hash",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "chainId" },
          { name: "hash" },
        ]
      },
      {
        name: "symbol",
        using: "BTREE",
        fields: [
          { name: "symbol" },
          { name: "chainId" },
        ]
      },
    ]
  });
  }
}
