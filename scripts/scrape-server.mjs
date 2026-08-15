// 临时抓取接收服务：浏览器登录态页面把转好的 Markdown POST 到这里
// 用法: node scripts/scrape-server.mjs <port> <outdir>
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const port = Number(process.argv[2] || 17319);
const outDir = path.resolve(process.argv[3] || ".scraped");

const server = createServer(async (req, res) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Private-Network": "true",
  };
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }
  if (req.method === "GET" && req.url?.startsWith("/save?")) {
    try {
      const u = new URL(req.url, "http://localhost");
      const p = u.searchParams.get("path") || "";
      const md = u.searchParams.get("md") || "";
      const safe = p.replace(/^\/+|\/+$/g, "").replace(/[\\/:*?"<>|]/g, "_");
      await mkdir(outDir, { recursive: true });
      await writeFile(path.join(outDir, `${safe}.md`), md, "utf8");
      res.writeHead(200, { ...cors, "Content-Type": "text/plain" });
      res.end(`ok ${md.length}`);
    } catch (e) {
      res.writeHead(400, { ...cors, "Content-Type": "text/plain" });
      res.end("err " + String(e));
    }
    return;
  }
  if (req.method !== "POST" || req.url !== "/save") {
    res.writeHead(404, cors);
    res.end("not found");
    return;
  }
  let body = "";
  for await (const chunk of req) body += chunk;
  try {
    const data = JSON.parse(body);
    if (!data.path || typeof data.md !== "string")
      throw new Error("bad payload");
    const safe = data.path
      .replace(/^\/+|\/+$/g, "")
      .replace(/[\\/:*?"<>|]/g, "_");
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, `${safe}.md`), data.md, "utf8");
    res.writeHead(200, { ...cors, "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, file: safe, len: data.md.length }));
  } catch (e) {
    res.writeHead(400, { ...cors, "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: String(e) }));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`scrape server on http://127.0.0.1:${port} -> ${outDir}`);
});
