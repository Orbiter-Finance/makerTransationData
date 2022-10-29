import {
  CreationOptional,
  DataTypes,
  InferCreationAttributes,
  InferAttributes,
  Model,
  Sequelize,
} from "sequelize";
export class MakerTransaction extends Model<
  InferAttributes<MakerTransaction>,
  InferCreationAttributes<MakerTransaction>
> {
  declare id: CreationOptional<number>;
  declare transcationId: string;
  declare inId: number | null;
  declare outId: number | null;
  declare fromChain: number | null;
  declare toChain: number | null;
  declare toAmount: string | null;
  declare replySender: string | null;
  declare replyAccount: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  static initModel(sequelize: Sequelize): typeof MakerTransaction {
    return MakerTransaction.init(
      {
        id: {
          autoIncrement: true,
          type: DataTypes.BIGINT,
          allowNull: false,
          primaryKey: true,
          comment: "ID",
        },
        transcationId: {
          type: DataTypes.STRING(100),
          allowNull: true,
          comment: "transcationId",
          unique: "trxid",
        },
        inId: {
          type: DataTypes.BIGINT,
          allowNull: true,
          comment: "inId",
          unique: "maker_transaction_inId",
        },
        outId: {
          type: DataTypes.BIGINT,
          allowNull: true,
          comment: "outId",
          unique: "maker_transaction_outId",
        },
        fromChain: {
          type: DataTypes.INTEGER,
          allowNull: true,
          comment: "from Chain",
        },
        toChain: {
          type: DataTypes.INTEGER,
          allowNull: true,
          comment: "to Chain",
        },
        toAmount: {
          type: DataTypes.STRING(255),
          allowNull: true,
          comment: "toAmount",
        },
        replySender: {
          type: DataTypes.STRING(255),
          allowNull: true,
          comment: "maker Sender Address",
        },
        replyAccount: {
          type: DataTypes.STRING(255),
          allowNull: true,
          comment: "reply user Recipient",
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
        tableName: "maker_transaction",
        timestamps: true,
        indexes: [
          {
            name: "PRIMARY",
            unique: true,
            using: "BTREE",
            fields: [{ name: "id" }],
          },
          {
            name: "trxid",
            unique: true,
            using: "BTREE",
            fields: [{ name: "transcationId" }],
          },
          {
            name: "maker_transaction_inId",
            unique: true,
            using: "BTREE",
            fields: [{ name: "inId" }],
          },
          {
            name: "maker_transaction_outId",
            unique: true,
            using: "BTREE",
            fields: [{ name: "outId" }],
          },
          {
            name: "replySender",
            using: "BTREE",
            fields: [{ name: "replySender" }],
          },
        ],
      },
    );
  }
}
