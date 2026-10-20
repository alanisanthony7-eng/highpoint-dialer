// Desk APIs: per-user documents (leads, appointments, calls), team docs (crew, settings),
// names, lobby presence, and the Highpoint Bot.
import { D1, ensureSchema } from "./lib/store.mjs";
import { requireUser, requireFeature } from "./lib/auth.mjs";
import { redact } from "./lib/redact.mjs";

const env = (k, d = "") => globalThis.__ENV?.[k] ?? d;
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const TEAM = new Set(["crew", "settings"]);
const okName = (s) => /^[A-Za-z0-9_-]{1,40}$/.test(s);

async function bump(scope, col) {
  await D1().prepare("INSERT INTO colver (scope, col, v) VALUES (?1, ?2, 1) ON CONFLICT(scope, col) DO UPDATE SET v = v + 1").bind(scope, col).run();
}

export async function docsRoute(req, parts) {
  const user = await requireUser(req); await ensureSchema();
  const [col, id] = parts;
  if (!okName(col)) return json({ error: "Bad collection" }, 400);
  const scope = TEAM.has(col) ? "team" : user.id;
  if (req.method === "GET" && !id) {
    const v = (await D1().prepare("SELECT v FROM colver WHERE scope=?1 AND col=?2").bind(scope, col).first())?.v || 0;
    const since = new URL(req.url).searchParams.get("v");
    if (since && +since === v) return json({ unchanged: true, version: String(v) });
    const r = await D1().prepare("SELECT id, data FROM docs WHERE scope=?1 AND col=?2").bind(scope, col).all();
    return json({ version: String(v), docs: (r.results || []).map((x) => ({ id: x.id, data: JSON.parse(x.data) })) });
  }
  if (!id || id.length > 120) return json({ error: "Bad id" }, 400);
  if (col === "crew" && id !== user.id) return json({ error: "You can only change your own crew card." }, 403);
  if (req.method === "GET") { const r = await D1().prepare("SELECT data FROM docs WHERE scope=?1 AND col=?2 AND id=?3").bind(scope, col, id).first(); return json({ id, data: r ? JSON.parse(r.data) : null }); }
  if (req.method === "PUT") {
    const body = await req.text();
    if (body.length > 900_000) return json({ error: "That record is too big." }, 413);
    JSON.parse(body);
    await D1().prepare("INSERT OR REPLACE INTO docs (scope, col, id, data, updated) VALUES (?1, ?2, ?3, ?4, ?5)").bind(scope, col, id, body, Date.now()).run();
    await bump(scope, col); return json({ ok: true });
  }
  if (req.method === "DELETE") {
    await D1().prepare("DELETE FROM docs WHERE scope=?1 AND col=?2 AND id=?3").bind(scope, col, id).run();
    await bump(scope, col); return json({ ok: true });
  }
  return json({ error: "Method not allowed" }, 405);
}

// One request to check many collections: GET /api/docs/_sync?c=leads:3,appts:0
export async function docsSync(req) {
  const user = await requireUser(req); await ensureSchema();
  const want = (new URL(req.url).searchParams.get("c") || "").split(",").map((x) => x.split(":")).filter(([n]) => okName(n || "")).slice(0, 20);
  const out = {};
  for (const [col, since] of want) {
    const scope = TEAM.has(col) ? "team" : user.id;
    const v = (await D1().prepare("SELECT v FROM colver WHERE scope=?1 AND col=?2").bind(scope, col).first())?.v || 0;
    if (since !== "" && since !== undefined && +since === v) { out[col] = { unchanged: true, version: String(v) }; continue; }
    const r = await D1().prepare("SELECT id, data FROM docs WHERE scope=?1 AND col=?2").bind(scope, col).all();
    out[col] = { version: String(v), docs: (r.results || []).map((x) => ({ id: x.id, data: JSON.parse(x.data) })) };
  }
  return json({ cols: out });
}

// Many writes in one request (imports of hundreds of leads)
export async function docsBatch(req) {
  const user = await requireUser(req); await ensureSchema();
  const { col, items = [] } = await req.json();
  if (!okName(col) || TEAM.has(col)) return json({ error: "Bad collection" }, 400);
  const stmts = items.slice(0, 500).map((it) => it.delete
    ? D1().prepare("DELETE FROM docs WHERE scope=?1 AND col=?2 AND id=?3").bind(user.id, col, String(it.id))
    : D1().prepare("INSERT OR REPLACE INTO docs (scope, col, id, data, updated) VALUES (?1, ?2, ?3, ?4, ?5)").bind(user.id, col, String(it.id), JSON.stringify(it.data), Date.now()));
  if (stmts.length) await D1().batch(stmts);
  await bump(user.id, col);
  return json({ ok: true, count: stmts.length });
}

export async function usersRoute(req) {
  await requireUser(req); await ensureSchema();
  const ids = (new URL(req.url).searchParams.get("ids") || "").split(",").filter(Boolean).slice(0, 100);
  if (!ids.length) return json({});
  const r = await D1().prepare(`SELECT id, name FROM users WHERE id IN (${ids.map((_, i) => "?" + (i + 1)).join(",")})`).bind(...ids).all();
  return json(Object.fromEntries((r.results || []).map((u) => [u.id, { name: u.name }])));
}

export async function roomRoute(req, action) {
  const user = await requireUser(req); await ensureSchema();
  if (action === "presence" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    await D1().prepare("INSERT OR REPLACE INTO room (user_id, name, presence, at) VALUES (?1, ?2, ?3, ?4)").bind(user.id, user.name, JSON.stringify(b || {}).slice(0, 2000), Date.now()).run();
    return json({ ok: true });
  }
  if (action === "peers") {
    const r = await D1().prepare("SELECT user_id, name, presence, at FROM room WHERE at > ?1").bind(Date.now() - 90_000).all();
    return json({ me: user.id, peers: (r.results || []).map((p) => ({ id: p.user_id, peerId: p.user_id, name: p.name, kind: "viewer", presence: JSON.parse(p.presence || "{}"), isMe: p.user_id === user.id })) });
  }
  if (action === "emit" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    await D1().prepare("INSERT INTO roomev (topic, by, data, at) VALUES (?1, ?2, ?3, ?4)").bind(String(b.topic || "").slice(0, 40), user.id, JSON.stringify(b.data ?? null).slice(0, 4000), Date.now()).run();
    await D1().prepare("DELETE FROM roomev WHERE at < ?1").bind(Date.now() - 864e5).run();
    return json({ ok: true });
  }
  if (action === "events") {
    const q = new URL(req.url).searchParams;
    if (!q.has("after")) return json({ me: user.id, last: (await D1().prepare("SELECT MAX(id) AS m FROM roomev").first())?.m || 0, events: [] });
    const r = await D1().prepare("SELECT id, topic, by, data, at FROM roomev WHERE id > ?1 ORDER BY id LIMIT 100").bind(+q.get("after") || 0).all();
    return json({ me: user.id, events: (r.results || []).map((e) => ({ ...e, data: JSON.parse(e.data), isMe: e.by === user.id })) });
  }
  return json({ error: "Unknown action" }, 404);
}

// Highpoint Bot + call summaries (needs ANTHROPIC_API_KEY)
export async function aiRoute(req) {
  await requireFeature(req, "bot", "dialer"); // Highpoint Bot, or the dialer's call summaries and Copilot
  const key = String(env("ANTHROPIC_API_KEY") || "").trim();
  if (!key) return json({ error: "The assistant isn't turned on yet. An admin needs to add ANTHROPIC_API_KEY in Cloudflare Pages → Settings → Variables and secrets.", code: "unavailable" }, 503);
  const b = await req.json().catch(() => ({}));
  const messages = (b.messages || []).filter((m) => m && (m.role === "user" || m.role === "assistant")).map((m) => ({ role: m.role, content: typeof m.content === "string" ? redact(m.content.slice(0, 40000)) : redact(JSON.stringify(m.content)).slice(0, 40000) })).slice(-30);
  if (!messages.length) return json({ error: "Nothing to send" }, 400);
  const system = String(b.system || "You are Highpoint Bot, a helpful assistant for life insurance agents at Highpoint Financial (final expense, mortgage protection, IUL). Be concise and practical. You are not a lawyer; flag compliance questions for a licensed advisor.").slice(0, 8000);
  const ask = (model) => fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: 1500, system, messages }),
  });
  const DEFAULT_MODEL = "claude-haiku-5-5"; // fast and inexpensive; HP_AI_MODEL can pick another
  const chosen = String(env("HP_AI_MODEL") || "").trim() || DEFAULT_MODEL;
  let r = await ask(chosen);
  let j = await r.json().catch(() => ({}));
  // a model set in HP_AI_MODEL that Anthropic has retired: fall back to the default instead of breaking the bot
  if (r.status === 404 && chosen !== DEFAULT_MODEL) { r = await ask(DEFAULT_MODEL); j = await r.json().catch(() => ({})); }
  if (r.ok) return json({ text: (j.content || []).filter((c) => c.type === "text").map((c) => c.text).join("") });
  const detail = String(j.error?.message || "");
  if (r.status === 401) return json({ error: "The Anthropic API key isn't valid. An admin needs to check ANTHROPIC_API_KEY in Cloudflare (it starts with sk-ant-).", code: "bad_key" }, 502);
  if (r.status === 403) return json({ error: "This Anthropic API key doesn't have access. Check the key's workspace in the Claude Console.", code: "forbidden" }, 502);
  if (/credit balance|billing|purchase credits/i.test(detail)) return json({ error: "The Anthropic account is out of credits. An admin needs to add credits in the Claude Console (Billing).", code: "no_credit" }, 502);
  if (r.status === 429) return json({ error: "Too many requests right now. Try again in a minute.", code: "rate_limited" }, 429);
  if (r.status === 529 || r.status >= 500) return json({ error: "Claude is busy right now. Try again in a moment.", code: "busy" }, 503);
  return json({ error: detail || "Assistant error" }, 502);
}
