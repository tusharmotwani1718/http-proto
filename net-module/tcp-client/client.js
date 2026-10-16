import net from "net";

const client = net.createConnection(
  {
    port: 3000,
    host: "localhost",
  },
  () => {
    console.log("Connected to the TCP server");

    client.write("Hello, server! This is the TCP client.");
  },
);

// encoding is to utf8 so that we can receive string data from the server
client.setEncoding("utf8");

// handle data received from the server
client.on("data", (data) => {
  console.log(`Received data from server: ${data}`);
});

client.on("end", () => {
  console.log("Disconnected from the TCP server");
});

client.on("error", (err) => {
  console.error(`Client error: ${err}`);
});
