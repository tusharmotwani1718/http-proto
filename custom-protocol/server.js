// custom-protocol/tcp-server.js

// A simple TCP server over the net module that enforces the DTP/1 rules.
//
// framing.js splits the byte stream into messages (head + body).
// This file applies the protocol rules: the start line format, the allowed
// actions, status codes, and when to close the connection.
//
// Request start line:   ACTION /key DTP/1        e.g. PUT /name DTP/1
// Response start line:  DTP/1 STATUS REASON      e.g. DTP/1 201 CREATED
// Close after response: send the header  connection: close

import net from "net";
import { Parser, ProtocolError, serialize } from "./framing.js";

const PORT = Number(process.env.PORT) || 4000;
const VERSION = "DTP/1";
const IDLE_TIMEOUT_MS = 30_000;

const REASONS = {
  200: "OK",
  201: "CREATED",
  400: "BAD_REQUEST",
  404: "NOT_FOUND",
  405: "UNKNOWN_ACTION",
  413: "TOO_LARGE",
  500: "SERVER_ERROR",
  505: "BAD_VERSION",
};

const store = new Map(); // key -> Buffer

// Takes a parsed request, returns { status, body }.
// Throws a ProtocolError for anything the client got wrong.
function handleRequest(request) {
  const startLineParts = request.startLine.split(" ");
  if (startLineParts.length !== 3) {
    throw new ProtocolError(
      "start line must be in the format ACTION /KEY DTP/1",
      400,
    );
  }

  const [action, key, version] = startLineParts;

  if (version !== VERSION) {
    throw new ProtocolError(`unsupported version: ${version}`, 505);
  }

  if (!key.startsWith("/")) {
    throw new ProtocolError("key must start with /", 400);
  }

  switch (action) {
    case "GET": {
      if (request.body.length > 0) {
        throw new ProtocolError("GET request can't have a body", 400);
      }
      if (!store.has(key)) {
        throw new ProtocolError(`key not found: ${key}`, 404);
      }
      return { status: 200, body: store.get(key) };
    }
    case "PUT": {
      store.set(key, request.body);
      return { status: 201, body: "created" };
    }
    case "DEL": {
      if (!store.has(key)) {
        throw new ProtocolError(`key not found: ${key}`, 404);
      }
      store.delete(key);
      return { status: 200, body: "deleted" };
    }
    default:
      throw new ProtocolError(`unknown action: ${action}`, 405);
  }
}

// Sends one response. serialize() adds the content-length header for us.
function respond(socket, status, body, headers = {}) {
  socket.write(
    serialize(`${VERSION} ${status} ${REASONS[status]}`, headers, body),
  );
}

const server = net.createServer((socket) => {
  const who = `${socket.remoteAddress}:${socket.remotePort}`;
  console.log(`+ connection from ${who}`);

  let closing = false; // once true, we ignore any further bytes or requests

  const parser = new Parser((request) => {
    // A client may pipeline more requests after one that said "connection: close".
    // We already promised to close, so the rest are ignored.
    if (closing) return;

    const wantsClose = request.headers["connection"] === "close";

    // Application errors (404, 405, ...) are normal responses.
    // The connection stays usable, because framing is still in sync.
    let res;
    try {
      res = handleRequest(request);
    } catch (err) {
      if (err instanceof ProtocolError) {
        res = { status: err.status, body: err.message };
      } else {
        console.error(err);
        res = { status: 500, body: "internal error" };
      }
    }

    console.log(`  ${who}  ${request.startLine} -> ${res.status}`);
    respond(socket, res.status, res.body, wantsClose ? { connection: "close" } : {});

    if (wantsClose) {
      closing = true;
      socket.end();
    }
  });

  socket.on("data", (chunk) => {
    if (closing) return;

    try {
      parser.push(chunk);
    } catch (err) {
      // Only framing errors reach here (bad header, bad content-length, too large).
      // After one, we've lost our place in the byte stream: we no longer know
      // where the next message starts. Reply once, then close.
      const status = err instanceof ProtocolError ? err.status : 500;
      const message = err instanceof ProtocolError ? err.message : "internal error";
      if (!(err instanceof ProtocolError)) console.error(err);

      console.log(`  ${who}  framing error: ${message}`);
      respond(socket, status, message, { connection: "close" });
      closing = true;
      socket.end();
    }
  });

  // Keep-alive, but not forever.
  socket.setTimeout(IDLE_TIMEOUT_MS, () => {
    console.log(`  ${who}  idle for ${IDLE_TIMEOUT_MS / 1000}s, closing`);
    socket.end();
  });

  socket.on("error", (err) => console.log(`  ${who}  socket error: ${err.message}`));
  socket.on("close", () => console.log(`- connection from ${who} closed`));
});

server.listen(PORT, () => console.log(`DTP/1 server listening on port ${PORT}`));