export default {
  development: {
    dialect: "mysql",
    database: process.env.MYSQL_DB_NAME || "ob",
    username: process.env.MYSQL_DB_USERNAME || "root",
    password: process.env.MYSQL_DB_PASSWORD || "root",
    host: process.env.MYSQL_DB_HOST || "localhost",
    port: Number(process.env.MYSQL_DB_PORT || "3306"),
    timezone: "+00:00",
  },
  test: {
    dialect: "mysql",
    database: process.env.MYSQL_DB_NAME || "ob",
    username: process.env.MYSQL_DB_USERNAME || "root",
    password: process.env.MYSQL_DB_PASSWORD || "root",
    host: process.env.MYSQL_DB_HOST || "localhost",
    port: Number(process.env.MYSQL_DB_PORT || "3306"),
    timezone: "+00:00",
  },
  production: {
    dialect: "mysql",
    database: process.env.MYSQL_DB_NAME,
    username: process.env.MYSQL_DB_USERNAME,
    password: process.env.MYSQL_DB_PASSWORD,
    host: process.env.MYSQL_DB_HOST,
    port: Number(process.env.MYSQL_DB_PORT),
    timezone: "+00:00",
  },
};
