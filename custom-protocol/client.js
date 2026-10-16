"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// TTP/1 client. One TCP connection, reused for every request (keep-alive).
//
// Because the spec promises responses come back in the same order requests
// were sent, the client can fire several requests without waiting and just
// match each incoming response to the oldest unanswered request (a FIFO queue).
// ─────────────────────────────────────────────────────────────────────────────

import net from "net";
import { serialize, Parser } from "./framing.js";

const VERSION = "TTP/1";

class Client {
  constructor(port = 4000, host = "localhost") {
    this.waiting = []; // { resolve, reject } for each request still awaiting a response

    this.parser = new Parser((msg) => {
      const [version, code, ...reason] = msg.startLine.split(" ");
      const pending = this.waiting.shift();
      if (!pending) return; // server spoke without being asked — a protocol violation; ignore
      pending.resolve({
        version,
        status: Number(code),
        reason: reason.join(" "),
        headers: msg.headers,
        body: msg.body.toString("utf8"),
      });
    });

    this.socket = net.connect(port, host);
    this.socket.on("data", (chunk) => this.parser.push(chunk));
    this.socket.on("error", (err) => this.failAll(err));
    this.socket.on("close", () => this.failAll(new Error("connection closed")));
  }

  request(action, key, body = "", headers = {}) {
    return new Promise((resolve, reject) => {
      this.waiting.push({ resolve, reject });
      this.socket.write(
        serialize(`${action} ${key} ${VERSION}`, headers, body),
      );
    });
  }

  close() {
    this.socket.end();
  }

  failAll(err) {
    while (this.waiting.length) this.waiting.shift().reject(err);
  }
}

export { Client };
