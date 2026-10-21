// Voicemail detection on browser calls, end to end on the server: the parked browser leg, the dial to the lead with
// Telnyx AMD, a person connecting, a mailbox never reaching the agent (logged No answer), unsure results, webhook order,
// the auto voicemail drop at the beep, and the fallbacks. Run: node test/amd.mjs
import { DatabaseSync } from "node:sqlite";
import { onRequest } from "../functions/api/[[path]].js";
import { getJ, setJ, patchCallBySid } from "../src/lib/hp.mjs";

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
const env = {
  DB, HP_ADMIN_EMAILS: "boss@hp.com", HP_INVITE_CODE: "HP2026", HP_PUBLIC_URL: "https://desk.example.com",
  TELNYX_API_KEY: "KEY_test", TELNYX_PUBLIC_KEY: b64(await crypto.subtle.exportKey("raw", kp.publicKey)),
};

// Fake Telnyx REST API: records every request so the test can check what the server asked for
const telnyx = [];
let NO_PREMIUM = false, FAIL_BRIDGE = 0, FAIL_DIAL = false, dialN = 0;
globalThis.fetch = async (url, o = {}) => {
  const u = new URL(url);
  const J = (j, s = 200) => new Response(JSON.stringify(j), { status: s, headers: { "content-type": "application/json" } });
  if (u.hostname !== "api.telnyx.com") return J({}, 500);
  const body = o.body ? JSON.parse(o.body) : undefined;
  const p = u.pathname, m = o.method || "GET";
  telnyx.push({ method: m, path: p, body });
  if (p === "/v2/outbound_voice_profiles") return J({ data: [{ id: "ovp1", name: "HP Outbound", enabled: true }] });
  if (p === "/v2/credential_connections" && m === "POST") return J({ data: { id: "cc1" } });
  if (p.startsWith("/v2/credential_connections/")) return J({ data: { id: p.split("/").pop() } });
  if (p === "/v2/call_control_applications" && m === "POST") return J({ data: { id: "app1" } });
  if (p.startsWith("/v2/call_control_applications/")) return J({ data: { id: p.split("/").pop() } });
  if (p === "/v2/calls" && m === "POST") {
    if (NO_PREMIUM && body.answering_machine_detection === "premium") return J({ errors: [{ detail: "Premium answering machine detection is not enabled for this account" }] }, 422);
    if (FAIL_DIAL) return J({ errors: [{ detail: "Invalid destination number" }] }, 422);
    return J({ data: { call_control_id: "lead" + ++dialN, call_session_id: "linked" } });
  }
  const cmd = p.match(/^\/v2\/calls\/(.+)\/actions\/([a-z_]+)$/);
  if (cmd) {
    if (cmd[2] === "bridge" && FAIL_BRIDGE > 0) { FAIL_BRIDGE--; return J({ errors: [{ detail: "Call is not answered yet" }] }, 422); }
    return J({ data: { result: "ok" } });
  }
  if (p.startsWith("/v2/phone_numbers")) return J({ data: [] });
  return J({ data: {} });
};

const jars = {};
async function call(who, path, { method = "GET", body, raw } = {}) {
  const h = {}; if (jars[who]) h.cookie = jars[who];
  let b; if (raw) b = raw; else if (body !== undefined) { b = JSON.stringify(body); h["content-type"] = "application/json"; }
  const waits = [];
  const r = await onRequest({ request: new Request("https://desk.example.com" + path, { method, headers: h, body: b }), env, waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  const sc = r.headers.get("set-cookie"); if (sc) jars[who] = sc.split(";")[0];
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { s: r.status, j };
}
async function sendEvent(type, payload, { signed = true } = {}) {
  const ts = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ data: { event_type: type, id: "evt_" + Math.random().toString(36).slice(2), payload } });
  const sig = b64(await crypto.subtle.sign({ name: "Ed25519" }, kp.privateKey, new TextEncoder().encode(`${ts}|${body}`)));
  const headers = { "content-type": "application/json", ...(signed ? { "telnyx-timestamp": String(ts), "telnyx-signature-ed25519": sig } : {}) };
  const r = await onRequest({ request: new Request("https://desk.example.com/api/telnyx/events", { method: "POST", headers, body }), env, waitUntil: () => {} });
  return r.status;
}
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) process.exitCode = 1; };
const did = (leg, a) => telnyx.filter((x) => x.path === `/v2/calls/${leg}/actions/${a}`);
const dials = () => telnyx.filter((x) => x.path === "/v2/calls" && x.method === "POST");
const unb64 = (s) => { try { return JSON.parse(Buffer.from(String(s), "base64").toString()); } catch { return null; } };

// ---- accounts, a number, Connect ----
await call("rep", "/api/auth/signup", { method: "POST", body: { email: "rep@hp.com", password: "password1", name: "Rep One", invite: "HP2026", agree: true } });
await call("boss", "/api/auth/signup", { method: "POST", body: { email: "boss@hp.com", password: "password2", name: "Boss" } });
const repId = (await call("rep", "/api/auth/me")).j.user.identity;
await setJ("numbers", "all", { "+13055550101": { e164: "+13055550101", provider: "telnyx", sid: "pn1", owner: repId, areaCode: "305", state: "FL", days: {} } });
await call("boss", "/api/dialer/setup", { method: "PUT", body: { settings: { quietHours: { start: 0, end: 24 }, stateRules: {} } } });
ok((await call("boss", "/api/telnyx/setup", { method: "POST" })).s === 200, "admin presses Connect");
ok((await call("boss", "/api/telnyx/log")).j.voicemailDetection === "on", "the admin log shows voicemail detection is on");

// The desk opens the call record, then the browser's call arrives parked on the credential connection
let legN = 0;
async function browserCall(lead, { ps = false, name = "Ann Lee" } = {}) {
  const r = await call("rep", "/api/dialer/calls/start", { method: "POST", body: { to: lead, leadId: "L" + lead, leadName: name, leadState: "NY", ps } });  const n = ++legN, web = "web" + n, sess = "sess" + n;
  const before = dials().length;
  const st = await sendEvent("call.initiated", { direction: "outgoing", state: "parked", from: "+13055550101", to: "+1" + lead, call_control_id: web, call_session_id: sess, connection_id: "cc1" });
  const d = dials().length > before ? dials().at(-1) : null;
  const leg = d ? "lead" + dialN : "";
  const lp = { direction: "outgoing", from: "+13055550101", to: "+1" + lead, call_control_id: leg, call_session_id: sess, client_state: d?.body?.client_state };
  return { sid: r.j.sid, web, sess, leg, dial: d, st, lp, row: () => getJ("calls", `${repId}/${r.j.sid}`) };
}

// ---- A. a person answers ----
const A = await browserCall("2125550001");
ok(A.st === 200 && A.dial, "a parked browser call makes the server dial the lead");ok(A.dial.body.to === "+12125550001" && A.dial.body.from === "+13055550101" && A.dial.body.link_to === A.web && A.dial.body.connection_id === "app1", "the dial goes to the lead from the agent's caller ID, linked to the agent's leg");
ok(A.dial.body.answering_machine_detection === "premium", "the dial asks for premium answering machine detection");
ok(A.dial.body.answering_machine_detection_config?.greeting_duration_millis === 3000 && A.dial.body.answering_machine_detection_config?.total_analysis_time_millis === 5000, "detection is tuned to decide fast (3 s greeting, 5 s cap)");
ok(unb64(A.dial.body.client_state)?.amd === A.web && A.dial.body.webhook_url === "https://desk.example.com/api/telnyx/events", "the lead's leg is tagged and reports to the same signed webhook");
await sendEvent("call.initiated", A.lp);
await sendEvent("call.answered", A.lp);
ok(!did(A.web, "answer").length && !did(A.web, "bridge").length, "while detection runs the agent isn't connected (their ringer keeps going)");
ok(!did(A.leg, "record_start").length, "nothing is recorded before detection decides");
await sendEvent("call.machine.premium.detection.ended", { ...A.lp, result: "human_residence" });
ok(did(A.web, "answer").length === 1 && did(A.web, "bridge").at(-1)?.body?.call_control_id === A.leg, "a person: the agent's leg is answered and bridged to the lead");
ok(did(A.leg, "record_start").length === 1, "recording starts on the lead's leg once a person is detected");
const trStarts = [...did(A.leg, "transcription_start"), ...did(A.web, "transcription_start")];
ok(did(A.leg, "transcription_start").length === 1 && did(A.web, "transcription_start").length === 1, "each leg is transcribed on its own: the lead's phone and the agent's browser");
ok(trStarts.every((x) => x.body.transcription_tracks === "inbound"), "each leg transcribes only its own incoming audio");
const trLine = (leg, text) => sendEvent("call.transcription", { ...A.lp, call_control_id: leg, transcription_data: { transcript: text, is_final: true, confidence: 0.9 } });
await trLine(A.leg, "Hello who is this"); await trLine(A.web, "Hi this is Alex with Highpoint");
const tl = (await getJ("txlive", "2125550001"))?.lines || [];
ok(tl.find((l) => l.text === "Hello who is this")?.speaker === "Lead", "words from the lead's leg are the Lead");
ok(tl.find((l) => l.text === "Hi this is Alex with Highpoint")?.speaker === "Agent", "words from the agent's browser leg are the Agent (you)");
ok(!telnyx.some((x) => /\/actions\/speak$/.test(x.path) && [A.web, A.leg].some((l) => x.path.includes(l))), "no recording announcement is played");
let row = await A.row();
ok(row.amd === "human_residence" && row.answered && row.status === "in-progress" && typeof row.amdMs === "number", "the call row shows a person answered and how long detection took");
ok((await getJ("txlive", "2125550001"))?.ccid === A.leg, "voicemail drop and a client's decline act on the lead's leg");
await sendEvent("call.answered", { direction: "outgoing", from: "+13055550101", to: "+12125550001", call_control_id: A.web, call_session_id: A.sess });
ok(did(A.leg, "record_start").length === 1 && did(A.web, "record_start").length === 0, "the agent's leg answering doesn't start a second recording");
await sendEvent("call.machine.premium.detection.ended", { ...A.lp, result: "machine" });
ok(did(A.web, "answer").length === 1 && !did(A.web, "hangup").length, "a repeated or late detection event changes nothing");
await sendEvent("call.hangup", { direction: "outgoing", call_control_id: A.web, call_session_id: A.sess, hangup_cause: "normal_clearing" });
ok(did(A.leg, "hangup").length === 1, "when the agent hangs up, the lead's leg ends too");
await sendEvent("call.hangup", { ...A.lp, hangup_cause: "normal_clearing" });
await sendEvent("call.recording.saved", { ...A.lp, recording_id: "RE_A", recording_urls: { mp3: "https://s3.example.com/a.mp3" }, duration_millis: 61000 });
row = await A.row();
ok(row.final && row.status === "completed" && row.human && row.recordingUrl === "https://s3.example.com/a.mp3" && row.recordingSid === "RE_A", "the call ends completed, with the recording on the row");

// ---- B. a mailbox, with the detection result arriving before call.answered ----
const B = await browserCall("2125550002");
await sendEvent("call.machine.premium.detection.ended", { ...B.lp, result: "machine" });
ok(!did(B.web, "answer").length && !did(B.web, "bridge").length, "a machine: the agent is never connected");
ok(did(B.web, "hangup").length === 1 && did(B.leg, "hangup").length === 1, "a machine: the agent's ringing stops and the lead's leg hangs up");
row = await B.row();
ok(row.disposition === "No answer" && row.note === "Voicemail detected" && row.machine && row.autoLogged === "voicemail", "the call logs itself No answer · Voicemail detected");
await sendEvent("call.answered", B.lp);
ok(!did(B.web, "answer").length, "a late call.answered for the lead's leg doesn't connect anyone");
await sendEvent("call.hangup", { direction: "outgoing", call_control_id: B.web, call_session_id: B.sess, hangup_cause: "normal_clearing" });
await sendEvent("call.hangup", { ...B.lp, hangup_cause: "normal_clearing" });
row = await B.row();
ok(row.final && row.status === "machine" && row.talkSec === 0 && !row.human && row.answered, "the finished row is a voicemail: answered by a machine, no talk time");
const live = (await call("rep", "/api/dialer/calls/live?sid=" + B.sid)).j;
ok(live.call?.amd === "machine" && live.call?.note === "Voicemail detected", "the desk can see it was a voicemail, so it skips the log popup");
const dispo = await call("rep", "/api/dialer/calls/dispo", { method: "POST", body: { sid: B.sid, disposition: "No answer", note: "Voicemail detected", leadId: "L2125550002" } });
ok(dispo.j.call?.disposition === "No answer" && dispo.j.call?.note === "Voicemail detected", "the desk's auto-log keeps No answer and the note");
ok((await call("rep", "/api/dialer/calls/analytics?days=1")).j.total.machines >= 1, "voicemails count in analytics");

// ---- C. Telnyx isn't sure: the agent is connected ----
const C = await browserCall("2125550003");
await sendEvent("call.answered", C.lp);
await sendEvent("call.machine.premium.detection.ended", { ...C.lp, result: "not_sure" });
ok(did(C.web, "answer").length === 1 && did(C.web, "bridge").length === 1 && !did(C.leg, "hangup").length, "not sure: treated as a person, the agent is connected");
const C2 = await browserCall("2125550013");
await sendEvent("call.machine.premium.detection.ended", { ...C2.lp, result: "silence" });
ok(did(C2.web, "bridge").length === 1, "silence: the agent is connected too (someone may be waiting to hear a voice)");

// ---- D. nobody picks up / busy: the agent's side ends, the row is a no-answer ----
const D = await browserCall("2125550004");
await sendEvent("call.initiated", D.lp);
await sendEvent("call.hangup", { ...D.lp, hangup_cause: "timeout" });
ok(did(D.web, "hangup").length === 1 && !did(D.web, "answer").length, "no answer: the agent's ringing stops");
await sendEvent("call.hangup", { direction: "outgoing", call_control_id: D.web, call_session_id: D.sess, hangup_cause: "normal_clearing" });
row = await D.row();
ok(row.final && row.status === "no-answer" && !row.answered && !row.machine && row.cause === "timeout" && !row.disposition, "no answer stays a plain no-answer for the usual log popup");

// ---- E. the agent hangs up while it's still ringing ----
const E = await browserCall("2125550005");
await sendEvent("call.hangup", { direction: "outgoing", call_control_id: E.web, call_session_id: E.sess, hangup_cause: "originator_cancel" });
ok(did(E.leg, "hangup").length === 1, "the agent cancels: the lead's phone stops ringing");
await sendEvent("call.answered", E.lp);
await sendEvent("call.machine.premium.detection.ended", { ...E.lp, result: "human_residence" });
ok(!did(E.web, "answer").length && !did(E.web, "bridge").length, "a detection result after the agent left connects nothing");

// ---- F. power session with "leave my voicemail automatically": the drop plays at the beep ----
const wav = new Uint8Array(4000); wav.set(new TextEncoder().encode("RIFF\0\0\0\0WAVE"));
const g = (await call("rep", "/api/dialer/vm/upload?name=Main&sec=9", { method: "POST", raw: wav })).j.greeting;
await call("rep", "/api/dialer/setup", { method: "PATCH", body: { autoVm: true, vmGreeting: g.key } });
const F0 = await browserCall("2125550016");
ok(F0.dial.body.answering_machine_detection_config.total_analysis_time_millis === 5000, "outside a power session no drop is planned (short cap)");
const F = await browserCall("2125550006", { ps: true });
ok(F.dial.body.answering_machine_detection_config.total_analysis_time_millis === 30000, "with a drop to play, detection keeps listening for the beep");
await sendEvent("call.answered", F.lp);
await sendEvent("call.machine.premium.detection.ended", { ...F.lp, result: "machine" });
ok(did(F.web, "hangup").length === 1 && !did(F.leg, "hangup").length && !did(F.leg, "playback_start").length, "a machine: the agent is freed, the lead's leg waits for the beep");
await sendEvent("call.hangup", { direction: "outgoing", call_control_id: F.web, call_session_id: F.sess, hangup_cause: "normal_clearing" });
ok(!did(F.leg, "hangup").length, "the agent's leg ending doesn't cut the drop");
await sendEvent("call.machine.premium.greeting.ended", { ...F.lp, result: "beep_detected" });
const pb = did(F.leg, "playback_start");
ok(pb.length === 1 && /\/api\/dialer\/vm\/audio\?/.test(pb[0].body.audio_url), "at the beep the agent's default greeting plays");
row = await F.row();
ok(row.disposition === "No answer" && row.note === "Voicemail detected · VM dropped" && row.vmDropped === g.key, "the row says Voicemail detected · VM dropped");
await sendEvent("call.machine.premium.greeting.ended", { ...F.lp, result: "beep_detected" });
ok(did(F.leg, "playback_start").length === 1, "the drop plays once");
await sendEvent("call.playback.ended", F.lp);
ok(did(F.leg, "hangup").length === 1, "after the drop the lead's leg hangs up");

// ---- G. a beep before detection.ended means a machine ----
const G = await browserCall("2125550007", { ps: true });
await sendEvent("call.machine.premium.greeting.ended", { ...G.lp, result: "beep_detected" });
ok(did(G.web, "hangup").length === 1 && !did(G.web, "answer").length && did(G.leg, "playback_start").length === 1, "beep first: no agent, drop plays");
const G2 = await browserCall("2125550017", { ps: true });
await sendEvent("call.machine.premium.detection.ended", { ...G2.lp, result: "machine" });
await sendEvent("call.hangup", { ...G2.lp, hangup_cause: "normal_clearing" });
ok((await G2.row()).note === "Voicemail detected", "mailbox hung up before the beep: the note doesn't claim a drop");
await call("rep", "/api/dialer/setup", { method: "PATCH", body: { autoVm: false } });

// ---- H. an account without premium detection falls back to standard detection ----
NO_PREMIUM = true;
const H = await browserCall("2125550008");
ok(H.dial?.body?.answering_machine_detection === "detect" && H.dial.body.answering_machine_detection_config.after_greeting_silence_millis === 800, "no premium on the account: standard detection with fast timings");
await sendEvent("call.machine.detection.ended", { ...H.lp, result: "machine" });
ok(did(H.web, "hangup").length === 1 && (await H.row()).note === "Voicemail detected", "standard detection's machine result works the same way");
const H2 = await browserCall("2125550018");
await sendEvent("call.machine.detection.ended", { ...H2.lp, result: "human" });
ok(did(H2.web, "bridge").length === 1, "standard detection's human result connects");
NO_PREMIUM = false;

// ---- I. bridge too early: retried when the agent's leg reports answered ----
FAIL_BRIDGE = 1;
const I = await browserCall("2125550009");
await sendEvent("call.machine.premium.detection.ended", { ...I.lp, result: "human_business" });
ok(did(I.web, "bridge").length === 1, "the first bridge is refused");
await sendEvent("call.answered", { direction: "outgoing", call_control_id: I.web, call_session_id: I.sess });
ok(did(I.web, "bridge").length === 2 && (await getJ("txamd", I.web))?.bridged, "it bridges as soon as the agent's leg is answered");

// ---- J. a parked call the desk never started isn't dialed ----
const before = dials().length;
await sendEvent("call.initiated", { direction: "outgoing", state: "parked", from: "+13055550101", to: "+12125550099", call_control_id: "webX", call_session_id: "sessX" });
ok(dials().length === before && did("webX", "hangup").length === 1, "no call record (no Do Not Call / hours check): the parked call is hung up, not dialed");

// ---- K. same webhook rules as every Telnyx event ----
ok(await sendEvent("call.machine.premium.detection.ended", { ...C.lp, result: "machine" }, { signed: false }) === 401, "an unsigned detection event is refused");

// ---- L. older connections turn parking on when an agent's phone starts ----
const cfg = await getJ("config", "app");
await setJ("config", "app", { ...cfg, tx: { ...cfg.tx, parkAt: null, parkErr: null } });
const n0 = telnyx.filter((x) => x.body?.outbound?.call_parking_enabled === true).length;
ok((await call("rep", "/api/telnyx/token")).s === 200 && telnyx.filter((x) => x.body?.outbound?.call_parking_enabled === true).length === n0 + 1, "a connection set up before this turns on parking the first time a phone signs in");
ok((await getJ("config", "app")).tx.parkAt > 0, "and remembers it");

// ---- M. how each call ended, for the desk: only an answered call gets the log popup; the rest log themselves ----
const outcome = async (X) => (await call("rep", "/api/dialer/calls/live?sid=" + X.sid)).j.call?.outcome;
ok((await outcome(A))?.kind === "answered", "answered: the desk opens the log popup");
let o = await outcome(B);
ok(o?.kind === "voicemail" && o.label === "No answer" && o.note === "Voicemail detected" && o.final, "voicemail: logs itself No answer · Voicemail detected");
o = await outcome(D);
ok(o?.kind === "no-answer" && o.label === "No answer" && o.note === "Rang out", "rang out: logs itself No answer · Rang out");
const M1 = await browserCall("2125550021");
ok((await outcome(M1))?.final === false, "still ringing: the desk is told to wait for the reason");
await sendEvent("call.initiated", M1.lp);
await sendEvent("call.hangup", { ...M1.lp, hangup_cause: "timeout" });
ok((await outcome(M1))?.note === "Rang out" && did(M1.web, "hangup").length === 1, "the reason is saved by the time the agent's ringing stops");
const M2 = await browserCall("2125550022");
await sendEvent("call.hangup", { ...M2.lp, hangup_cause: "user_busy" });
o = await outcome(M2);
ok(o?.kind === "busy" && o.label === "No answer" && o.note === "Busy", "busy: logs itself No answer · Busy");
const M3 = await browserCall("2125550023");
await sendEvent("call.hangup", { ...M3.lp, hangup_cause: "call_rejected", sip_hangup_cause: "486" });
ok((await outcome(M3))?.note === "Busy" && (await M3.row()).sipCause === "486", "a SIP 486 counts as busy too");
const M4 = await browserCall("2125550024");
await sendEvent("call.hangup", { ...M4.lp, hangup_cause: "unallocated_number" });
o = await outcome(M4);
ok(o?.kind === "failed" && o.label === "No answer" && o.note === "Call failed", "a number that doesn't work: logs itself No answer · Call failed");
FAIL_DIAL = true;
const M5 = await browserCall("2125550025");
FAIL_DIAL = false;
ok(did(M5.web, "hangup").length === 1 && (await M5.row()).amd === "dial-failed" && (await outcome(M5))?.note === "Call failed", "Telnyx can't dial the lead: Call failed");
o = await outcome(E);
ok(o?.kind === "cancel" && o.label === "No answer" && o.note === "Agent hung up while ringing" && (await E.row()).agentCancel, "the agent hangs up while it rings: No answer · Agent hung up while ringing");
ok(!(await D.row()).agentCancel && !(await A.row()).agentCancel, "a lead that rang out or a finished call isn't an agent cancel");

// ---- N. the status the desk shows follows the lead, not the agent's parked leg ----
const state = async (X) => (await call("rep", "/api/dialer/calls/live?sid=" + X.sid)).j.call?.leadState;
const N = await browserCall("2125550031");
ok(await state(N) === "dialing", "parked and dialing the lead: Dialing");
await sendEvent("call.answered", { direction: "outgoing", from: "+13055550101", to: "+12125550031", call_control_id: "webZ", call_session_id: N.sess });
await sendEvent("call.initiated", N.lp);
ok(await state(N) === "ringing", "the lead's phone rings: Ringing");
await sendEvent("call.answered", N.lp);
ok(await state(N) === "ringing", "they pick up and voicemail detection is still listening: still Ringing");
await sendEvent("call.machine.premium.detection.ended", { ...N.lp, result: "human_residence" });
row = await N.row();
ok(await state(N) === "connected" && row.bridgedAt >= row.answeredAt, "a person, bridged to the agent: Connected (talk time starts here)");
await patchCallBySid(N.sid, (c) => Object.assign(c, { answeredAt: Date.now() - 60000, bridgedAt: Date.now() - 30000 }));
await sendEvent("call.hangup", { direction: "outgoing", call_control_id: N.web, call_session_id: N.sess, hangup_cause: "normal_clearing" });
row = await N.row();
ok(row.final && row.talkSec >= 29 && row.talkSec <= 31, "talk time counts from Connected, not from the dial");
ok(await state(N) === "ended", "after hangup: Ended");
const NM = await browserCall("2125550032"), seen = [await state(NM)];
await sendEvent("call.initiated", NM.lp); seen.push(await state(NM));
await sendEvent("call.answered", NM.lp); seen.push(await state(NM));
await sendEvent("call.machine.premium.detection.ended", { ...NM.lp, result: "machine" }); seen.push(await state(NM));
await sendEvent("call.hangup", { ...NM.lp, hangup_cause: "normal_clearing" }); seen.push(await state(NM));
ok(seen.join() === "dialing,ringing,ringing,voicemail,voicemail", `a mailbox is never Connected (${seen.join(" → ")})`);
FAIL_BRIDGE = 1;
const NB = await browserCall("2125550033");
await sendEvent("call.answered", NB.lp);
await sendEvent("call.machine.premium.detection.ended", { ...NB.lp, result: "human_business" });
ok(await state(NB) === "ringing", "a person, but the bridge has to wait: not Connected yet");
await sendEvent("call.answered", { direction: "outgoing", call_control_id: NB.web, call_session_id: NB.sess });
ok(await state(NB) === "connected", "Connected once the bridge goes through");
const NR = await browserCall("2125550034");
await sendEvent("call.initiated", NR.lp);
await sendEvent("call.hangup", { ...NR.lp, hangup_cause: "timeout" });
ok(await state(NR) === "ended", "rang out: Ringing → Ended, never Connected");

console.log("done");
