import type { Sequelize } from "sequelize";
import { maker_transaction as _maker_transaction } from "./maker_transaction";
import type { maker_transactionAttributes, maker_transactionCreationAttributes } from "./maker_transaction";
import { transaction as _transaction } from "./transaction";
import type { transactionAttributes, transactionCreationAttributes } from "./transaction";

export {
  _maker_transaction as maker_transaction,
  _transaction as transaction,
};

export type {
  maker_transactionAttributes,
  maker_transactionCreationAttributes,
  transactionAttributes,
  transactionCreationAttributes,
};

export function initModels(sequelize: Sequelize) {
  const maker_transaction = _maker_transaction.initModel(sequelize);
  const transaction = _transaction.initModel(sequelize);

  maker_transaction.belongsTo(transaction, { as: "in", foreignKey: "inId"});
  transaction.hasOne(maker_transaction, { as: "maker_transaction", foreignKey: "inId"});
  maker_transaction.belongsTo(transaction, { as: "out", foreignKey: "outId"});
  transaction.hasOne(maker_transaction, { as: "out_maker_transaction", foreignKey: "outId"});

  return {
    maker_transaction: maker_transaction,
    transaction: transaction,
  };
}
