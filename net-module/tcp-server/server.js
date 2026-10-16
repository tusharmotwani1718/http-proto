import net from "net";

// tcp server:

const server = net.createServer((socket) => {
  console.log("Client connected");

  // encoding is to utf8 so that we can receive string data from the client
  socket.setEncoding("utf8");

  socket.on("data", (data) => {
    console.log(`Received data from client: ${data}`);

    socket.write(`Echo: ${data}`);
  });

  socket.on("end", () => {
    console.log("Client disconnected");
  });

  socket.on("error", (err) => {
    console.error(`Socket error: ${err}`);
  });

  socket.write("Welcome to the TCP server!\n");
});

server.listen(3000, () => {
  console.log("TCP server listening on port 3000");
});

server.on("error", (err) => {
  console.error(`Server error: ${err}`);
});
