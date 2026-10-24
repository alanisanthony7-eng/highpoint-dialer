// Desk APIs: per-user documents (leads, appointments, calls), team docs (crew, settings),
// names, lobby presence, and the Highpoint Bot.
import { D1, ensureSchema } from "./lib/store.mjs";
import { requireUser, requireFeature } from "./lib/auth.mjs";
import { redact } from "./lib/redact.mjs";
import { pickKnowledge } from "./lib/hp-knowledge.mjs";

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
    const next = JSON.parse(body);
    const prev = col === "leads" ? await D1().prepare("SELECT data FROM docs WHERE scope=?1 AND col=?2 AND id=?3").bind(scope, col, id).first().then((r) => (r ? JSON.parse(r.data) : null)).catch(() => null) : null;
    await D1().prepare("INSERT OR REPLACE INTO docs (scope, col, id, data, updated) VALUES (?1, ?2, ?3, ?4, ?5)").bind(scope, col, id, body, Date.now()).run();
    await bump(scope, col);
    // automatic text follow-ups (no-answer texts, appointment reminders)
    if (col === "leads" || col === "appts") { try { const fu = await import("./lib/followups.mjs"); if (col === "leads") await fu.onLeadSaved(user, id, prev, next); else await fu.onApptSaved(user, id, next); } catch (e) { console.error("follow-ups", e); } }
    return json({ ok: true });
  }
  if (req.method === "POST" && col === "leads" && id === "bulk-delete") return bulkDeleteLeads(req, user);
  if (req.method === "POST" && col === "lists" && id === "members") return listMembers(req, user);
  if (req.method === "DELETE") {
    if (col === "leads") { await dropLeads(scope, [id]); return json({ ok: true }); }
    await D1().prepare("DELETE FROM docs WHERE scope=?1 AND col=?2 AND id=?3").bind(scope, col, id).run();
    await bump(scope, col); return json({ ok: true });
  }
  return json({ error: "Method not allowed" }, 405);
}

// Deletes leads and their call logs. D1 allows 100 bound values per query, so ids go 50 at a time.
const DROP_CHUNK = 50, BULK_MAX = 5000;
async function dropLeads(scope, ids) {
  let leads = 0, calls = 0;
  for (let i = 0; i < ids.length; i += DROP_CHUNK) {
    const part = ids.slice(i, i + DROP_CHUNK), marks = part.map((_, j) => "?" + (j + 2)).join(",");
    const [a, c] = await D1().batch([
      D1().prepare(`DELETE FROM docs WHERE scope=?1 AND col='leads' AND id IN (${marks})`).bind(scope, ...part),
      D1().prepare(`DELETE FROM docs WHERE scope=?1 AND col='calls' AND json_extract(data,'$.leadId') IN (${marks})`).bind(scope, ...part),
    ]);
    leads += a?.meta?.changes || 0; calls += c?.meta?.changes || 0;
  }
  await bump(scope, "leads"); await bump(scope, "calls");
  await pruneLists(scope, ids);
  return { leads, calls };
}

// Hand-picked lists ("My lists") keep lead ids, so deleted leads are taken out of them.
async function pruneLists(scope, ids) {
  if (!ids.length) return;
  const gone = new Set(ids);
  const r = await D1().prepare("SELECT id, data FROM docs WHERE scope=?1 AND col='lists' AND json_extract(data,'$.kind')='picked'").bind(scope).all();
  const now = Date.now(), stmts = [];
  for (const row of r.results || []) {
    const d = JSON.parse(row.data), before = Array.isArray(d.ids) ? d.ids : [];
    const kept = before.filter((x) => !gone.has(x));
    if (kept.length !== before.length) stmts.push(D1().prepare("UPDATE docs SET data=?3, updated=?4 WHERE scope=?1 AND col='lists' AND id=?2").bind(scope, row.id, JSON.stringify({ ...d, ids: kept, updatedAt: now }), now));
  }
  if (stmts.length) { await D1().batch(stmts); await bump(scope, "lists"); }
}

// POST /api/docs/lists/members  {listId | name, add?:[ids], remove?:[ids]}: adds or removes leads on a hand-picked list
// in one write (a new list is created when only a name is given).
const LIST_MAX = 10000;
async function listMembers(req, user) {
  const b = await req.json().catch(() => ({}));
  const clean = (a) => (Array.isArray(a) ? [...new Set(a.filter((x) => typeof x === "string" && x && x.length <= 120))] : []);
  const add = clean(b?.add), remove = new Set(clean(b?.remove));
  const name = typeof b?.name === "string" ? b.name.trim().slice(0, 60) : "";
  let listId = typeof b?.listId === "string" && b.listId.length <= 120 ? b.listId : "";
  if (add.length > LIST_MAX || remove.size > LIST_MAX) return json({ error: `A list holds up to ${LIST_MAX.toLocaleString()} leads.` }, 413);
  let cur = null;
  if (listId) {
    const r = await D1().prepare("SELECT data FROM docs WHERE scope=?1 AND col='lists' AND id=?2").bind(user.id, listId).first();
    if (!r) return json({ error: "That list is gone. Pick another one." }, 404);
    cur = JSON.parse(r.data);
    if (cur.kind !== "picked") return json({ error: "Imports fill themselves. Add leads to one of My lists instead." }, 400);
  } else {
    if (!name) return json({ error: "Name the new list." }, 400);
    listId = "pl" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    cur = { name, kind: "picked", ids: [], createdAt: Date.now() };
  }
  const ids = Array.isArray(cur.ids) ? cur.ids.filter((x) => !remove.has(x)) : [];
  const removed = (cur.ids?.length || 0) - ids.length, have = new Set(ids);
  let added = 0, already = 0, overCap = 0;
  for (const id of add) {
    if (have.has(id)) { already++; continue; }
    if (ids.length >= LIST_MAX) { overCap++; continue; }
    ids.push(id); have.add(id); added++;
  }
  const now = Date.now();
  await D1().prepare("INSERT OR REPLACE INTO docs (scope, col, id, data, updated) VALUES (?1, 'lists', ?2, ?3, ?4)").bind(user.id, listId, JSON.stringify({ ...cur, ids, updatedAt: now }), now).run();
  await bump(user.id, "lists");
  return json({ ok: true, id: listId, name: cur.name, added, already, removed, overCap, total: ids.length });
}

// POST /api/docs/leads/bulk-delete  {ids:[...]} deletes those leads; {batchId} deletes a whole import and its smart list
async function bulkDeleteLeads(req, user) {
  const b = await req.json().catch(() => ({}));
  const batchId = typeof b?.batchId === "string" && b.batchId.length <= 120 ? b.batchId : "";
  let ids = Array.isArray(b?.ids) ? [...new Set(b.ids.filter((x) => typeof x === "string" && x && x.length <= 120))] : [];
  if (!ids.length && !batchId) return json({ error: "Pick at least one lead to delete." }, 400);
  if (ids.length > BULK_MAX) return json({ error: `You can delete up to ${BULK_MAX.toLocaleString()} leads at a time.` }, 413);
  if (batchId) {
    const r = await D1().prepare("SELECT id FROM docs WHERE scope=?1 AND col='leads' AND json_extract(data,'$.batchId')=?2").bind(user.id, batchId).all();
    ids = [...new Set([...ids, ...(r.results || []).map((x) => x.id)])];
  }
  const out = await dropLeads(user.id, ids);
  if (batchId) {
    await D1().batch([
      D1().prepare("DELETE FROM docs WHERE scope=?1 AND col='imports' AND id=?2").bind(user.id, batchId),
      D1().prepare("DELETE FROM docs WHERE scope=?1 AND col='lists' AND json_extract(data,'$.filter.batchId')=?2").bind(user.id, batchId),
    ]);
    await bump(user.id, "imports"); await bump(user.id, "lists");
  }
  return json({ ok: true, deleted: out.leads, calls: out.calls });
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
  if (col === "leads") {
    const gone = items.slice(0, 500).filter((it) => it.delete).map((it) => String(it.id));
    if (gone.length) {
      const marks = gone.map((_, i) => "?" + (i + 2)).join(",");
      await D1().prepare(`DELETE FROM docs WHERE scope=?1 AND col='calls' AND json_extract(data,'$.leadId') IN (${marks})`).bind(user.id, ...gone).run();
      await bump(user.id, "calls");
      await pruneLists(user.id, gone);
    }
  }
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

// Highpoint Bot + call summaries. Prefers Cloudflare Workers AI (10,000 neurons/day
// free, then cheap). Anthropic is only used when there is no AI binding (local/dev).
const DEFAULT_CF = "@cf/google/gemma-4-26b-a4b-it";
const FALLBACK_CF = "@cf/zai-org/glm-4.7-flash";
const DEFAULT_CLAUDE = "claude-haiku-5-5";
const AI_CACHE = new Map(); // repeat questions inside five minutes answer instantly (per server instance)
async function hashStr(t) { const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)); return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join(""); }
function stripThink(s) {
  return String(s || "").replace(/<(?:think|thought|reasoning)>[\s\S]*?<\/(?:think|thought|reasoning)>/gi, "").replace(/^\s*thinking[:\s]+[\s\S]*?\n\s*(?:answer|final)[:\s]+/i, "").trim();
}
function aiText(out) {
  if (out == null) return "";
  const pick = (v) => stripThink(typeof v === "string" ? v : "");
  if (typeof out === "string") return pick(out);
  for (const v of [out.response, out.result?.response, out.output_text, out.text]) {
    const t = pick(v);
    if (t) return t;
  }
  if (Array.isArray(out.choices)) return pick(out.choices.map((c) => c?.message?.content || c?.text || "").join(""));
  if (Array.isArray(out.content)) return pick(out.content.filter((c) => c?.type === "text" || typeof c?.text === "string").map((c) => (typeof c === "string" ? c : c.text)).join(""));
  return "";
}
export async function aiRoute(req) {
  await requireFeature(req, "bot", "dialer"); // Highpoint Bot, or the dialer's call summaries and Copilot
  const ai = globalThis.__ENV?.AI;
  const key = String(env("ANTHROPIC_API_KEY") || "").trim();
  if (!ai?.run && !key) return json({ error: "The assistant isn't turned on yet. Add a Workers AI binding named AI in Cloudflare Pages → Settings → Bindings, then redeploy.", code: "unavailable" }, 503);
  const b = await req.json().catch(() => ({}));
  const messages = (b.messages || []).filter((m) => m && (m.role === "user" || m.role === "assistant")).map((m) => ({ role: m.role, content: typeof m.content === "string" ? redact(m.content.slice(0, 40000)) : redact(JSON.stringify(m.content)).slice(0, 40000) })).slice(-30);
  if (!messages.length) return json({ error: "Nothing to send" }, 400);
  const extra = String(b.system || "").trim();
  const asked = messages.map((m) => m.content).join("\n");
  // Copilot notes and fact pulls carry their own instructions, so the big product pack only slows them down.
  const quick = ["copilot", "summary", "extract"].includes(String(b.mode || "").toLowerCase());
  const system = [quick && extra ? "" : pickKnowledge(asked, { mode: b.mode }), extra].filter(Boolean).join("\n\n").slice(0, 14000);
  const chosen = String(env("HP_AI_MODEL") || "").trim();
  const maxTokens = Math.max(200, Math.min(2500, +b.max_tokens || (quick ? 900 : 1800)));
  const ckey = !b.stream && !b.nocache ? `${quick}|${await hashStr(chosen + "\u0001" + system + "\u0001" + asked + "\u0001" + maxTokens + "\u0001" + (b.think === true))}` : "";
  const hit = ckey && AI_CACHE.get(ckey);
  if (hit && Date.now() - hit.t < 5 * 60e3) return json({ text: hit.text, cached: true });

  if (ai?.run) {
    const retired = /llama-3(\.1)?-8b-instruct(?!-fp8)|glm-4\.7-flash/.test(chosen);
    const model = chosen.startsWith("@cf/") && !retired ? chosen : DEFAULT_CF;
    // Thinking first makes every answer several times slower. It stays available with {think:true}.
    const input = (m, stream) => ({
      messages: [{ role: "system", content: system }, ...messages],
      max_tokens: maxTokens,
      temperature: 0.2,
      ...(stream ? { stream: true } : {}),
      ...(m === DEFAULT_CF ? { chat_template_kwargs: { enable_thinking: b.think === true } } : {}),
    });
    const run = async (m) => aiText(await ai.run(m, input(m, false)));
    if (b.stream === true) {
      // Words reach the screen as they are written instead of after the whole answer.
      try {
        let out;
        try { out = await ai.run(model, input(model, true)); }
        catch (e) {
          const detail = String(e?.message || e || "");
          if (model !== FALLBACK_CF && /5028|deprecated|not found|unavailable/i.test(detail)) out = await ai.run(FALLBACK_CF, input(FALLBACK_CF, true));
          else throw e;
        }
        if (out && typeof out.getReader === "function") return new Response(out, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" } });
        const text = aiText(out);
        if (!String(text).trim()) return json({ error: "The assistant didn't return an answer. Try again.", code: "empty" }, 502);
        return json({ text });
      } catch (e) {
        const detail = String(e?.message || e || "");
        if (/neuron|quota|limit|429|3028/i.test(detail)) return json({ error: "Today's free Workers AI allowance is used up. Try again tomorrow — extra use is billed in cents on a paid Workers plan, not Claude credits.", code: "quota" }, 429);
        return json({ error: detail || "Assistant error" }, 502);
      }
    }
    try {
      let text;
      try { text = await run(model); }
      catch (e) {
        const detail = String(e?.message || e || "");
        if (model !== FALLBACK_CF && /5028|deprecated|not found|unavailable/i.test(detail)) text = await run(FALLBACK_CF);
        else throw e;
      }
      if (!String(text).trim()) return json({ error: "The assistant didn't return an answer. Try again.", code: "empty" }, 502);
      if (ckey) { AI_CACHE.set(ckey, { t: Date.now(), text }); if (AI_CACHE.size > 80) AI_CACHE.delete(AI_CACHE.keys().next().value); }
      return json({ text });
    } catch (e) {
      const detail = String(e?.message || e || "");
      if (/neuron|quota|limit|429|3028/i.test(detail)) return json({ error: "Today's free Workers AI allowance is used up. Try again tomorrow — extra use is billed in cents on a paid Workers plan, not Claude credits.", code: "quota" }, 429);
      return json({ error: detail || "Assistant error" }, 502);
    }
  }

  const ask = (model) => fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: Math.min(maxTokens, 1500), system, messages }),
  });
  let model = chosen || DEFAULT_CLAUDE;
  if (!model.startsWith("claude-")) model = DEFAULT_CLAUDE;
  let r = await ask(model);
  let j = await r.json().catch(() => ({}));
  if (r.status === 404 && model !== DEFAULT_CLAUDE) { r = await ask(DEFAULT_CLAUDE); j = await r.json().catch(() => ({})); }
  if (r.ok) return json({ text: (j.content || []).filter((c) => c.type === "text").map((c) => c.text).join("") });
  const detail = String(j.error?.message || "");
  if (r.status === 401) return json({ error: "The Anthropic API key isn't valid. An admin needs to check ANTHROPIC_API_KEY in Cloudflare (it starts with sk-ant-).", code: "bad_key" }, 502);
  if (r.status === 403) return json({ error: "This Anthropic API key doesn't have access. Check the key's workspace in the Claude Console.", code: "forbidden" }, 502);
  if (/credit balance|billing|purchase credits/i.test(detail)) return json({ error: "The Anthropic account is out of credits. An admin needs to add credits in the Claude Console (Billing).", code: "no_credit" }, 502);
  if (r.status === 429) return json({ error: "Too many requests right now. Try again in a minute.", code: "rate_limited" }, 429);
  if (r.status === 529 || r.status >= 500) return json({ error: "Claude is busy right now. Try again in a moment.", code: "busy" }, 503);
  return json({ error: detail || "Assistant error" }, 502);
}
