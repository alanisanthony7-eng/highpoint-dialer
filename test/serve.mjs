// Local stand-in for Cloudflare Pages: static files from public/ + /api/* through the Pages function.
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { onRequest } from "../functions/api/[[path]].js";
const root = process.cwd(), localDir = path.join(root, ".local");
for (const name of [".dev.vars", ".env"]) {
  const file = path.join(root, name);
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim(); if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("="); if (i < 1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[k] == null) process.env[k] = v;
  }
}
const dbPath = path.resolve(process.env.HP_LOCAL_DB || path.join(localDir, "highpoint.sqlite"));
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const sql = new DatabaseSync(dbPath);
sql.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
const norm = (v) => (v instanceof ArrayBuffer ? new Uint8Array(v) : v === undefined ? null : v);
const out = (row) => row && Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Uint8Array ? Array.from(v) : v]));
const stmt = (q, args = []) => ({ bind: (...a) => stmt(q, a.map(norm)), first: async () => out(sql.prepare(q).get(...args)) ?? null, all: async () => ({ results: sql.prepare(q).all(...args).map(out) }), run: async () => ({ meta: { changes: sql.prepare(q).run(...args).changes } }) });
const pass = (...keys) => Object.fromEntries(keys.filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
const env = {
  DB: { prepare: (q) => stmt(q), batch: async (l) => Promise.all(l.map((s) => s.run())) },
  HP_ADMIN_EMAILS: process.env.HP_ADMIN_EMAILS || "alanisanthony7@gmail.com,boss@hp.com",
  HP_INVITE_CODE: process.env.HP_INVITE_CODE || "HP2026",
  ...pass(
    "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET",
    "SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET",
    "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TELNYX_API_KEY",
    "RESEND_API_KEY", "HP_EMAIL_FROM", "ANTHROPIC_API_KEY",
    "HP_CRON_SECRET", "HP_PUBLIC_URL", "HP_SNAP_CLIENT_ID"
  ),
};
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon" };
const host = process.env.HOST || "127.0.0.1", fixedPort = process.env.PORT != null;
let port = Number(process.env.PORT || 8788), tries = 0;
const server = http.createServer(async (req, res) => {
  const origin = `http://${host}:${port}`;
  const url = new URL(req.url, origin);
  if (url.pathname.startsWith("/api/")) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const r = await onRequest({ request: new Request(origin + req.url, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body }), env, waitUntil: () => {} });
    const h = Object.fromEntries(r.headers); if (h["set-cookie"]) h["set-cookie"] = h["set-cookie"].replace("; Secure", "");
    res.writeHead(r.status, h); res.end(Buffer.from(await r.arrayBuffer())); return;
  }
  let f = path.join(root, "public", url.pathname === "/" ? "index.html" : /^\/book(\/|$)/.test(url.pathname) ? "booking.html" : /^\/q(\/|$)/.test(url.pathname) ? "quote.html" : url.pathname.replace(/^\/+/, ""));
  if (!f.startsWith(path.join(root, "public")) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(root, "public", "index.html");
  res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
});

async function seed() {
  if (!(process.argv.includes("--seed") || process.env.HP_DEV_SEED === "1")) return;
  const email = process.env.HP_DEV_EMAIL || "boss@hp.com", password = process.env.HP_DEV_PASSWORD || "password2", name = process.env.HP_DEV_NAME || "Local Admin";
  const request = new Request(`http://${host}:${port}/api/auth/signup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, email, password, agree: true }) });
  const response = await onRequest({ request, env, waitUntil: () => {} });
  if (response.ok || response.status === 409) console.log(`Dev login: ${email} / ${password}`);
  else console.warn("Dev seed failed:", await response.text());
}
server.on("error", (e) => {
  if (e.code === "EADDRINUSE" && !fixedPort && tries++ < 20) { port++; server.listen(port, host); return; }
  console.error(e); process.exitCode = 1;
});
server.on("listening", async () => {
  port = server.address().port;
  env.HP_PUBLIC_URL ||= `http://${host}:${port}`;
  console.log(`Local desk: ${env.HP_PUBLIC_URL}`);
  try { await seed(); } catch (e) { console.warn("Dev seed failed:", e.message); }
});
server.listen(port, host);
const close = () => server.close(() => { sql.close(); process.exit(); });
process.once("SIGINT", close); process.once("SIGTERM", close);
