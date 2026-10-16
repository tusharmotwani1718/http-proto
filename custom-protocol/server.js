// This implements a simple TCP server over net module which enforces a set of rules over the data that can be received from the client.

// Framing does the part of checking the content length, dividing the data into head and body, and parsing the head into start line and headers. The server enforces the rules of the protocol, like getting the data in a particular format, and responding with appropriate status codes and messages.

import net from "net";
import { Parser, ProtocolError, parseHead, parseMessage } from "./framing.js";
import { serialize } from "v8";

const PORT = Number(process.env.PORT) || 4000;
const VERSION = "TTP/1";
const IDLE_TIMEOUT_MS = 30_000;

const REASONS = {
  200: "OK",
  201: "CREATED",
  400: "BAD_REQUEST",
  404: "NOT_FOUND",
  405: "UNKNOWN_ACTION",
  413: "TOO_LARGE",
  505: "BAD_VERSION",
};

const store = new Map();

function handleRequest(request) {
  const startLineParts = request.startLine.split(" ");
  if (startLineParts.length !== 3) {
    throw new ProtocolError(
      `Start line must be in the format ACTION /KEY TTP/1`,
    );
  }

  const [action, key, version] = startLineParts;

  if (version !== VERSION) {
    throw new ProtocolError(`Unsupported version: ${version}`, 505);
  }

  switch (action) {
    case "GET": {
      if (!store.has(key)) {
        throw new ProtocolError(`Key not found: ${key}`, 404);
      }

      if (request.body) {
        throw new ProtocolError(
          `request body can't be sent with GET request`,
          400,
        );
      }

      const value = store.get(key);
      return { status: 200, body: value };
    }
    case "PUT": {
      store.set(key, request.body);
      return { status: 201, body: Buffer.from("Created") };
    }
    case "DEL": {
      if (!store.has(key)) {
        throw new ProtocolError(`Key not found: ${key}`, 404);
      }
      const value = store.delete(key);
      return { status: 200, body: value };
    }
    default:
      throw new ProtocolError(`Unknown action: ${action}`, 405);
  }
}

// Respond to the client with the given status, headers
function respond(socket, status, headers, body) {
  socket.write(
    serialize(`${VERSION} ${status} ${REASONS[status]}`, headers, body),
  );

  // close the connection after sending the response if the client requested it with header
  if (headers["closeConnection"] === "true") {
    socket.write(`closeConnection: true\r\n`);
    socket.end();
  }
}

// Create a TCP server that listens for incoming connections and handles requests according to the custom protocol.
const server = net.createServer((socket) => {
  console.log("Client connected");

  const parser = new Parser((request) => {
    const res = handleRequest(request);
    respond(socket, res.status, headers, res.body);
  });

  socket.on("data", (dataChunk) => {
    try {
      parser.push(dataChunk);
    } catch (err) {
      if (!(err instanceof ProtocolError)) throw err;
      // After a framing error we've lost our place in the byte stream: we no
      // longer know where the next message starts. Reply once, then close.
      console.log(`  ${who}  protocol error: ${err.message}`);
      respond(socket, err.status, { Connection: "close" }, err.message);
      socket.end();
    }
  });

  // Keep-alive, but not forever.
  socket.setTimeout(IDLE_TIMEOUT_MS, () => {
    console.log(`  ${who}  idle for ${IDLE_TIMEOUT_MS / 1000}s, closing`);
    socket.end();
  });

  socket.on("error", (err) =>
    console.log(`  ${who}  socket error: ${err.message}`),
  );
  socket.on("close", () => console.log(`- connection from ${who} closed`));
});

server.listen(PORT, () =>
  console.log(`TTP/1 server listening on port ${PORT}`),
);
