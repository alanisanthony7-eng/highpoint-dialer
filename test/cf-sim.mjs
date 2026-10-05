// Runs the Cloudflare app in Node with an in-memory SQLite "D1" and a fake Twilio.
import { DatabaseSync } from "node:sqlite";
import { onRequest } from "../functions/api/[[path]].js";
const sql = new DatabaseSync(":memory:");
const norm = (v) => (v instanceof ArrayBuffer ? new Uint8Array(v) : v === undefined ? null : v);
const out = (row) => row && Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Uint8Array ? Array.from(v) : v]));
const stmt = (q, args = []) => ({
  bind: (...a) => stmt(q, a.map(norm)),
  first: async () => out(sql.prepare(q).get(...args)) ?? null,
  all: async () => ({ results: sql.prepare(q).all(...args).map(out) }),
  run: async () => { const r = sql.prepare(q).run(...args); return { meta: { changes: r.changes } }; },
});
const DB = { prepare: (q) => stmt(q), batch: async (list) => Promise.all(list.map((s) => s.run())) };
const env = { DB, TWILIO_ACCOUNT_SID: "AC_test", TWILIO_AUTH_TOKEN: "tok", HP_ADMIN_EMAILS: "boss@hp.com", HP_INVITE_CODE: "HP2026", HP_SKIP_SIGNATURE: "1", HP_PUBLIC_URL: "https://desk.example.com" };
let callN = 0; const log = [];
globalThis.fetch = async (url, o = {}) => {
  const u = new URL(url); const body = o.body ? Object.fromEntries(new URLSearchParams(o.body.toString())) : {};
  log.push([o.method || "GET", u.pathname.replace("/2010-04-01/Accounts/AC_test", ""), body]);
  const J = (j, s = 200) => new Response(JSON.stringify(j), { status: s, headers: { "content-type": "application/json" } });
  const p = u.pathname.replace("/2010-04-01/Accounts/AC_test", "");
  if (p === ".json") return J({ friendly_name: "HP", type: "Full", status: "active" });
  if (p === "/Keys.json") return J({ sid: "SK1", secret: "sekret" });
  if (p === "/Applications.json") return J({ sid: "AP1" });
  if (p.startsWith("/AvailablePhoneNumbers")) return J({ available_phone_numbers: [{ phone_number: "+13055550101", friendly_name: "(305) 555-0101", locality: "Miami", region: "FL" }] });
  if (p === "/IncomingPhoneNumbers.json" && o.method === "POST") return J({ sid: "PN1", phone_number: body.PhoneNumber });
  if (p === "/Calls.json" && o.method === "POST") return J({ sid: "CA_p" + (++callN) });
  return J({});
};
const jars = {};
async function call(who, path, { method = "GET", body, form } = {}) {
  const h = {}; if (jars[who]) h.cookie = jars[who];
  let b; if (body !== undefined) { b = JSON.stringify(body); h["content-type"] = "application/json"; }
  if (form) { b = new URLSearchParams(form).toString(); h["content-type"] = "application/x-www-form-urlencoded"; }
  const waits = [];
  const r = await onRequest({ request: new Request("https://desk.example.com" + path, { method, headers: h, body: b }), env, waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  const sc = r.headers.get("set-cookie"); if (sc) jars[who] = sc.split(";")[0];
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { s: r.status, j };
}
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) process.exitCode = 1; };

let r = await call("x", "/api/auth/me"); ok(r.s === 401, "signed out → 401");
r = await call("x", "/api/docs/leads"); ok(r.s === 401, "docs need sign-in");
r = await call("rep", "/api/auth/signup", { method: "POST", body: { email: "rep@hp.com", password: "password1", name: "Rep One", invite: "nope" } }); ok(r.s === 403, "wrong team code refused");
r = await call("rep", "/api/auth/signup", { method: "POST", body: { email: "rep@hp.com", password: "password1", name: "Rep One", invite: "HP2026" } }); ok(r.s === 200 && jars.rep, "agent signs up with code");
r = await call("boss", "/api/auth/signup", { method: "POST", body: { email: "boss@hp.com", password: "password2", name: "Boss" } }); ok(r.s === 200 && r.j.user.admin, "admin signs up without code");
r = await call("rep2", "/api/auth/login", { method: "POST", body: { email: "rep@hp.com", password: "wrongpass" } }); ok(r.s === 401, "bad password refused");
r = await call("rep2", "/api/auth/login", { method: "POST", body: { email: "rep@hp.com", password: "password1" } }); ok(r.s === 200, "login works");
r = await call("rep", "/api/auth/me"); ok(r.j.user?.name === "Rep One", "me returns user");
// private leads
await call("rep", "/api/docs/leads/L1", { method: "PUT", body: { first: "Ann", phone: "3055550001" } });
r = await call("rep", "/api/docs/leads"); ok(r.j.docs.length === 1 && r.j.docs[0].data.first === "Ann", "agent saves a lead");
const v = r.j.version; r = await call("rep", "/api/docs/leads?v=" + v); ok(r.j.unchanged, "unchanged check");
r = await call("boss", "/api/docs/leads"); ok(r.j.docs.length === 0, "other logins can't see your leads");
r = await call("rep", "/api/docs/_batch", { method: "POST", body: { col: "leads", items: Array.from({ length: 300 }, (_, i) => ({ id: "B" + i, data: { first: "Lead" + i } })) } }); ok(r.j.count === 300, "batch import 300");
// crew shared, own card only
const meId = (await call("rep", "/api/auth/me")).j.user.id;
r = await call("rep", `/api/docs/crew/${meId}`, { method: "PUT", body: { handle: "Rep", stats: { xp: 5 } } }); ok(r.s === 200, "crew card saved");
r = await call("rep", `/api/docs/crew/someoneelse`, { method: "PUT", body: { handle: "x" } }); ok(r.s === 403, "can't edit others' crew card");
r = await call("boss", "/api/docs/crew"); ok(r.j.docs.length === 1, "crew visible to team");
r = await call("boss", "/api/users?ids=" + meId); ok(r.j[meId]?.name === "Rep One", "names resolve");
await call("rep", "/api/room/presence", { method: "POST", body: { status: "On the dialer" } });
r = await call("boss", "/api/room/peers"); ok(r.j.peers.some((p) => p.presence.status === "On the dialer"), "lobby presence");
r = await call("boss", "/api/room/events"); const last = r.j.last; await call("rep", "/api/room/emit", { method: "POST", body: { topic: "props", data: { to: "x" } } });
r = await call("boss", "/api/room/events?after=" + last); ok(r.j.events.length === 1 && r.j.events[0].topic === "props", "props events");
r = await call("rep", "/api/ai", { method: "POST", body: { messages: [{ role: "user", content: "hi" }] } }); ok(r.s === 503, "bot off without key");
// dialer on D1
r = await call("boss", "/api/dialer/setup", { method: "POST" }); ok(r.s === 200 && r.j.ok, "admin connects Twilio");
r = await call("rep", "/api/dialer/token"); ok(r.s === 200 && r.j.token.split(".").length === 3, "voice token");
r = await call("rep", "/api/dialer/numbers/buy", { method: "POST", body: { phoneNumber: "+13055550101" } }); ok(r.s === 200, "buy number");
r = await call("rep", "/api/dialer/numbers"); ok(r.j.numbers?.length === 1, "list numbers");
const wav = new Uint8Array(4000); wav.set(new TextEncoder().encode("RIFF\0\0\0\0WAVE"));
{ const waits = []; const res = await onRequest({ request: new Request("https://desk.example.com/api/dialer/vm/upload?name=Main&sec=9", { method: "POST", headers: { cookie: jars.rep }, body: wav }), env, waitUntil: (p) => waits.push(p) }); const j = await res.json(); ok(j.greeting?.key, "voicemail greeting stored in D1"); env.__g = j.greeting; }
r = await call("rep", "/api/dialer/power/start", { method: "POST", body: { lines: 2 } }); const S = r.j.session; ok(!!S, "power session");
r = await call("rep", "/api/dialer/power/dial", { method: "POST", body: { session: S, leads: [{ id: "a", phone: "2125550001", name: "A" }, { id: "b", phone: "2125550002", name: "B" }] } });
console.log("dial →", JSON.stringify(r.j));
if (r.j.placed?.length === 2) {
  const ans = async (sid) => String((await call("tw", `/api/dialer/power/answer?s=${S}&a=${encodeURIComponent((await call("rep", "/api/auth/me")).j.user.identity)}&b=1`, { method: "POST", form: { CallSid: sid, From: "+13055550101" } })).j);
  const [a1, a2] = [await ans(r.j.placed[0].sid), await ans(r.j.placed[1].sid)];
  ok(/<Conference/.test(a1) && /press 9/.test(a2), "first answer wins on D1, second gets the message");
}
r = await call("rep", "/api/dialer/calls/status", { method: "POST", body: { status: "ready", sec: 120 } }); ok(r.s === 200, "status time saved");
r = await call("rep", "/api/dialer/calls/analytics?days=1"); ok(r.j.total?.statusSec?.ready === 120 && r.j.total.dials >= 1, "analytics on D1");
r = await call("rep", "/api/auth/logout", { method: "POST" }); r = await call("rep", "/api/auth/me"); ok(r.s === 401, "logout");
r = await call("x", "/api/health"); ok(r.j.ok && r.j.db, "health");
