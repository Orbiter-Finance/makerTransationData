const net = require("net");
const subscribes = [];
const pushData = {};
const server = net.createServer(function (socket) {
  socket.name = "client:"+Date.now();
  socket.on("data", function (data) {
    // const readSize = socket.bytesRead;
    let body = data.toString();
    try {
      body = JSON.parse(data.toString());
    } catch (error) {}
    if (body && body.op === "subscribe") {
      subscribes.push(socket);
      socket.write(
        JSON.stringify({ op: "message", data: "Subscribe Success" })
      );
    }
    if (typeof body === "object" && body.op === "inject") {
      Object.assign(pushData, body.data);
    }
    socket.write(JSON.stringify({op:"message", data: "Receive Inject Success"}))
  });
  socket.on("close", function () {
    const index = subscribes.find(client => client.name === socket.name);
    subscribes.splice(index, 1);
    console.log("server closed!");
  });
  socket.on("error", function (err) {
    console.error("error", err);
})
});

server.listen(8001, function () {
  console.log("Start Server Success");
  setInterval(() => {
    if (subscribes.length > 0 && Object.keys(pushData).length>0) {
      subscribes.forEach((client) => {
        console.debug('Send Inject Config To:', client.name)
        client.write(JSON.stringify({ op: "inject", data: pushData }));
      });
    }
  }, 2000);
});
