// Manager live board, whispers and the leaderboard — local, with in-memory D1..
import { DatabaseSync } from "node:sqlite";
const { onRequest } = await import("../functions/api/[[path]].js");
const sql = new DatabaseSync(":memory:");
const norm = (v) => (v instanceof ArrayBuffer ? new Uint8Array(v) : v === undefined ? null : v);
const out = (row) => row && Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Uint8Array ? Array.from(v) : v]));
const stmt = (q, args = []) => ({ bind: (...a) => stmt(q, a.map(norm)), first: async () => out(sql.prepare(q).get(...args)) ?? null, all: async () => ({ results: sql.prepare(q).all(...args).map(out) }), run: async () => { const r = sql.prepare(q).run(...args); return { meta: { changes: r.changes } }; } });
const DB = { prepare: (q) => stmt(q), batch: async (list) => { const r = []; for (const s of list) r.push(await s.run()); return r; } };
const env = { DB, HP_ADMIN_EMAILS: "boss@hp.com", HP_INVITE_CODE: "HP2026", HP_PUBLIC_URL: "https://desk.example.com" };
const pushes = [];
globalThis.fetch = async (url, o = {}) => {
  const u = new URL(url);
  if (u.hostname === "push.example.net") { pushes.push(u.pathname); return new Response(null, { status: 201 }); }
  return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
};
const jars = {};
async function call(who, path, { method = "GET", body } = {}) {
  const h = { "cf-connecting-ip": "203.0.113.9" }; if (who && jars[who]) h.cookie = jars[who];
  let b; if (body !== undefined) { b = JSON.stringify(body); h["content-type"] = "application/json"; }
  const waits = [];
  const r = await onRequest({ request: new Request("https://desk.example.com" + path, { method, headers: h, body: b }), env, waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  const sc = r.headers.get("set-cookie"); if (sc && who) jars[who] = sc.split(";")[0];
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { s: r.status, j, h: r.headers };
}
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) process.exitCode = 1; };
const crypto = (await import("node:crypto")).default;

await call("boss", "/api/auth/signup", { method: "POST", body: { email: "boss@hp.com", password: "password2", name: "Boss Lady" } });
await call("rep", "/api/auth/signup", { method: "POST", body: { email: "rep@hp.com", password: "password1", name: "Rita Rep", invite: "HP2026", agree: true } });
await call("rep2", "/api/auth/signup", { method: "POST", body: { email: "rep2@hp.com", password: "password3", name: "Sam Seller", invite: "HP2026", agree: true } });
const boss = (await call("boss", "/api/auth/me")).j.user, rep = (await call("rep", "/api/auth/me")).j.user, rep2 = (await call("rep2", "/api/auth/me")).j.user;
for (const w of ["boss", "rep", "rep2"]) await call(w, "/api/room/presence", { method: "POST", body: { status: "Online" } });
const { saveCall, patchCallBySid, aggregate, setJ, getJ, listKeys } = await import("../src/lib/hp.mjs");
await call("rep", "/api/dialer/sms"); await call("rep2", "/api/dialer/sms"); await call("boss", "/api/dialer/sms"); // registers each agent by name

/* ---------- live board ---------- */
ok((await call("rep", "/api/monitor/live")).s === 403, "agents can't open the live board");
ok((await call(null, "/api/monitor/live")).s === 401, "and it needs a sign-in");
let r = await call("boss", "/api/monitor/live");
ok(r.s === 200 && r.j.agents.length === 3 && r.j.onCalls === 0 && r.j.agents.every((a) => a.state === "idle" && a.online), "everyone signed in shows, all idle at first");
const now = Date.now();
await saveCall({ id: "C1", sid: "CA1", agent: rep.identity, agentName: "Rita Rep", leadName: "Margaret Lee", to: "2125550142", from: "+12125550000", dir: "out", at: now - 60_000, status: "in-progress", answered: true, answeredAt: now - 45_000 });
await saveCall({ id: "C2", sid: "CA2", agent: rep2.identity, agentName: "Sam Seller", leadName: "Earl Jones", to: "3055550100", from: "+12125550000", dir: "out", at: now - 5_000, status: "ringing" });
await saveCall({ id: "C3", sid: "CA3", agent: boss.identity, agentName: "Boss Lady", to: "3055550101", dir: "out", at: now - 4 * 36e5, status: "in-progress", answered: true, answeredAt: now - 4 * 36e5 });
r = await call("boss", "/api/monitor/live");
const by = (id) => r.j.agents.find((a) => a.id === id);
ok(by(rep.id).state === "talking" && by(rep.id).call.leadName === "Margaret Lee" && by(rep.id).call.sid === "CA1" && by(rep.id).call.answeredAt === now - 45_000, "an agent on a call shows who they're talking to and since when");
ok(by(rep2.id).state === "dialing" && by(rep2.id).lines === 1, "an agent whose call is still ringing shows as dialing");
ok(by(boss.id).state === "idle" && r.j.onCalls === 1 && by(boss.id).me === true, "a call left open for hours is ignored (and it's you)");
ok((await listKeys("live", "")).length === 2, "and cleaned up");
ok(r.j.agents[0].state === "talking", "people on calls are listed first");
// the call ends
await patchCallBySid("CA1", (c) => { c.status = "completed"; c.final = true; c.talkSec = 75; return c; });
r = await call("boss", "/api/monitor/live");
ok(by(rep.id).state === "idle" && r.j.onCalls === 0, "when the call ends the agent goes back to idle");
// listen in: an admin can read the live transcript, an agent can't read someone else's
await setJ("tx", "CA2", { lines: [{ t: now, speaker: "Lead", text: "Hello?" }, { t: now, speaker: "Agent", text: "Hi Earl, this is Sam" }] });
r = await call("boss", "/api/dialer/calls/live?sid=CA2");
ok(r.s === 200 && r.j.transcript.length === 2 && r.j.transcript[1].speaker === "Agent", "an admin can read the live transcript of an agent's call");
ok((await call("rep", "/api/dialer/calls/live?sid=CA2")).s === 403, "other agents can't");

/* ---------- whispers ---------- */
const sub = (() => { const e = crypto.createECDH("prime256v1"); e.generateKeys(); return { endpoint: "https://push.example.net/ok/sam", keys: { p256dh: e.getPublicKey().toString("base64url"), auth: crypto.randomBytes(16).toString("base64url") } }; })();
await call("rep2", "/api/push/subscribe", { method: "POST", body: { subscription: sub, label: "Android · Chrome" } });
ok((await call("rep", "/api/monitor/whisper", { method: "POST", body: { agent: rep2.id, text: "psst" } })).s === 403, "agents can't whisper");
ok((await call("boss", "/api/monitor/whisper", { method: "POST", body: { agent: rep2.id, text: "   " } })).s === 400, "an empty message isn't sent");
ok((await call("boss", "/api/monitor/whisper", { method: "POST", body: { text: "hi" } })).s === 400, "and it needs an agent");
r = await call("boss", "/api/monitor/whisper", { method: "POST", body: { agent: rep2.id, text: "Ask  for the\nappointment now", sid: "CA2" } });
ok(r.s === 200 && r.j.ok, "a manager whispers to an agent");
ok(pushes.includes("/ok/sam"), "the agent's phone gets it too");
r = await call("rep2", "/api/monitor/whispers");
ok(r.s === 200 && r.j.whispers.length === 1 && r.j.whispers[0].text === "Ask for the appointment now" && r.j.whispers[0].from === "Boss Lady" && r.j.whispers[0].sid === "CA2", "the agent's screen picks it up (whitespace tidied, who it's from)");
ok((await call("rep", "/api/monitor/whispers")).j.whispers.length === 0, "no one else sees it");
const t0 = r.j.whispers[0].ts;
ok((await call("rep2", "/api/monitor/whispers?after=" + t0)).j.whispers.length === 0, "and it isn't shown twice");
await call("boss", "/api/monitor/whisper", { method: "POST", body: { agent: rep2.id, text: "x".repeat(500) } });
ok((await call("rep2", "/api/monitor/whispers?after=" + t0)).j.whispers[0].text.length === 280, "long messages are cut at 280 characters");
await call("rep2", "/api/push/prefs", { method: "POST", body: { events: { whisper: false } } });
const np = pushes.length; await call("boss", "/api/monitor/whisper", { method: "POST", body: { agent: rep2.id, text: "no buzz please" } });
ok(pushes.length === np && (await call("rep2", "/api/monitor/whispers?after=" + t0)).j.whispers.length === 2, "with phone alerts for whispers off, it still shows on screen but doesn't buzz");

/* ---------- leaderboard ---------- */
for (const [who, u, dials, talked, appts, sec] of [["rep", rep, 12, 5, 2, 900], ["rep2", rep2, 30, 8, 1, 1500]]) {
  for (let i = 0; i < dials; i++) await aggregate({ agent: u.identity, at: Date.now(), from: "+12125550000" }, "dial");
  for (let i = 0; i < talked; i++) await aggregate({ agent: u.identity, at: Date.now(), from: "+12125550000", answered: true, human: true, talkSec: sec / talked, dir: "in" }, "end");
  for (let i = 0; i < appts; i++) await aggregate({ agent: u.identity, at: Date.now(), disposition: "Appointment set" }, "dispo");
}
await call("rep", "/api/docs/leads/L1", { method: "PUT", body: { first: "A", phone: "2125550001", stage: "sold", soldAt: Date.now(), updatedAt: Date.now() } });
await call("rep", "/api/docs/leads/L2", { method: "PUT", body: { first: "B", phone: "2125550002", stage: "sold", updatedAt: Date.now() } });
await call("rep", "/api/docs/leads/L3", { method: "PUT", body: { first: "C", phone: "2125550003", stage: "sold", soldAt: Date.now() - 40 * 864e5, updatedAt: Date.now() } });
await call("rep", "/api/docs/leads/L4", { method: "PUT", body: { first: "D", phone: "2125550004", stage: "contacted", updatedAt: Date.now() } });
await call("rep2", "/api/docs/leads/M1", { method: "PUT", body: { first: "E", phone: "2125550005", stage: "sold", soldAt: Date.now(), updatedAt: Date.now() } });
r = await call("rep", "/api/monitor/board?range=today");
const row = (n) => r.j.rows.find((x) => x.name === n);
ok(r.s === 200 && r.j.rows.length === 2 && r.j.label === "Today", "the leaderboard lists agents with activity");
ok(row("Rita Rep").dials === 12 && row("Rita Rep").connects === 5 && row("Rita Rep").appts === 2 && row("Rita Rep").talkSec === 900 && row("Sam Seller").dials === 30 && row("Sam Seller").connects === 8, "dials, people talked to, appointments and talk time come from the dialer");
ok(row("Rita Rep").sales === 2 && row("Sam Seller").sales === 1, "sales count clients moved to Sold in the period (a lead sold 40 days ago doesn't)");
ok(r.j.rows[0].name === "Rita Rep" && r.j.rows[0].rank === 1 && r.j.rows[1].rank === 2, "ranked by sales, then appointments");
ok(row("Rita Rep").you && !row("Sam Seller").you, "your own row is marked");
ok(r.j.total.dials === 42 && r.j.total.sales === 3 && r.j.total.appts === 3, "with team totals");
const wk = (await call("rep", "/api/monitor/board?range=week")).j, mo = (await call("rep", "/api/monitor/board?range=month")).j;
ok(wk.rows.find((x) => x.name === "Rita Rep").dials === 12 && mo.rows.find((x) => x.name === "Rita Rep").sales === 2 && wk.label === "Last 7 days" && mo.label === "This month", "the week and month views include today");
// yesterday's numbers count in the week, not today
const yest = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(Date.now() - 864e5);
await setJ("stats", `${yest}/a/${rep2.identity}`, { dials: 100, connects: 20, appts: 4, talkSec: 3000 });
const wk2 = (await call("rep", "/api/monitor/board?range=week")).j, td2 = (await call("rep", "/api/monitor/board?range=today")).j;
ok(wk2.rows.find((x) => x.name === "Sam Seller").dials === 130 && td2.rows.find((x) => x.name === "Sam Seller").dials === 30, "an earlier day's calls count in the week but not in today");
// the admin controls whether agents can see it
ok((await call("rep", "/api/monitor/settings", { method: "POST", body: { agentsSeeBoard: false } })).s === 403, "agents can't change who sees the leaderboard");
await call("boss", "/api/monitor/settings", { method: "POST", body: { agentsSeeBoard: false } });
ok((await call("rep", "/api/monitor/board")).s === 403 && (await call("boss", "/api/monitor/board")).s === 200, "an admin can hide it from agents (admins still see it)");
await call("boss", "/api/monitor/settings", { method: "POST", body: { agentsSeeBoard: true } });
ok((await call("rep", "/api/monitor/board")).s === 200 && (await call("rep", "/api/monitor/settings")).j.agentsSeeBoard === true, "and show it again");
