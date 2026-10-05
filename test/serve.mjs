// Local stand-in for Cloudflare Pages: static files from public/ + /api/* through the Pages function.
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { onRequest } from "../functions/api/[[path]].js";
const sql = new DatabaseSync(":memory:");
const norm = (v) => (v instanceof ArrayBuffer ? new Uint8Array(v) : v === undefined ? null : v);
const out = (row) => row && Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Uint8Array ? Array.from(v) : v]));
const stmt = (q, args = []) => ({ bind: (...a) => stmt(q, a.map(norm)), first: async () => out(sql.prepare(q).get(...args)) ?? null, all: async () => ({ results: sql.prepare(q).all(...args).map(out) }), run: async () => ({ meta: { changes: sql.prepare(q).run(...args).changes } }) });
const env = { DB: { prepare: (q) => stmt(q), batch: async (l) => Promise.all(l.map((s) => s.run())) }, HP_ADMIN_EMAILS: "boss@hp.com", HP_INVITE_CODE: "HP2026" };
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost:8788");
  if (url.pathname.startsWith("/api/")) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const r = await onRequest({ request: new Request("https://localhost:8788" + req.url, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body }), env, waitUntil: () => {} });
    const h = Object.fromEntries(r.headers); if (h["set-cookie"]) h["set-cookie"] = h["set-cookie"].replace("; Secure", "");
    res.writeHead(r.status, h); res.end(Buffer.from(await r.arrayBuffer())); return;
  }
  let f = path.join("public", url.pathname === "/" ? "index.html" : url.pathname);
  if (!fs.existsSync(f)) f = "public/index.html";
  res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
}).listen(8788, () => console.log("on 8788"));
