// Manager live board, whisper messages, and the team leaderboard.
//  GET  /api/monitor/live            (admins) who is online, who is on a call right now, and today's numbers
//  POST /api/monitor/whisper         (admins) {agent, text, sid?}  a message that pops up on that agent's screen (and phone)
//  GET  /api/monitor/whispers?after= the signed-in agent's own messages since a time
//  GET  /api/monitor/board?range=today|week|month   leaderboard (admins always; agents when the admin leaves it on)
//  GET|POST /api/monitor/settings    { agentsSeeBoard }  (only admins can change it)
import { getStore, D1 } from "./store.mjs";
import { requireUser, getJ, listKeys, store, today, json, bad } from "./hp.mjs";
import { zonedToUtc } from "./ics.mjs";

const kv = () => getStore("hpd-mon");
const rid = () => Math.random().toString(36).slice(2, 8);
const TZ = "America/New_York";
export const identityOf = (id) => "hp_" + String(id).replace(/[^A-Za-z0-9_]/g, "").slice(0, 100);
const DONE = new Set(["completed", "busy", "no-answer", "failed", "canceled"]);
const isLive = (c) => c && !c.final && !DONE.has(c.status) && Date.now() - (c.at || 0) < 3 * 36e5;

async function settings() { return { agentsSeeBoard: true, ...((await kv().get("settings", { type: "json" }).catch(() => null)) || {}) }; }

/* ---------- live ---------- */
async function activeCalls() {
  const keys = await listKeys("live", "");
  const out = [];
  for (const k of keys.slice(0, 400)) {
    const c = await getJ("calls", k);
    if (isLive(c)) out.push(c); else await store("live").delete(k).catch(() => {}); // finished or abandoned
  }
  return out;
}
const dayStats = async (day, identity) => (await getJ("stats", `${day}/a/${identity}`)) || {};
async function liveRoute(user) {
  const now = Date.now(), day = today(TZ, now);
  const [rows, calls, agentKeys] = await Promise.all([
    D1().prepare("SELECT user_id, name, presence, at FROM room WHERE at > ?1").bind(now - 90_000).all().then((r) => r.results || []).catch(() => []),
    activeCalls(), listKeys("agents", ""),
  ]);
  const people = new Map(); // identity -> person
  const add = (id, name, identity) => { identity = identity || identityOf(id); if (!people.has(identity)) people.set(identity, { id, name: name || "Agent", identity, online: false }); return people.get(identity); };
  for (const r of rows) add(r.user_id, r.name, null).online = true;
  for (const c of calls) { const ag = await getJ("agents", c.agent); const p = add(ag?.id || "", ag?.name || c.agentName, c.agent); p.online = true; }
  for (const k of agentKeys) { const ag = await getJ("agents", k); if (ag?.seen && now - ag.seen < 15 * 60_000) { const p = add(ag.id, ag.name, ag.identity); p.online = true; } }
  const agents = [];
  for (const p of people.values()) {
    const mine = calls.filter((c) => c.agent === p.identity);
    const talking = mine.filter((c) => c.answered).sort((a, b) => (b.answeredAt || 0) - (a.answeredAt || 0))[0];
    const dialing = mine.filter((c) => !c.answered);
    const call = talking || dialing.sort((a, b) => b.at - a.at)[0];
    const s = await dayStats(day, p.identity);
    agents.push({
      id: p.id, name: p.name, identity: p.identity, online: p.online, me: p.id === user.id,
      state: talking ? "talking" : dialing.length ? "dialing" : "idle",
      lines: dialing.length,
      call: call ? { sid: call.sid, leadName: call.leadName || "", to: call.to || "", status: call.status, dir: call.dir || "out", at: call.at, answeredAt: call.answeredAt || null, mode: call.mode || "" } : null,
      today: { dials: s.dials || 0, connects: s.connects || 0, appts: s.appts || 0, talkSec: s.talkSec || 0 },
    });
  }
  const rank = { talking: 0, dialing: 1, idle: 2 };
  agents.sort((a, b) => (b.online - a.online) || (rank[a.state] - rank[b.state]) || b.today.dials - a.today.dials || a.name.localeCompare(b.name));
  return json({ now, agents, onCalls: agents.filter((a) => a.state === "talking").length });
}

/* ---------- whispers ---------- */
const wkey = (uid, ts) => `w:${uid}:${String(ts).padStart(15, "0")}:${rid()}`;
async function whisper(user, b) {
  if (!user.admin) return bad("Only admins can whisper.", 403);
  const text = String(b.text || "").replace(/\s+/g, " ").trim().slice(0, 280);
  const to = String(b.agent || "");
  if (!text) return bad("Type a message first.");
  if (!to) return bad("Pick an agent.");
  const ts = Date.now(), id = wkey(to, ts);
  await kv().setJSON(id, { ts, from: user.id, fromName: user.name || "Your manager", text, sid: String(b.sid || "").slice(0, 60) || undefined });
  // tidy: this agent's messages older than an hour
  try { const old = await listKeysKv(`w:${to}:`); for (const k of old) if (+k.split(":")[2] < ts - 36e5) await kv().delete(k); } catch {}
  try { const { notify } = await import("./push.mjs"); await notify(to, "whisper", { title: (user.name || "Your manager").split(" ")[0] + " says", body: text, url: "/?view=dialer", tag: "whisper", ttl: 300 }); } catch {}
  return json({ ok: true, id });
}
async function listKeysKv(prefix) { const r = await kv().list({ prefix }); return (r.blobs || []).map((x) => x.key); }
async function myWhispers(user, after) {
  const keys = (await listKeysKv(`w:${user.id}:`)).filter((k) => +k.split(":")[2] > after).slice(-10);
  const out = [];
  for (const k of keys) { const w = await kv().get(k, { type: "json" }).catch(() => null); if (w) out.push({ id: k, ts: w.ts, from: w.fromName, text: w.text, sid: w.sid }); }
  return json({ now: Date.now(), whispers: out });
}

/* ---------- leaderboard ---------- */
function range(name) {
  const now = Date.now(), day = today(TZ, now), [y, m, d] = day.split("-").map(Number);
  const startOf = (yy, mm, dd) => zonedToUtc(yy, mm, dd, 0, 0, 0, TZ);
  if (name === "month") return { name, label: "This month", from: `${y}-${String(m).padStart(2, "0")}-01`, to: day, since: startOf(y, m, 1) };
  if (name === "week") { const t = new Date(Date.UTC(y, m - 1, d) - 6 * 864e5); return { name, label: "Last 7 days", from: t.toISOString().slice(0, 10), to: day, since: startOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()) }; }
  return { name: "today", label: "Today", from: day, to: day, since: startOf(y, m, d) };
}
async function board(user, name) {
  const set = await settings();
  if (!user.admin && !set.agentsSeeBoard) return bad("Your admin has the leaderboard turned off.", 403);
  const r = range(name);
  const rows = (await D1().prepare("SELECT key, txt FROM blobs WHERE store='hpd-stats' AND key >= ?1 AND key <= ?2 AND key LIKE '____-__-__/a/%'").bind(r.from + "/a/", r.to + "/a/~").all()).results || [];
  const by = new Map();
  const slot = (identity) => { if (!by.has(identity)) by.set(identity, { identity, dials: 0, connects: 0, appts: 0, talkSec: 0, sales: 0 }); return by.get(identity); };
  for (const x of rows) { const identity = x.key.split("/")[2]; let s; try { s = JSON.parse(x.txt); } catch { continue; } const t = slot(identity); t.dials += s.dials || 0; t.connects += s.connects || 0; t.appts += s.appts || 0; t.talkSec += s.talkSec || 0; }
  const sold = (await D1().prepare("SELECT scope, COUNT(*) AS n FROM docs WHERE col='leads' AND json_extract(data,'$.stage')='sold' AND COALESCE(json_extract(data,'$.soldAt'), json_extract(data,'$.updatedAt'), 0) >= ?1 GROUP BY scope").bind(r.since).all()).results || [];
  const byId = new Map(); for (const k of await listKeys("agents", "")) { const ag = await getJ("agents", k); if (ag?.id) byId.set(ag.id, ag); }
  for (const s of sold) { const ag = byId.get(s.scope); if (ag) slot(ag.identity).sales += s.n; }
  const out = [];
  for (const t of by.values()) {
    const ag = await getJ("agents", t.identity);
    if (!ag?.name && !t.dials && !t.sales) continue;
    out.push({ ...t, name: ag?.name || "Agent", you: t.identity === user.identity });
  }
  out.sort((a, b) => b.sales - a.sales || b.appts - a.appts || b.connects - a.connects || b.dials - a.dials || a.name.localeCompare(b.name));
  out.forEach((o, i) => (o.rank = i + 1));
  const total = out.reduce((n, o) => ({ dials: n.dials + o.dials, connects: n.connects + o.connects, appts: n.appts + o.appts, talkSec: n.talkSec + o.talkSec, sales: n.sales + o.sales }), { dials: 0, connects: 0, appts: 0, talkSec: 0, sales: 0 });
  return json({ range: r.name, label: r.label, rows: out, total, agentsSee: set.agentsSeeBoard });
}

export async function monitorRoute(req, action) {
  const user = await requireUser(req);
  const q = new URL(req.url).searchParams;
  const b = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  if (action === "live") { if (!user.admin) return bad("Admins only", 403); return liveRoute(user); }
  if (action === "whisper" && req.method === "POST") return whisper(user, b);
  if (action === "whispers") return myWhispers(user, +q.get("after") || Date.now() - 5 * 60_000);
  if (action === "board") return board(user, q.get("range") || "today");
  if (action === "settings") {
    if (req.method === "POST") {
      if (!user.admin) return bad("Admins only", 403);
      const next = { ...(await settings()) }; if (typeof b.agentsSeeBoard === "boolean") next.agentsSeeBoard = b.agentsSeeBoard;
      await kv().setJSON("settings", next);
    }
    return json({ ...(await settings()), admin: !!user.admin });
  }
  return bad("Unknown action", 404);
}
