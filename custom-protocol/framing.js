const HEAD_END = Buffer.from("\r\n\r\n"); // head end marker: request line + headers
const MAX_HEAD_BYTES = 1024 * 10; // max head bytes: 10KB
const MAX_BODY_BYTES = 1024 * 1024 * 1; // max body bytes: 1MB

// Error class for protocol errors. It has a status code and a message.
class ProtocolError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

class Parser {
  constructor(onMessage) {
    this.onMessage = onMessage;
    this.buffer = Buffer.alloc(0); // bytes received but not yet parsed
    this.state = "HEAD"; // current state: "HEAD" or "BODY". current is "HEAD" while waiting for the head end marker(\r\n\r\n). BODY state is when the head has been parsed and the body is being received.
    this.pending = null; // pending message being parsed. null if no message is being parsed.
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

        const head = this.buffer.subarray(0, headEndIndex).toString("utf8"); // retrieve the head as a string
        this.buffer = this.buffer.subarray(headEndIndex + HEAD_END.length); // remove the head from the buffer
        this.state = "BODY"; // switch to BODY state to receive the body
      }

      if (this.state === "BODY") {
        const needLength = this.pending.length; // the length of the body we need to receive

        if (this.buffer.length < needLength) return; // wait for more bytes

        const body = this.buffer.subarray(0, need); // retrieve the body as a buffer
        this.buffer = this.buffer.subarray(need); // leftovers = start of next message

        const message = {
          startLine: this.pending.startLine,
          headers: this.pending.headers,
          body,
        };
        this.pending = null;
        this.state = "HEAD";
        this.onMessage(message);
      }
    }
  }
}

function parseHead(head) {
  const [startLine, ...headerLines] = head.split("\r\n"); // split the head into start line and header lines
  if (!startLine) throw new ProtocolError("missing start line", 400);

  const headers = {};

  for (const headerLine of headerLines) {
    const colon = line.indexOf(":");
    if (colon <= 0)
      throw new ProtocolError(`bad header line: ${JSON.stringify(line)}`);
    const name = line.slice(0, colon).trim().toLowerCase(); // get the header name and convert it to lowercase
    headers[name] = line.slice(colon + 1).trim(); // get the header value and trim whitespace
  }

  let bodyLength = 0;
  if (headers.contentLength !== undefined) {
    bodyLength = parseInt(headers.contentLength, 10);

    if (bodyLength > MAX_BODY_BYTES)
      throw new ProtocolError("body too large", 413);
  }

  return { startLine, headers, bodyLength };
}

function parseMessage(head, body) {
  const { startLine, headers, bodyLength } = parseHead(head);

  const bodyBuffer = Buffer.isBuffer(body)
    ? body
    : Buffer.from(String(body) || "", "utf8");

  const head = Buffer.from(lines.join("\r\n") + "\r\n\r\n", "utf8");
  return Buffer.concat([head, bodyBytes]);
}

export { Parser, parseMessage, parseHead, ProtocolError };
