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
r = await call("rep", "/api/auth/signup", { method: "POST", body: { email: "rep@hp.com", password: "password1", name: "Rep One", invite: "nope", agree: true } }); ok(r.s === 403, "wrong team code refused");
r = await call("rep", "/api/auth/signup", { method: "POST", body: { email: "rep@hp.com", password: "password1", name: "Rep One", invite: "HP2026", agree: true } }); ok(r.s === 200 && jars.rep, "agent signs up with code");
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
// calling hours depend on the clock, so the suite opens a 24-hour window (the rules themselves are tested below)
await call("boss", "/api/dialer/setup", { method: "PUT", body: { settings: { quietHours: { start: 0, end: 24 } } } });
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
// ---- privacy + compliance safeguards ----
{
  const { redact } = await import("../src/lib/redact.mjs");
  const red = redact("My social is 123-45-6789 and my account is 4417 2209 1183, routing 0210 0002 1. Call me at 305 555 1234. Card four four one seven two two zero nine. Medicare 1EG4-TE5-MK73, cvv 123");
  ok(!/6789|1183|0002|1EG4|cvv 123/i.test(red) && /305 555 1234/.test(red) && !/four four one seven/.test(red), "redact hides SSN, bank, card, spoken digits, Medicare, CVV but keeps phone numbers");
  const H = await import("../src/lib/hp.mjs");
  const me = (await call("rep", "/api/auth/me")).j.user.identity;
  // inbound recorded calls announce recording
  r = await call("tw", "/api/dialer/voice?in=1", { method: "POST", form: { To: "+13055550101", From: "+12125550009", CallSid: "CA_in1" } });
  ok(/may be recorded/.test(String(r.j)), "inbound recorded call plays the recording notice");
  ok(H.recordNoticeFor({ record: true }, "2125550003") === true && H.recordNoticeFor({ record: false }, "2125550003") === false, "recording notice plays whenever a call is recorded");
  // live transcript lines are stored redacted
  await H.setJ("callidx", "CA_tx1", { agent: me, id: "CA_tx1" }); await H.saveCall({ id: "CA_tx1", sid: "CA_tx1", agent: me, to: "2125550003", at: Date.now() });
  const txEv = (text) => call("tw", "/api/dialer/events?type=tx&c=CA_tx1", { method: "POST", form: { TranscriptionEvent: "transcription-content", TranscriptionData: JSON.stringify({ transcript: text }), Final: "true", Track: "outbound_track" } });
  await txEv("Sure, my social is 123 45 6789.");
  r = await call("rep", "/api/dialer/calls/live?sid=CA_tx1"); ok(r.j.transcript.length === 1 && !/6789/.test(r.j.transcript[0].text), "live transcript stored without the SSN");
  // Telnyx / My phone calls get the same Do Not Call check
  await call("rep", "/api/dialer/calls/dnc", { method: "POST", body: { numbers: ["3055550199"] } });
  r = await call("rep", "/api/dialer/calls/check", { method: "POST", body: { to: "3055550199", leadState: "FL" } }); ok(r.j.ok === false && /Do Not Call/.test(r.j.why), "browser-line calls are blocked for Do Not Call numbers");
  r = await call("rep", "/api/dialer/calls/check", { method: "POST", body: { to: "123" } }); ok(r.j.ok === false, "browser-line calls are blocked for bad numbers");
  // client agreed after the disclosure: the agreement is logged on the call
  r = await call("rep", "/api/dialer/calls/consent", { method: "POST", body: { sid: "CA_tx1" } }); ok(r.j.ok && r.j.recorded === true, "client agreement is logged on the call");
  // client declines recording → transcript erased, new lines ignored, recording deleted
  r = await call("boss", "/api/dialer/calls/privacy", { method: "POST", body: { sid: "CA_tx1" } }); ok(r.s === 200, "admin can stop recording on any call");
  r = await call("rep", "/api/dialer/calls/privacy", { method: "POST", body: { sid: "CA_tx1" } }); ok(r.j.stopped, "agent stops recording when client declines");
  await txEv("This should not be kept.");
  r = await call("rep", "/api/dialer/calls/live?sid=CA_tx1"); ok(r.j.transcript.length === 0, "declined call keeps no transcript");
  const before = log.length;
  await call("tw", "/api/dialer/events?type=rec", { method: "POST", form: { RecordingStatus: "completed", CallSid: "CA_tx1", RecordingSid: "RE_x", RecordingDuration: "30" } });
  ok(log.slice(before).some(([m, p]) => m === "DELETE" && /Recordings\/RE_x/.test(p)), "declined call's recording is deleted at Twilio");
  r = await call("rep", "/api/dialer/calls/recording?sid=CA_tx1"); ok(r.s === 404, "declined call has no playable recording");
  r = await call("rep", "/api/dialer/calls/consent", { method: "POST", body: { sid: "CA_tx1" } }); ok(r.j.recorded === false, "agreement can't be logged after the client declined");
  // Calls to the agent's own cell go through the desk: their cell rings first, then the lead joins the same recorded call
  r = await call("rep", "/api/dialer/setup", { method: "PATCH", body: { cellPhone: "(305) 555-0177" } }); ok(r.j.prefs?.cellPhone === "3055550177", "agent's cell number saved");
  r = await call("boss", "/api/dialer/calls/cell", { method: "POST", body: { to: "2125550009", leadId: "cellA", leadName: "Cell Lead", leadState: "NY" } }); ok(r.s === 400, "no saved cell number, no cell call");
  r = await call("rep", "/api/dialer/calls/cell", { method: "POST", body: { to: "3055550199", leadId: "cellX", leadName: "Blocked", leadState: "FL" } }); ok(r.s === 403, "cell calls obey Do Not Call");
  r = await call("rep", "/api/dialer/calls/cell", { method: "POST", body: { to: "2125550009", leadId: "cellA", leadName: "Cell Lead", leadState: "NY" } });
  ok(r.s === 200 && r.j.ok && /^CA_p/.test(r.j.sid), "cell call placed");
  const cellSid = r.j.sid;
  const cellCall = log.filter(([m, p]) => m === "POST" && p === "/Calls.json").pop()[2];
  const cellTok = (/t=([a-f0-9]+)/.exec(cellCall.Url) || [])[1];
  ok(cellCall.To === "+13055550177" && !!cellTok, "Twilio rings the agent's cell first");
  r = await call("tw", `/api/dialer/voice?step=cell&t=${cellTok}`, { method: "POST", form: { CallSid: "CA_wrong", From: "+13055550177" } });
  ok(!/<Dial/.test(String(r.j)), "a bridge link only works for its own call");
  r = await call("tw", `/api/dialer/voice?step=cell&t=${cellTok}`, { method: "POST", form: { CallSid: cellSid, From: "+13055550177" } });
  const cellTwiml = String(r.j);
  ok(/<Dial[^>]*record="record-from-answer-dual"/.test(cellTwiml) && /\+12125550009/.test(cellTwiml) && /step=notice/.test(cellTwiml), "lead joins the recorded call, after the recording notice");
  ok(/Connecting you to Cell/.test(cellTwiml), "agent hears who they're connecting to");
  r = await call("tw", `/api/dialer/voice?step=cell&t=${cellTok}`, { method: "POST", form: { CallSid: cellSid, From: "+13055550177" } });
  ok(!/<Dial/.test(String(r.j)), "a bridge link works once");
  // on Telnyx numbers the cell bridge is refused, so nothing is sent to Twilio
  env.TELNYX_API_KEY = "tx-test";
  r = await call("rep", "/api/dialer/calls/cell", { method: "POST", body: { to: "2125550009", leadId: "cellT", leadName: "Tx", leadState: "NY" } });
  delete env.TELNYX_API_KEY;
  ok(r.s === 400 && /Twilio/.test(r.j.error || ""), "cell calls are refused on Telnyx numbers");
  // Highpoint Bot never receives sensitive numbers
  env.ANTHROPIC_API_KEY = "sk-test"; const f0 = globalThis.fetch; let sent = "";
  globalThis.fetch = async (u, o = {}) => { if (String(u).includes("anthropic")) { sent = String(o.body); return new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }] }), { status: 200 }); } return f0(u, o); };
  r = await call("rep", "/api/ai", { method: "POST", body: { messages: [{ role: "user", content: "Summarize: her SSN is 123-45-6789, account 4417220911 83" }] } });
  globalThis.fetch = f0; delete env.ANTHROPIC_API_KEY;
  ok(r.s === 200 && sent && !/6789|4417220911/.test(sent), "Highpoint Bot requests are redacted before leaving the server");
}
r = await call("rep", "/api/auth/logout", { method: "POST" }); r = await call("rep", "/api/auth/me"); ok(r.s === 401, "logout");
r = await call("x", "/api/health"); ok(r.j.ok && r.j.db, "health");
