// WAVV server half: minting a user token with the SDK key, and verifying + recording WAVV's webhooks.
// Run: node test/wavv.mjs
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { onRequest } from "../functions/api/[[path]].js";
import { getJ, store } from "../src/lib/hp.mjs";
import { verifySignature } from "../src/wavv/wavv.mjs";

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
const env = { DB, HP_ADMIN_EMAILS: "boss@hp.com", HP_INVITE_CODE: "HP2026", HP_PUBLIC_URL: "https://desk.example.com" };

// Fake WAVV API
const wavv = []; let wavvStatus = 201, n = 0;
globalThis.fetch = async (url, o = {}) => {
  const u = new URL(url);
  if (u.hostname !== "api.wavv.com") return new Response("{}", { status: 500 });
  wavv.push({ path: u.pathname, auth: new Headers(o.headers).get("authorization"), body: o.body ? JSON.parse(o.body) : undefined });
  return new Response(JSON.stringify(wavvStatus === 201 ? { token: "tok_" + ++n, expiresIn: 60 } : { error: "no", code: wavvStatus === 401 ? "INVALID_API_KEY" : "SERVER_ERROR" }), { status: wavvStatus, headers: { "content-type": "application/json" } });
};
const jars = {};
async function call(who, path, { method = "GET", body, headers = {}, raw } = {}) {
  const h = { ...headers }; if (jars[who]) h.cookie = jars[who];
  let b = raw; if (raw === undefined && body !== undefined) { b = JSON.stringify(body); h["content-type"] = "application/json"; }
  const waits = [];
  const r = await onRequest({ request: new Request("https://desk.example.com" + path, { method, headers: h, body: b }), env, waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  const sc = r.headers.get("set-cookie"); if (sc) jars[who] = sc.split(";")[0];
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { s: r.status, j };
}
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) process.exitCode = 1; };
const sign = (raw, secret, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${crypto.createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex")}`;

await call("rep", "/api/auth/signup", { method: "POST", body: { email: "rep@hp.com", password: "password1", name: "Rep One", invite: "HP2026", agree: true } });
const rep = (await call("rep", "/api/auth/me")).j.user.identity;

// ---- not connected yet ----
ok((await call("rep", "/api/wavv/status")).j.configured === false, "status says WAVV is not connected before the key is added");
const r0 = await call("rep", "/api/wavv/token", { method: "POST" });
ok(r0.s === 503 && /WAVV_SDK_KEY/.test(r0.j.error), "asking for a token without a key explains what to add");
ok((await call(null, "/api/wavv/token", { method: "POST" })).s === 401, "a signed-out visitor cannot mint a token");

// ---- token minting ----
env.WAVV_SDK_KEY = "wavv_SECRETKEY";
ok((await call("rep", "/api/wavv/status")).j.configured === true, "status turns on once the key is set");
const t1 = await call("rep", "/api/wavv/token", { method: "POST" });
ok(t1.s === 200 && t1.j.token === "tok_1" && t1.j.expiresIn === 60, "an agent gets a token");
ok(wavv[0].path === "/v3/tokens" && wavv[0].auth === "Bearer wavv_SECRETKEY", "the server calls WAVV /tokens with the SDK key as a Bearer token");
ok(wavv[0].body.userId === rep && Object.keys(wavv[0].body).length === 1, "the WAVV user id is the agent's own stable id");
const t2 = await call("rep", "/api/wavv/token", { method: "POST" });
ok(t2.j.token === "tok_2" && wavv.length === 2, "every page load mints a fresh token (nothing is cached)");
ok(!JSON.stringify([t1, t2]).includes("SECRETKEY"), "the SDK key never appears in a response");
wavvStatus = 401;
const bad401 = await call("rep", "/api/wavv/token", { method: "POST" });
ok(bad401.s === 502 && /INVALID_API_KEY/.test(bad401.j.error) && !JSON.stringify(bad401).includes("SECRETKEY"), "a rejected key is reported without leaking it");
wavvStatus = 500;
ok((await call("rep", "/api/wavv/token", { method: "POST" })).s === 502, "a WAVV outage is a clear 502");
wavvStatus = 201;

// ---- signatures ----
const SECRET = "whsec_test123";
const body = (event, data) => JSON.stringify({ event, sentAt: new Date().toISOString(), data });
const call0 = { id: "3c9a17b4-2f5e-4d81-b0a7-6e2c9d4f1a03", userId: rep, direction: "outbound", phone: "5125551234", callerId: "5125559876", contactId: "L99213", contactName: "Dana Reyes", startedAt: "2026-05-21T14:28:12Z", answeredAt: null, endedAt: null, seconds: null, outcome: "UNKNOWN", disposition: null, human: null, note: null, summary: null, recorded: false, campaignId: null };
const hook = (raw, sig) => call("wh", "/api/wavv/events", { method: "POST", raw, headers: { "x-wavv-signature": sig } });
ok((await hook(body("call.started", call0), sign("x", SECRET))).s === 503, "webhooks are refused until the signing secret is set");
env.WAVV_WEBHOOK_SECRET = SECRET;
const rawStart = body("call.started", call0);
ok((await hook(rawStart, "")).s === 401, "no signature is refused");
ok((await hook(rawStart, sign(rawStart, "whsec_other"))).s === 401, "the wrong secret is refused");
ok((await hook(rawStart, sign(rawStart, SECRET, Math.floor(Date.now() / 1000) - 3600))).s === 401, "a replayed (old) delivery is refused");
ok((await hook(rawStart + " ", sign(rawStart, SECRET))).s === 401, "a changed body is refused");
ok(verifySignature("{}", "t=abc,v1=zz", SECRET) === false, "a garbled header is refused, not a crash");
ok(!(await getJ("callidx", "wv_" + call0.id)), "nothing was recorded by the refused deliveries");

// ---- a call's life ----
ok((await hook(rawStart, sign(rawStart, SECRET))).s === 200, "a signed call.started is accepted");
let rec = await getJ("calls", `${rep}/wv_${call0.id}`);
ok(rec && rec.mode === "wavv" && rec.dir === "out" && rec.to === "5125551234" && rec.leadId === "L99213" && rec.status === "dialing", "it opens a call record against the right agent and lead");
const ended = { ...call0, answeredAt: "2026-05-21T14:28:19Z", endedAt: "2026-05-21T14:30:00Z", seconds: 101, outcome: "HUNG_UP", disposition: "Interested", human: true, note: "Sending pricing.", recorded: true };
const rawEnd = body("call.ended", ended);
ok((await hook(rawEnd, sign(rawEnd, SECRET))).s === 200, "a signed call.ended is accepted");
rec = await getJ("calls", `${rep}/wv_${call0.id}`);
ok(rec.status === "completed" && rec.answered && rec.talkSec === 101 && rec.human && rec.final && rec.disposition === "Interested" && rec.note === "Sending pricing.", "the ended call carries talk time, human, disposition and note");
const DAY = "2026-05-21"; // stats are filed under the day the call started
const stat = await getJ("stats", `${DAY}/a/${rep}`);
ok(stat?.dials === 1 && stat?.connects === 1, "the agent's day counts one dial and one connect");
await hook(rawEnd, sign(rawEnd, SECRET));
const stat2 = await getJ("stats", `${DAY}/a/${rep}`);
ok(stat2?.connects === 1, "the same event delivered twice is counted once");
const rawRec = body("call.recorded", { ...ended, recordingUrl: "https://recordings.wavv.com/x?sig=abc", summary: "Asked for pricing." });
await hook(rawRec, sign(rawRec, SECRET));
rec = await getJ("calls", `${rep}/wv_${call0.id}`);
ok(rec.wavvRecorded === true && rec.summary === "Asked for pricing." && !JSON.stringify(rec).includes("sig=abc"), "recording is flagged and the 72-hour signed URL is not kept");

// out of order, voicemail, do-not-call, inbound
const c2 = { ...call0, id: "aaaaaaaa-0000-4000-8000-000000000002", phone: "5125550002", contactId: "L2" };
const raw2 = body("call.ended", { ...c2, endedAt: "2026-05-21T15:00:30Z", seconds: 0, outcome: "VOICEMAIL", human: false });
await hook(raw2, sign(raw2, SECRET));
let r2 = await getJ("calls", `${rep}/wv_${c2.id}`);
ok(r2 && r2.status === "no-answer" && r2.machine && !r2.answered, "call.ended arriving first still makes a record; a voicemail is No answer");
const c3 = { ...call0, id: "aaaaaaaa-0000-4000-8000-000000000003", phone: "5125550003", contactId: "L3", answeredAt: "2026-05-21T15:10:00Z", endedAt: "2026-05-21T15:10:40Z", seconds: 40, outcome: "HUNG_UP", human: true, disposition: "Do Not Call" };
const raw3 = body("call.ended", c3);
await hook(raw3, sign(raw3, SECRET));
ok(!!(await getJ("dnc", "5125550003")), "a Do Not Call disposition in WAVV lands on the desk's DNC list");
const c4 = { ...call0, id: "aaaaaaaa-0000-4000-8000-000000000004", direction: "inbound", phone: "5125559876", callerId: "5125557777", contactId: null, contactName: null };
const raw4 = body("call.incoming", c4);
await hook(raw4, sign(raw4, SECRET));
const r4 = await getJ("calls", `${rep}/wv_${c4.id}`);
ok(r4 && r4.dir === "in" && r4.to === "5125557777", "an inbound call is recorded with the caller as the other party");

// messages
ok(stat2?.billMin === 2, "talk time is counted in the agent's stats (101 seconds = 2 minutes)");
const m = { id: "m1", userId: rep, contactId: "L99213", direction: "inbound", contactNumber: "5125551234", body: "Can we talk Thursday?" };
const rawM = body("message.received", m);
ok((await hook(rawM, sign(rawM, SECRET))).s === 200, "a text message event is accepted");
const keys = await store("wavvmsg").list({ prefix: rep + "/" });
ok((keys.blobs || []).length === 1, "the text is stored for the agent");
