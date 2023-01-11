import type { Sequelize } from "sequelize";
import { Transaction } from "./Transactions";
import { MakerTransaction } from "./MakerTransaction";
export { Transaction, MakerTransaction };
export function initModels(sequelize: Sequelize) {
  MakerTransaction.initModel(sequelize);
  Transaction.initModel(sequelize);
  MakerTransaction.belongsTo(Transaction, { as: "in", foreignKey: "inId" });
  Transaction.hasOne(MakerTransaction, {
    as: "maker_transaction",
    foreignKey: "inId",
  });
  MakerTransaction.belongsTo(Transaction, { as: "out", foreignKey: "outId" });
  Transaction.hasOne(MakerTransaction, {
    as: "out_maker_transaction",
    foreignKey: "outId",
  });
  return {
    sequelize,
    Transaction,
    MakerTransaction,
  };
}
