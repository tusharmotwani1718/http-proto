# TTP/1 — Tiny Transfer Protocol

A small text protocol over TCP, modelled on HTTP/1.1. The "application" is a
key-value store: clients store, fetch and delete values by key.

Default port: **4000**.

---

## 1. Message format

Every message (request or response) has the same shape:

```
<start line>\r\n
<Header-Name>: <value>\r\n
<Header-Name>: <value>\r\n
\r\n
<body: exactly Length bytes>
```

- Lines end with `\r\n` (CRLF).
- The head (start line + headers) ends at the first empty line, i.e. the byte
  sequence `\r\n\r\n`.
- Header names are case-insensitive. Values are trimmed of surrounding spaces.
- Header names and values must not contain `\r` or `\n`.

### Request start line

```
<ACTION> <key> TTP/1
```

`key` must start with `/` and contain no spaces. Example: `GET /users/42 TTP/1`

### Response start line

```
TTP/1 <status code> <reason>
```

Example: `TTP/1 404 NOT_FOUND`

---

## 2. Framing rules (where a message ends)

1. Read bytes until `\r\n\r\n`. Everything before it is the head.
2. The `Length` header gives the body size **in bytes** (not characters).
   If `Length` is missing, the body is empty (0 bytes).
3. Read exactly `Length` bytes after the head. That is the body.
4. Any bytes after that belong to the **next** message on the connection.

Senders must always set `Length` correctly when there is a body.

---

## 3. Actions

| Action | Body          | Meaning                       | Success                   |
| ------ | ------------- | ----------------------------- | ------------------------- |
| `GET`  | none          | Fetch the value stored at key | `200` + value             |
| `PUT`  | the new value | Create or replace the value   | `201` new, `200` replaced |
| `DEL`  | none          | Delete the key                | `200`                     |

---

## 4. Status codes

| Code | Reason         | When                                    |
| ---- | -------------- | --------------------------------------- |
| 200  | OK             | Success                                 |
| 201  | CREATED        | `PUT` created a new key                 |
| 400  | BAD_REQUEST    | Malformed message or start line         |
| 404  | NOT_FOUND      | `GET`/`DEL` on a key that doesn't exist |
| 405  | UNKNOWN_ACTION | Action is not GET, PUT or DEL           |
| 413  | TOO_LARGE      | Head over 8 KB or body over 1 MB        |
| 505  | BAD_VERSION    | Version is not `TTP/1`                  |

---

## 5. Connection rules

1. The client always speaks first. The server never sends unprompted.
2. Every request gets exactly one response, in the same order the requests
   were sent. (So a client may send several requests without waiting —
   pipelining — and match responses by order.)
3. The connection stays open after a response (keep-alive), so it can carry
   many requests.
4. It closes when:
   - the client sends `Connection: close` (the server replies, then closes),
   - it has been idle for 30 seconds,
   - the server hits a framing error (see 6).
5. Each request is independent. The server keeps no per-connection state.

---

## 6. Errors

If the server cannot parse a message, it no longer knows where the next
message begins in the byte stream. It therefore sends one error response with
`Connection: close` and then closes the connection.

---

## 7. Example exchange

```
→ PUT /greeting TTP/1\r\n
→ Length: 5\r\n
→ \r\n
→ hello

← TTP/1 201 CREATED\r\n
← Length: 0\r\n
← \r\n

→ GET /greeting TTP/1\r\n
→ \r\n

← TTP/1 200 OK\r\n
← Length: 5\r\n
← \r\n
← hello
```
