#!/usr/bin/env node
import { Socket } from "net";
import { NetUtil } from "./net";
const config: { [key: string]: string } = {};
let pushServerConn: Socket;
export function createNet() {
  try {
    NetUtil.createServer((injectConn: Socket) => {
      injectConn.on("data", (str: string) => {
        const body = JSON.parse(str);
        if (body.op && body.op === "inject") {
          Object.assign(config, body.data);
          injectConn.write(
            JSON.stringify({ op: "inject-success", data: config })
          );
          pushServerConn.write(str);
        }
      });
    }, "injectServer");
    NetUtil.createServer((conn: Socket) => {
      console.log("conn success:", config);
      conn.write(JSON.stringify({ op: "connAfter", data: config }));
      pushServerConn = conn;
    });
  } catch (error) {
    console.log("create net fail");
  }
}
createNet();
