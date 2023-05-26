import * as winstonX from "orbiter-chaincore/src/packages/winstonX";
import { Context } from "../context";
import path from "path";
export class LoggerService {
  static services: { [key: string]: any } = {};
  static createLogger(key: string, opts?: winstonX.WinstonXOptions) {
    let logDir = path.join(
      process.env.logDir || process.cwd(),
      "runtime",
      "mtx",
      "logs",
    );
    if (key) {
      logDir = path.join(logDir, key);
    }
    opts = Object.assign(
      {
        logDir,
        label: key,
        debug: true,
        // logstash: {
        //     port: process.env["logstash.port"],
        //     level: "info",
        //     node_name: 'maker-client',
        //     host: process.env["logstash.host"],
        // },
        telegram: {
          token: process.env["TELEGRAM_TOKEN"],
          chatId: process.env["TELEGRAM_CHATID"],
        },
      },
      opts,
    );
    const logger = winstonX.createLogger(opts);
    LoggerService.services[key] = logger;
    return logger;
  }
  static getLogger(
    key: string,
    opts?: winstonX.WinstonXOptions,
  ): winstonX.LoggerType {
    return LoggerService.services[key] || LoggerService.createLogger(key, opts);
  }
}

export function logRecord(ctx: Context, msg: any, info: boolean, err?: Error) {
  if(info) {
    ctx.logger.info(msg,err)
    ctx.logstashLogger.info(msg, err)
  } else {
    ctx.logger.error(msg,err)
    ctx.logstashLogger.error(msg, err)
  }
}
