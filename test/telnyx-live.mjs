// Telnyx live transcription, end to end on the server: signed webhooks, one call's lines and speakers,
// who may read a transcript, the client's decline, a new call starting clean, the connection setup,
// and what the admin log shows. Run: node test/telnyx-live.mjs
import { DatabaseSync } from "node:sqlite";
import { onRequest } from "../functions/api/[[path]].js";
import { getJ, setJ, listKeys } from "../src/lib/hp.mjs";

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

const b64 = (buf) => Buffer.from(new Uint8Array(buf)).toString("base64");
const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
const rogue = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
const env = {
  DB, HP_ADMIN_EMAILS: "boss@hp.com", HP_INVITE_CODE: "HP2026", HP_PUBLIC_URL: "https://desk.example.com",
  TELNYX_API_KEY: "KEY_test", TELNYX_PUBLIC_KEY: b64(await crypto.subtle.exportKey("raw", kp.publicKey)),
};

// Fake Telnyx REST API: records every call so the test can check what the server asked for
const telnyx = [];
let FAIL_HOOK = false, NEED_ANSWER = false, credN = 0, REFUSE_ENGINE = "";
const answeredLegs = new Set();
globalThis.fetch = async (url, o = {}) => {
  const u = new URL(url);
  const J = (j, s = 200) => new Response(JSON.stringify(j), { status: s, headers: { "content-type": "application/json" } });
  if (u.hostname !== "api.telnyx.com") return J({}, 500);
  const body = o.body ? JSON.parse(o.body) : undefined;
  const p = u.pathname, m = o.method || "GET";
  telnyx.push({ method: m, path: p, body });
  if (p === "/v2/outbound_voice_profiles") return J({ data: [{ id: "ovp1", name: "HP Outbound", enabled: true }] });
  if (p === "/v2/credential_connections" && m === "POST") return J({ data: { id: "cc1" } });
  if (p.startsWith("/v2/credential_connections/") && m === "GET") return J({ data: { id: p.split("/").pop() } });
  if (p.startsWith("/v2/credential_connections/") && m === "PATCH") return body?.webhook_event_url && FAIL_HOOK ? J({ errors: [{ detail: "webhook fields not allowed" }] }, 400) : J({ data: { id: p.split("/").pop() } });
  if (p === "/v2/call_control_applications" && m === "POST") return J({ data: { id: "app1" } });
  if (p.startsWith("/v2/call_control_applications/")) return J({ data: { id: p.split("/").pop() } });
  // usernames with exactly ten digits, so a SIP address mistaken for a phone number would show up in the tests
  if (p === "/v2/telephony_credentials" && m === "POST") return J({ data: { id: "tc_" + body.name, sip_username: "gencred" + (3055551200 + ++credN) } });
  if (/^\/v2\/telephony_credentials\/[^/]+\/token$/.test(p)) return new Response("tok_" + p.split("/")[3], { status: 200 });
  const cmd = p.match(/^\/v2\/calls\/(.+)\/actions\/([a-z_]+)$/);
  if (cmd) {
    const [, leg, a] = cmd;
    if (a === "answer") answeredLegs.add(leg);
    if (a === "transcription_start" && REFUSE_ENGINE && body?.transcription_engine === REFUSE_ENGINE) return J({ errors: [{ detail: "engine not enabled for this account" }] }, 422);
    if (a === "transfer" && NEED_ANSWER && !answeredLegs.has(leg)) return J({ errors: [{ detail: "Call has not been answered yet" }] }, 422);
    return J({ data: { result: "ok" } });
  }
  if (p.startsWith("/v2/phone_numbers")) return J({ data: [] });
  return J({ data: {} });
};

const jars = {};
async function call(who, path, { method = "GET", body } = {}) {
  const h = {}; if (jars[who]) h.cookie = jars[who];
  let b; if (body !== undefined) { b = JSON.stringify(body); h["content-type"] = "application/json"; }
  const waits = [];
  const r = await onRequest({ request: new Request("https://desk.example.com" + path, { method, headers: h, body: b }), env, waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  const sc = r.headers.get("set-cookie"); if (sc) jars[who] = sc.split(";")[0];
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { s: r.status, j };
}

// Signed like Telnyx: Ed25519 over "<timestamp>|<raw body>"
async function sendEvent(type, payload, { ts = Math.floor(Date.now() / 1000), key = kp.privateKey, sendBody } = {}) {
  const signBody = JSON.stringify({ data: { event_type: type, id: "evt_" + Math.random().toString(36).slice(2), payload } });
  const sig = b64(await crypto.subtle.sign({ name: "Ed25519" }, key, new TextEncoder().encode(`${ts}|${signBody}`)));
  const r = await onRequest({
    request: new Request("https://desk.example.com/api/telnyx/events", { method: "POST", headers: { "content-type": "application/json", "telnyx-timestamp": String(ts), "telnyx-signature-ed25519": sig }, body: sendBody ?? signBody }),
    env, waitUntil: () => {},
  });
  return r.status;
}
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) process.exitCode = 1; };
const starts = () => telnyx.filter((x) => x.path.endsWith("/actions/transcription_start"));
const stops = () => telnyx.filter((x) => x.path.endsWith("/actions/transcription_stop"));

// ---- accounts ----
await call("rep", "/api/auth/signup", { method: "POST", body: { email: "rep@hp.com", password: "password1", name: "Rep One", invite: "HP2026", agree: true } });
await call("rep3", "/api/auth/signup", { method: "POST", body: { email: "rep3@hp.com", password: "password3", name: "Rep Three", invite: "HP2026", agree: true } });
await call("boss", "/api/auth/signup", { method: "POST", body: { email: "boss@hp.com", password: "password2", name: "Boss" } });

// ---- 1. signature rules ----
const outgoing = { direction: "outgoing", from: "+13055550999", to: "+13055550001", call_control_id: "v3:x1", call_session_id: "sA" };
ok(await sendEvent("call.initiated", outgoing, { ts: Math.floor(Date.now() / 1000) - 900 }) === 401, "an event older than five minutes is refused");
ok(await sendEvent("call.initiated", outgoing, { key: rogue.privateKey }) === 401, "an event signed with another key is refused");
const unsigned = await onRequest({ request: new Request("https://desk.example.com/api/telnyx/events", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), env, waitUntil: () => {} });
ok(unsigned.status === 401, "an unsigned POST to the events URL gets 401");
ok(await sendEvent("call.initiated", outgoing, { sendBody: '{"data":{"event_type":"call.initiated","payload":{"to":"+13055550123"}}}' }) === 401, "a changed body is refused");
ok(await sendEvent("call.initiated", outgoing) === 200, "a correctly signed event is accepted");

// ---- 2. one outgoing call: answer starts transcription, both voices arrive labelled ----
ok((await call("rep", "/api/telnyx/claim", { method: "POST", body: { n: "3055550001" } })).s === 200, "the agent claims the lead's call");
ok(await sendEvent("call.answered", { call_control_id: "v3:x1", call_session_id: "sA" }) === 200, "answer event accepted");
const st1 = starts().at(-1);
ok(st1?.path === "/v2/calls/v3:x1/actions/transcription_start", "answering starts transcription on that call");
ok(st1?.body?.transcription_tracks === "both" && st1?.body?.transcription_engine === "Deepgram" && st1?.body?.transcription_engine_config?.transcription_model === "deepgram/nova-3" && st1?.body?.transcription_engine_config?.language === "en", "transcription asks for both tracks with Deepgram Nova-3, English");
ok(st1?.body?.transcription_engine_config?.keyterms?.includes("final expense") && st1.body.transcription_engine_config.keyterms.includes("Mutual of Omaha"), "and is told the insurance words to expect");
ok(st1?.body?.transcription_engine_config?.interim_results === true, "partial lines still stream while someone is talking");
await sendEvent("call.transcription", { call_control_id: "v3:x1", call_session_id: "sA", transcription_data: { transcript: "Hi, this is Ann", is_final: false, confidence: 0.8, track: "inbound" } });
let tr = (await call("rep", "/api/telnyx/transcript?n=3055550001")).j;
ok(tr.partial.length === 1 && tr.partial[0].speaker === "Lead", "a partial line shows while the lead is still talking");
await sendEvent("call.transcription", { call_control_id: "v3:x1", call_session_id: "sA", transcription_data: { transcript: "Hi, this is Ann.", is_final: true, confidence: 0.9, track: "inbound" } });
await sendEvent("call.transcription", { call_control_id: "v3:x1", call_session_id: "sA", transcription_data: { transcript: "Hi Ann, this is Rep calling about your final expense plan.", is_final: true, confidence: 0.9, track: "outbound" } });
tr = (await call("rep", "/api/telnyx/transcript?n=3055550001")).j;
ok(tr.transcript.length === 2 && tr.partial.length === 0, "finished lines are kept and the partial clears");
ok(tr.transcript[0].speaker === "Lead" && tr.transcript[1].speaker === "Agent", "the lead's voice is Lead, the agent's is Agent");
ok(tr.status === "live", "the transcript reports the call is live");

// ---- 3. only the agent on the call (or an admin) can read it ----
ok((await call("rep3", "/api/telnyx/transcript?n=3055550001")).s === 404, "another agent can't read this transcript");
ok((await call("boss", "/api/telnyx/transcript?n=3055550001")).j.transcript.length === 2, "an admin can read it");

// ---- 4. the client declines: transcription stops and what was captured is erased ----
ok((await call("rep3", "/api/telnyx/privacy", { method: "POST", body: { n: "3055550001", declined: true } })).s === 403, "another agent can't answer consent for this call");
ok((await call("rep", "/api/telnyx/privacy", { method: "POST", body: { n: "3055550001", declined: true } })).s === 200, "the agent records a decline");
ok(stops().at(-1)?.path === "/v2/calls/v3:x1/actions/transcription_stop", "a decline stops transcription on the call");
tr = (await call("rep", "/api/telnyx/transcript?n=3055550001")).j;
ok(tr.status === "declined" && tr.transcript.length === 0, "a declined call keeps no lines");
await sendEvent("call.transcription", { call_control_id: "v3:x1", call_session_id: "sA", transcription_data: { transcript: "Still talking", is_final: true, track: "inbound" } });
tr = (await call("rep", "/api/telnyx/transcript?n=3055550001")).j;
ok(tr.transcript.length === 0, "lines that arrive after a decline are dropped");

// ---- 5. a new call starts clean, even for the same lead ----
await sendEvent("call.initiated", { direction: "incoming", from: "+13055550001", to: "+13055559999", call_control_id: "v3:x2", call_session_id: "sB" });
ok((await call("rep", "/api/telnyx/claim", { method: "POST", body: { n: "3055550001" } })).s === 200, "the agent answers the new inbound call");
await sendEvent("call.answered", { call_control_id: "v3:x2", call_session_id: "sB" });
ok(starts().at(-1)?.path === "/v2/calls/v3:x2/actions/transcription_start", "the new call gets its own transcription");
// ---- 5b. if Telnyx refuses the best engine, the next one takes over so the call still gets a transcript ----
{
  REFUSE_ENGINE = "Deepgram";
  const n0 = starts().length;
  await sendEvent("call.initiated", { direction: "incoming", from: "+13055550002", to: "+13055559999", call_control_id: "v3:x9", call_session_id: "sF" });
  await call("rep", "/api/telnyx/claim", { method: "POST", body: { n: "3055550002" } });
  await sendEvent("call.answered", { call_control_id: "v3:x9", call_session_id: "sF" });
  const tried = starts().slice(n0).map((x) => x.body.transcription_engine + (x.body.transcription_engine_config?.model ? "/" + x.body.transcription_engine_config.model : ""));
  ok(tried[0] === "Deepgram" && tried[1] === "Google/phone_call", "Deepgram refused, so Google's phone-call model is tried next: " + tried.join(" > "));
  ok(starts().slice(n0).at(-1)?.body?.transcription_engine_config?.hints?.includes("final expense"), "the fallback keeps the insurance word list");
  const tl = (await call("rep", "/api/telnyx/transcript?n=3055550002")).j;
  ok(tl.status !== "off", "the call still counts as transcribing after the fallback");
  REFUSE_ENGINE = "";
}
ok((await call("rep3", "/api/telnyx/claim", { method: "POST", body: { n: "3055550001" } })).s === 409, "another agent can't take over a live call's transcript");
ok((await call("rep3", "/api/telnyx/transcript?n=3055550001")).s === 404, "and still can't read it");
await sendEvent("call.transcription", { call_control_id: "v3:x2", call_session_id: "sB", transcription_data: { transcript: "Yes, I'm still here", is_final: true, track: "inbound" } });
tr = (await call("rep", "/api/telnyx/transcript?n=3055550001")).j;
ok(tr.transcript.length === 1 && tr.transcript[0].text === "Yes, I'm still here" && tr.status === "live", "the new call shows only its own lines");
await sendEvent("call.hangup", { call_control_id: "v3:x2", call_session_id: "sB" });
ok((await call("rep", "/api/telnyx/transcript?n=3055550001")).j.status === "ended", "hanging up marks the transcript ended");
ok((await call("rep3", "/api/telnyx/claim", { method: "POST", body: { n: "3055550001" } })).s === 200, "once the call has ended, another agent may take the number");
ok((await call("rep", "/api/telnyx/claim", { method: "POST", body: { n: "3055550001" } })).s === 409, "and the earlier agent can't take it back during that agent's new call");

// ---- 6. the connection setup asks Telnyx for the webhook, and falls back if it's refused ----
ok((await call("boss", "/api/telnyx/setup", { method: "POST" })).s === 200, "admin presses Connect");
const hookBody = telnyx.filter((x) => x.path === "/v2/credential_connections" && x.method === "POST").at(-1)?.body;
ok(hookBody?.webhook_event_url === "https://desk.example.com/api/telnyx/events" && hookBody?.webhook_api_version === "2", "the connection points Telnyx at our events URL");
FAIL_HOOK = true;
ok((await call("boss", "/api/telnyx/setup", { method: "POST" })).s === 200, "Connect still works if Telnyx refuses the webhook fields");
ok(!!(await call("boss", "/api/telnyx/log")).j.hookErr, "the refusal is recorded for the admin");
FAIL_HOOK = false;
await call("boss", "/api/telnyx/setup", { method: "POST" });
ok((await call("boss", "/api/telnyx/log")).j.hookErr === null, "a clean Connect clears the recorded refusal");

// ---- 7. the admin log: useful for checking Telnyx's real payloads, without transcript text or full numbers ----
ok((await call("rep", "/api/telnyx/log")).s === 403, "agents can't open the admin log");
const L = (await call("boss", "/api/telnyx/log")).j;
const dump = JSON.stringify(L);
ok(L.publicKey === "ok" && L.webhook === "https://desk.example.com/api/telnyx/events", "the log reports the key and the webhook URL");
ok(L.events.some((e) => e.type === "call.initiated" && e.body?.payload?.to === "…0001"), "the log shows the call event with the number masked");
ok(L.events.some((e) => e.type === "transcription_start" && /started/.test(e.note)), "the log records that transcription started");
ok(!/Hi, this is Ann|Yes, I'm still here|3055550001|3055550999/.test(dump), "no transcript words or full phone numbers appear in the log");
ok(L.events.some((e) => e.type === "call.transcription" && e.body?.transcription_data?.transcript?.startsWith("[")), "the first transcript payloads are logged, with the words hidden");

// ---- 8. a bad signature is recorded so a wrong TELNYX_PUBLIC_KEY is visible ----
ok(L.events.some((e) => e.type === "rejected"), "rejected deliveries are recorded in the log");
ok(L.events.some((e) => e.type === "rejected" && /no telnyx-signature/.test(e.note)), "an unsigned delivery says why it was refused");
ok(L.events.some((e) => e.type === "rejected" && /doesn't match/.test(e.note)), "a wrong signature says why it was refused");

// ---- 9. inbound calls: Telnyx can't ring browsers directly, so we route each call ----
const unjsonT = (s) => { try { return JSON.parse(Buffer.from(String(s), "base64").toString()); } catch { return null; } };
const transfers = (leg) => telnyx.filter((x) => x.path === `/v2/calls/${leg}/actions/transfer`);
const did = (leg, a) => telnyx.filter((x) => x.path === `/v2/calls/${leg}/actions/${a}`);
ok(telnyx.every((x) => !x.path.endsWith("/actions/transfer")), "a call to a number that isn't ours is never routed");
const repId = (await call("rep", "/api/auth/me")).j.user.identity;
const bossId = (await call("boss", "/api/auth/me")).j.user.identity;
ok((await call("rep", "/api/telnyx/token")).s === 200 && (await call("rep3", "/api/telnyx/token")).s === 200, "agents' browser phones get their credentials");
const sipOf = async (id) => `sip:${(await getJ("txcred", id)).sip}@sip.telnyx.com`;
await setJ("numbers", "all", {
  "+13055550101": { e164: "+13055550101", provider: "telnyx", sid: "pn1", owner: repId },
  "+13055550102": { e164: "+13055550102", provider: "telnyx", sid: "pn2" },
  "+13055550103": { e164: "+13055550103", provider: "telnyx", sid: "pn3", owner: bossId },
});
await call("boss", "/api/telnyx/setup", { method: "POST" });
ok(telnyx.some((x) => x.method === "PATCH" && x.path === "/v2/phone_numbers/pn1" && x.body?.connection_id === "app1"), "Connect points the numbers at the inbound Call Control app");
const appReq = telnyx.filter((x) => x.path.startsWith("/v2/call_control_applications") && x.body).at(-1);
ok(appReq?.body?.webhook_event_url === "https://desk.example.com/api/telnyx/events" && appReq?.body?.webhook_api_version === "2", "the inbound app sends its call events to our webhook");
ok(telnyx.filter((x) => x.path.startsWith("/v2/credential_connections/") && x.method === "PATCH").at(-1)?.body?.sip_uri_calling_preference === "internal", "the browser connection accepts calls from our own app");

// A. the number's owner picks up
ok(await sendEvent("call.initiated", { direction: "incoming", from: "+13055550777", to: "+13055550101", call_control_id: "in1", call_session_id: "S1" }) === 200, "an inbound call event is accepted");
const t1 = transfers("in1").at(-1);
ok(transfers("in1").length === 1 && t1.body.to === await sipOf(repId), "the owner's browser rings");
ok(t1.body.from === "+13055550777" && unjsonT(t1.body.target_leg_client_state)?.i === 0, "the agent sees the caller's number, and the ring attempt is tagged");
ok((await getJ("calls", `${repId}/S1`))?.dir === "in", "the inbound call is logged for the owner");
await sendEvent("call.initiated", { direction: "outgoing", from: "+13055550777", to: t1.body.to, call_control_id: "b1", call_session_id: "S1", client_state: t1.body.target_leg_client_state });
ok((await getJ("txcc", "b1"))?.lead === "3055550777", "the leg ringing the agent belongs to the caller's call (not a number read out of the SIP address)");
await call("rep", "/api/telnyx/claim", { method: "POST", body: { n: "3055550777" } });
await sendEvent("call.answered", { call_control_id: "b1", call_session_id: "S1", client_state: t1.body.target_leg_client_state });
ok(starts().at(-1)?.path === "/v2/calls/in1/actions/transcription_start", "when the agent answers, the caller's leg is transcribed");
await sendEvent("call.transcription", { call_control_id: "in1", call_session_id: "S1", transcription_data: { transcript: "Hi, I'm returning your call", is_final: true, track: "inbound" } });
tr = (await call("rep", "/api/telnyx/transcript?n=3055550777")).j;
ok(tr.transcript.length === 1 && tr.transcript[0].speaker === "Lead", "the caller's words show as Lead");
await sendEvent("call.hangup", { call_control_id: "b1", call_session_id: "S1", hangup_cause: "normal_clearing", client_state: t1.body.target_leg_client_state });
ok(did("in1", "hangup").length === 1, "when the agent hangs up, the caller's leg ends too");
await sendEvent("call.hangup", { call_control_id: "in1", call_session_id: "S1", hangup_cause: "normal_clearing" });
const c1 = await getJ("calls", `${repId}/S1`);
ok(c1?.final && c1.answered && c1.status === "completed", "the call log shows an answered inbound call");

// B. a team number, on an account that wants calls answered before a transfer; the first agent doesn't pick up
NEED_ANSWER = true;
await sendEvent("call.initiated", { direction: "incoming", from: "+13055550888", to: "+13055550102", call_control_id: "in2", call_session_id: "S2" });
ok(did("in2", "answer").length === 1, "if Telnyx wants the call answered before a transfer, we answer it");
await sendEvent("call.answered", { call_control_id: "in2", call_session_id: "S2" });
let t2 = transfers("in2");
ok(t2.length === 2 && unjsonT(t2[1].body.target_leg_client_state)?.i === 0, "after answering, the first agent rings");
await sendEvent("call.hangup", { call_control_id: "b2a", call_session_id: "S2", hangup_cause: "timeout", client_state: t2[1].body.target_leg_client_state });
t2 = transfers("in2");
ok(t2.length === 3 && t2[2].body.to !== t2[1].body.to && unjsonT(t2[2].body.target_leg_client_state)?.i === 1, "when the first agent doesn't pick up, the next agent rings");
await sendEvent("call.hangup", { call_control_id: "b2a", call_session_id: "S2", hangup_cause: "timeout", client_state: t2[1].body.target_leg_client_state });
ok(transfers("in2").length === 3 && did("in2", "speak").length === 0 && (await listKeys("inbox", "_team/")).length === 0, "a repeated event for an earlier attempt is ignored (no extra ring, no false missed call)");
await sendEvent("call.answered", { call_control_id: "b2b", call_session_id: "S2", client_state: t2[2].body.target_leg_client_state });
ok(starts().at(-1)?.path === "/v2/calls/in2/actions/transcription_start", "the second agent picks up and the call is transcribed");
NEED_ANSWER = false;

// C. nobody can take it (the owner has never opened the browser phone)
await sendEvent("call.initiated", { direction: "incoming", from: "+13055550999", to: "+13055550103", call_control_id: "in3", call_session_id: "S3" });
ok(did("in3", "answer").length === 1 && transfers("in3").length === 0, "with no agent to ring, we answer instead of letting the call fail");
const missedKeys = await listKeys("inbox", bossId + "/");
ok(missedKeys.length === 1 && (await getJ("inbox", missedKeys[0]))?.kind === "missed", "a missed call is logged for the number's owner");
await sendEvent("call.answered", { call_control_id: "in3", call_session_id: "S3" });
ok(/call you back/.test(did("in3", "speak").at(-1)?.body?.payload || ""), "the caller hears that someone will call back");
await sendEvent("call.speak.ended", { call_control_id: "in3", call_session_id: "S3" });
ok(did("in3", "hangup").length === 1, "then the call ends");
await sendEvent("call.hangup", { call_control_id: "in3", call_session_id: "S3", hangup_cause: "normal_clearing" });
const c3 = await getJ("calls", `${bossId}/S3`);
ok(c3?.final && !c3.answered && c3.status === "no-answer", "the call log shows a missed inbound call");
ok((await listKeys("inbox", bossId + "/")).length === 1, "the missed call is logged only once");

// D. the caller gives up while an agent is ringing
await sendEvent("call.initiated", { direction: "incoming", from: "+13055550666", to: "+13055550101", call_control_id: "in4", call_session_id: "S4" });
await sendEvent("call.hangup", { call_control_id: "in4", call_session_id: "S4", hangup_cause: "originator_cancel" });
const t4 = transfers("in4");
await sendEvent("call.hangup", { call_control_id: "b4", call_session_id: "S4", hangup_cause: "originator_cancel", client_state: t4.at(-1)?.body?.target_leg_client_state });
ok(transfers("in4").length === 1, "once the caller hangs up, nobody else is rung");
ok((await listKeys("inbox", repId + "/")).length === 1, "and it's logged as a missed call for the owner");

console.log("done");
