import { Context } from "../context";
import net from "net";
import { equals } from "orbiter-chaincore/src/utils/core";
import { sleep } from "../utils";
import { chains } from "orbiter-chaincore";
import { logRecord } from "../utils/logger";
export class TCPInject {
  public client: net.Socket;
  constructor(public readonly ctx: Context) {
    this.client = new net.Socket();
    this.client.connect(8001, "127.0.0.1", () => {
      console.log("[Inject-Service] Successfully connected to the server\n");
      this.client.write(
        JSON.stringify({
          op: "subscribe",
          data: "",
        }),
      );
    });
    this.client.on("data", (str: string) => {
      let body: any = {};
      try {
        body = JSON.parse(str);
      } catch (err) {}
      if (body && body.op === "inject") {
        const chain = chains
          .getAllChains()
          .find(row => equals(row.internalId, body.data.key));
        if (!chain) {
          return logRecord(ctx, `Inject Key Not Find Chain Config ${body.data.key}`, false);
        }
        chain.api.key = body.data.value;
      }
    });
    // client.on("end", () => {
    //   console.log("Send Data end");
    // });
    this.client.on("error", error => {
      if ((Date.now() / 1000) * 10 === 0) {
        logRecord(ctx, "sub error:", false, error);
      }
      sleep(1000 * 10)
        .then(() => {
          // subscribeInject(ctx);
        })
        .catch(error => {
          logRecord(ctx, "sleep error:", error);
        });
    });
  }
}
