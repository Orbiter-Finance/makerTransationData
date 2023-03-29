import { Sequelize, Options } from "sequelize";
import configs from "./config/config";

const env = process.env.NODE_ENV || "development";

const config = (configs as { [key: string]: Options })[env];
const db: Sequelize = new Sequelize({
  ...config,
  define: {
    underscored: false,
  },
});

db.sync({}).catch(error => {
  console.error("sequelize sync error:", error);
});
db.authenticate()
  .then(() => {
    console.log("Database connection has been established successfully.");
  })
  .catch(error => {
    console.error("Unable to connect to the database:", error);
  });

export default db;
