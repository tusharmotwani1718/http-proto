// custom-protocol/framing.js

// Framing turns a continuous stream of TCP bytes into separate messages.
// A DTP message looks like:
//
//   START LINE\r\n
//   header-name: value\r\n
//   header-name: value\r\n
//   \r\n                      <- blank line: end of the head
//   <body: exactly content-length bytes>

const HEAD_END = Buffer.from("\r\n\r\n"); // blank line that ends the head (start line + headers)
const MAX_HEAD_BYTES = 1024 * 10; // max head size: 10KB
const MAX_BODY_BYTES = 1024 * 1024 * 1; // max body size: 1MB

// Error class for protocol errors. It carries a status code and a message.
class ProtocolError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "ProtocolError";
    this.status = status;
  }
}

class Parser {
  constructor(onMessage) {
    this.onMessage = onMessage;
    this.buffer = Buffer.alloc(0); // bytes received but not yet parsed
    this.state = "HEAD"; // "HEAD": waiting for the blank line. "BODY": head parsed, waiting for the body bytes.
    this.pending = null; // { startLine, headers, bodyLength } of the message being parsed, or null
  }

  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    // One chunk can hold zero, one, or several messages (or pieces of them),
    // so keep extracting until we run out of complete data.
    while (true) {
      if (this.state === "HEAD") {
        const headEndIndex = this.buffer.indexOf(HEAD_END);

        if (headEndIndex === -1) {
          // No complete head yet. Guard against someone sending headers forever.
          if (this.buffer.length > MAX_HEAD_BYTES)
            throw new ProtocolError("head too large", 413);
          return; // wait for more bytes
        }

        if (headEndIndex > MAX_HEAD_BYTES) {
          throw new ProtocolError("head too large", 413);
        }

        const head = this.buffer.subarray(0, headEndIndex).toString("utf8");
        this.buffer = this.buffer.subarray(headEndIndex + HEAD_END.length); // drop the head from the buffer

        this.pending = parseHead(head); // { startLine, headers, bodyLength }
        this.state = "BODY";
      }

      if (this.state === "BODY") {
        const { startLine, headers, bodyLength } = this.pending;

        if (this.buffer.length < bodyLength) return; // wait for more bytes

        // Buffer.from() copies the bytes, so a stored body doesn't keep the
        // whole receive buffer alive in memory.
        const body = Buffer.from(this.buffer.subarray(0, bodyLength));

        // Whatever is left after the body is NOT thrown away:
        // it is the start of the next message.
        this.buffer = this.buffer.subarray(bodyLength);

        this.pending = null;
        this.state = "HEAD";
        this.onMessage({ startLine, headers, body });
      }
    }
  }
}

function parseHead(head) {
  const [startLine, ...headerLines] = head.split("\r\n"); // first line is the start line, the rest are headers
  if (!startLine) throw new ProtocolError("missing start line", 400);

  const headers = {};

  for (const headerLine of headerLines) {
    const colon = headerLine.indexOf(":");
    if (colon <= 0)
      throw new ProtocolError(`bad header line: ${JSON.stringify(headerLine)}`);

    const name = headerLine.slice(0, colon).trim().toLowerCase(); // header names are case-insensitive
    const value = headerLine.slice(colon + 1).trim();

    // Two different content-length values would let two machines disagree on
    // where the body ends (the root of request smuggling), so reject it.
    if (name === "content-length" && name in headers)
      throw new ProtocolError("duplicate content-length header", 400);

    headers[name] = value;
  }

  let bodyLength = 0;
  if (headers["content-length"] !== undefined) {
    // Only plain digits: rejects "-5", "abc", "10abc", "1e3", etc.
    if (!/^\d+$/.test(headers["content-length"]))
      throw new ProtocolError("invalid content-length", 400);

    bodyLength = Number(headers["content-length"]);

    if (bodyLength > MAX_BODY_BYTES)
      throw new ProtocolError("body too large", 413);
  }

  return { startLine, headers, bodyLength };
}

// Builds the bytes for a message: start line, headers, blank line, body.
// content-length is always calculated here, so callers can't get it wrong.
function serialize(startLine, headers = {}, body = "") {
  const bodyBuffer = Buffer.isBuffer(body)
    ? body
    : Buffer.from(String(body ?? ""), "utf8");

  const lines = [startLine];

  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === "content-length") continue; // we set this ourselves below

    // A \r or \n inside a header would let someone inject extra headers or
    // end the head early, so refuse to send it.
    if (/[\r\n]/.test(`${name}${value}`))
      throw new Error(`header ${name} contains a line break`);

    lines.push(`${name}: ${value}`);
  }

  lines.push(`content-length: ${bodyBuffer.length}`); // length in BYTES, not characters

  const head = Buffer.from(lines.join("\r\n") + "\r\n\r\n", "utf8");
  return Buffer.concat([head, bodyBuffer]);
}

export { Parser, parseHead, serialize, ProtocolError };