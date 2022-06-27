import path from 'path';
import fs from "fs";
import { Socket, connect, createServer, Server } from "net";
function joinPath(file:string) {
  return path.join(__dirname, '../../','runtime/', file);
}
export class NetUtil {

  static createClient(name: string = "unix") {
    const pipeFile =
      process.platform === "win32"
        ? "\\\\.\\pipe\\mypip"
        : joinPath(`${name}.sock`);
    const client = connect(pipeFile);
    // client.on("connect", () => {
    //   console.info("[Client] MsgNotify Client Connect Success");
    // });
    // client.on("end", () => {
    //   console.error("[Client] MsgNotify Client Disconnected");
    // });
    // client.on("error", (error) => {
    //   console.error("[Client] MsgNotify Client Error", error);
    // });
    return client;
  }
  static async createServer(callback: Function, name: string = 'unix'): Promise<Server> {
    const pipeFile =
      process.platform === "win32"
        ? "\\\\.\\pipe\\mypip"
        :  joinPath(`${name}.sock`);
    try {
      fs.unlinkSync(pipeFile);
    } catch (error) {}

    const server = await createServer((conn: Socket) => {
      // conn.on("close", () => {
      //   console.info("[Server] MsgNotift Server Close");
      // });
      // conn.on("data", (data) => {
      //   callback(conn, data);
      // });
      // conn.on("error", (error) => {
      //   console.error("[Server] MsgNotify Server Error", error);
      // });
      callback(conn);
    });
    server.listen(pipeFile);
    return server;
  }
}
