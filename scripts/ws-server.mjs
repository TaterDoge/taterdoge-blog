// 简易 WebSocket 接收端：浏览器登录态页面把 Markdown 经 WS 发到本地
// 用法: node scripts/ws-server.mjs <port> <outdir>
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const port = Number(process.argv[2] || 17320);
const outDir = path.resolve(process.argv[3] || ".scraped");
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const server = createServer((req, res) => {
  res.writeHead(404, { "Access-Control-Allow-Private-Network": "true" });
  res.end("ws only");
});

server.on("upgrade", (req, socket) => {
  const key = req.headers["sec-websocket-key"];
  if (!key) return socket.destroy();
  const accept = createHash("sha1")
    .update(key + GUID)
    .digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      "Sec-WebSocket-Accept: " +
      accept +
      "\r\n" +
      "Access-Control-Allow-Private-Network: true\r\n\r\n",
  );
  let buf = Buffer.alloc(0);

  const save = async (payload) => {
    try {
      const data = JSON.parse(payload);
      if (!data.path || typeof data.md !== "string")
        throw new Error("bad payload");
      const safe = String(data.path)
        .replace(/^\/+|\/+$/g, "")
        .replace(/[\\/:*?"<>|]/g, "_");
      await mkdir(outDir, { recursive: true });
      await writeFile(path.join(outDir, `${safe}.md`), data.md, "utf8");
      socket.write(encodeFrame(Buffer.from("ok " + data.md.length)));
      console.log(`saved ${safe} (${data.md.length})`);
    } catch (e) {
      socket.write(encodeFrame(Buffer.from("err " + String(e))));
    }
  };

  socket.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const b0 = buf[0];
      const fin = b0 & 0x80;
      const opcode = b0 & 0x0f;
      const b1 = buf[1];
      const masked = b1 & 0x80;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        len = Number(buf.readBigUInt64BE(2));
        off = 10;
      }
      let mask;
      if (masked) {
        if (buf.length < off + 4) return;
        mask = buf.subarray(off, off + 4);
        off += 4;
      }
      if (buf.length < off + len) return;
      let payload = buf.subarray(off, off + len);
      if (masked) {
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      }
      buf = buf.subarray(off + len);
      if (opcode === 0x8) return socket.destroy(); // close
      if (opcode === 0x9) {
        socket.write(encodeFrame(payload, 0xa));
        continue;
      } // ping->pong
      if (opcode === 0x1 || opcode === 0x2) void save(payload.toString("utf8")); // text/binary
    }
  });
  socket.on("error", () => socket.destroy());
});

function encodeFrame(payload, opcode = 0x1) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

server.listen(port, "127.0.0.1", () => {
  console.log(`ws server on ws://127.0.0.1:${port} -> ${outDir}`);
});
