const net = require("net");
const prompt = require("prompt");
const client = new net.Socket();
client.connect(8001, "127.0.0.1", function () {
  console.log(
    `Successfully connected to the ${client.remoteAddress}:${client.remotePort} server\n`,
  );
  prompt.start();
  prompt.get(["DydxApiKey"], function (err, result) {
    if (err) {
      console.error(err.message);
      return;
    }
    client.write(
      JSON.stringify({
        op: "inject",
        data: { key: "11", value: result["DydxApiKey"] },
      }),
    );
  });
});
client.on("data", function (data) {
  console.log(`\nServer Response:` + data.toString());
});
client.on("end", function () {
  console.log("Send Data end");
});
