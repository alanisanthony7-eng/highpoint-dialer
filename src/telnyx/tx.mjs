// Telnyx: REST helper, one-click setup, per-agent browser-phone tokens, numbers
import crypto from "node:crypto";
import { Buffer } from "node:buffer";
import { env, json, bad, requireUser, wrap, httpErr, getJ, setJ, updateJ, listKeys, config as loadConfig, to10, e164, AREA, siteUrl, saveCall, patchCallBySid, aggregate } from "../lib/hp.mjs";
import { redact } from "../lib/redact.mjs";
import { trustRoute } from "./trust.mjs";
import { amdDial, amdLeadEvent, amdAgentAnswered, amdAgentGone } from "./amd.mjs";

export const TX_KEY = () => env("TELNYX_API_KEY");
export const isTelnyx = () => !!TX_KEY();
export async function tx(path, { method = "GET", body, query, raw } = {}) {
  if (!TX_KEY()) throw httpErr(503, "Telnyx isn't connected yet. Add TELNYX_API_KEY in Cloudflare Pages → Settings → Variables and secrets.");
  let url = "https://api.telnyx.com" + path;
  if (query) url += (url.includes("?") ? "&" : "?") + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== "")).toString();
  const r = await fetch(url, { method, body: body ? JSON.stringify(body) : undefined, headers: { authorization: "Bearer " + TX_KEY(), "content-type": "application/json", accept: raw ? "*/*" : "application/json" } });
  if (raw && r.ok) return r.text();
  if (r.status === 204) return {};
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const er = j.errors?.[0] || {};
    // error 10038 = blocked at this Telnyx account level: say which request, so it's clear what needs upgrading
    const where = String(er.code) === "10038" ? ` [${method} ${path.split("?")[0].replace(/\/[0-9a-f-]{20,}|\/v3:[^/]+|\/\+?\d{6,}/gi, "/…")}]` : "";
    throw httpErr(r.status >= 500 ? 502 : 400, "Telnyx: " + (er.detail || er.title || r.statusText) + (er.code ? ` (error ${er.code})` : "") + where);
  }
  return j;
}
const rnd = (n, abc = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789") => Array.from(crypto.randomBytes(n), (b) => abc[b % abc.length]).join("");

// Create (or repair) the credential connection every agent's browser phone signs in through.
export async function txSetup() {
  const cfg = await loadConfig();
  const t = { ...(cfg.tx || {}) };
  const ovps = (await tx("/v2/outbound_voice_profiles", { query: { "page[size]": 50 } })).data || [];
  const ovp = ovps.find((o) => o.id === t.ovpId) || ovps.find((o) => o.enabled) || ovps[0];
  if (!ovp) throw httpErr(400, "Your Telnyx account has no outbound voice profile. In the Telnyx portal open Voice → Outbound Voice Profiles and add one.");
  t.ovpId = ovp.id;
  let conn = null;
  if (t.connId) conn = (await tx(`/v2/credential_connections/${t.connId}`).catch(() => null))?.data || null;
  const body = { connection_name: "Highpoint Dialer", active: true, anchorsite_override: "Latency", outbound: { outbound_voice_profile_id: ovp.id }, inbound: { ani_number_format: "+E.164", dnis_number_format: "+e164", simultaneous_ringing: "enabled" } };
  // Telnyx posts every call event (and live transcription) for this connection to our webhook.
  // If the account refuses the webhook fields, save the connection without them so the phone keeps working.
  // sip_uri_calling_preference "internal": inbound calls are transferred to an agent's credential from our own Call Control app
  const hookUrl = `${siteUrl()}/api/telnyx/events`;
  const hook = { webhook_event_url: hookUrl, webhook_api_version: "2", sip_uri_calling_preference: "internal" };
  const creds = conn ? {} : { user_name: "hpdialer" + rnd(10, "abcdefghijkmnpqrstuvwxyz23456789"), password: rnd(28) };
  const save = (extra) => (conn
    ? tx(`/v2/credential_connections/${conn.id}`, { method: "PATCH", body: { ...body, ...extra } })
    : tx("/v2/credential_connections", { method: "POST", body: { ...body, ...creds, ...extra } }));
  let saved;
  try { saved = await save(hook); t.hookErr = null; }
  catch (e) { t.hookErr = e.message; saved = await save({}); }
  if (!conn) t.connId = saved.data.id;
  if (!t.hookErr) await parkOutbound(t);
  // Inbound: Telnyx can't ring browser credentials directly, so numbers point at a Call Control app whose
  // webhook (/api/telnyx/events) rings each agent. Outbound calls still go out through the credential connection.
  const appBody = { application_name: "Highpoint Inbound", active: true, anchorsite_override: "Latency", webhook_event_url: hookUrl, webhook_api_version: "2", outbound: { outbound_voice_profile_id: ovp.id } };
  try {
    const app = t.appId ? (await tx(`/v2/call_control_applications/${t.appId}`).catch(() => null))?.data : null;
    if (app?.id) await tx(`/v2/call_control_applications/${app.id}`, { method: "PATCH", body: appBody });
    else { t.appId = null; t.appId = (await tx("/v2/call_control_applications", { method: "POST", body: appBody })).data.id; }
    t.appErr = null;
  } catch (e) { t.appErr = e.message; }
  await setJ("config", "app", { ...cfg, tx: { ...t, setupAt: Date.now() } });
  // point our numbers at the inbound app (or, if it couldn't be made, the browser connection)
  const all = (await getJ("numbers", "all")) || {};
  for (const n of Object.values(all)) if (!n.released && n.sid) await tx(`/v2/phone_numbers/${n.sid}`, { method: "PATCH", body: { connection_id: t.appId || t.connId } }).catch(() => {});
  return { ...t, ovpName: ovp.name };
}
// Browser calls are parked instead of going straight to the lead, so the server can dial the lead with voicemail
// detection (see amd.mjs). Only with the webhook in place: a parked call nobody dials would never ring.
async function parkOutbound(t) {
  try {
    await tx(`/v2/credential_connections/${t.connId}`, { method: "PATCH", body: { outbound: { outbound_voice_profile_id: t.ovpId, call_parking_enabled: true } } });
    Object.assign(t, { parkAt: Date.now(), parkErr: null });
  } catch (e) { Object.assign(t, { parkAt: null, parkErr: e.message }); }
}

// Browser-phone login token for this agent (one telephony credential per agent)
export async function txToken(user) {
  const cfg = await loadConfig();
  if (!cfg.tx?.connId) throw httpErr(409, "The dialer isn't set up yet. An admin needs to press Connect once.");
  if (!cfg.tx.parkAt && !cfg.tx.parkErr && !cfg.tx.hookErr && cfg.tx.ovpId) { // set up before voicemail detection existed
    const t = { ...cfg.tx }; await parkOutbound(t);
    await updateJ("config", "app", (c) => Object.assign(c, { tx: { ...(c.tx || {}), parkAt: t.parkAt, parkErr: t.parkErr } }), {});
  }
  let cred = await getJ("txcred", user.identity);
  if (cred && cred.connId !== cfg.tx.connId) cred = null;
  let fresh = false;
  if (!cred) {
    const c = await tx("/v2/telephony_credentials", { method: "POST", body: { connection_id: cfg.tx.connId, name: user.identity, tag: "highpoint" } });
    cred = { id: c.data.id, sip: c.data.sip_username, connId: cfg.tx.connId, at: Date.now() };
    await setJ("txcred", user.identity, cred); fresh = true;
  }
  let tok = "";
  try { tok = await tx(`/v2/telephony_credentials/${cred.id}/token`, { method: "POST", raw: true }); }
  catch (e) { await setJ("txcred", user.identity, null); throw e; }
  tok = String(tok).trim();
  if (tok.startsWith("{")) { try { const j = JSON.parse(tok); tok = j.data?.token || j.token || j.data || ""; } catch {} }
  return { token: tok, sip: cred.sip, fresh };
}

export async function txSearch(ac, st, contains) {
  const q = { "filter[country_code]": "US", "filter[features][]": "voice", "filter[limit]": 30, "filter[phone_number_type]": "local" };
  if (ac) q["filter[national_destination_code]"] = ac; else if (st) q["filter[administrative_area]"] = st;
  if (contains) q["filter[phone_number][contains]"] = contains;
  let r = await tx("/v2/available_phone_numbers", { query: q }); let fallback = false;
  if (!r.data?.length && ac && st) { delete q["filter[national_destination_code]"]; q["filter[administrative_area]"] = st; r = await tx("/v2/available_phone_numbers", { query: q }); fallback = true; }
  const pretty = (e) => { const d = to10(e); return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`; };
  return { fallback, results: (r.data || []).map((n) => { const loc = Object.fromEntries((n.region_information || []).map((x) => [x.region_type, x.region_name])); return { e164: n.phone_number, pretty: pretty(n.phone_number), city: String(loc.rate_center || loc.location || "").split(":")[0].toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase()), state: loc.state || AREA[to10(n.phone_number).slice(0, 3)] || "", areaCode: to10(n.phone_number).slice(0, 3), sms: (n.features || []).some((f) => f.name === "sms"), monthly: n.cost_information?.monthly_cost }; }) };
}

export async function txBuy(phoneNumber) {
  const cfg = await loadConfig();
  const home = cfg.tx?.appId || cfg.tx?.connId; // inbound calls are routed by the Call Control app when there is one
  const o = await tx("/v2/number_orders", { method: "POST", body: { phone_numbers: [{ phone_number: phoneNumber }], ...(home ? { connection_id: home } : {}) } });
  // the order completes in a few seconds; look the number up so we can store its id
  let id = "";
  for (let i = 0; i < 8 && !id; i++) {
    await new Promise((r) => setTimeout(r, 900));
    const l = await tx("/v2/phone_numbers", { query: { "filter[phone_number]": phoneNumber } }).catch(() => ({}));
    id = l.data?.[0]?.id || "";
  }
  if (id && home) await tx(`/v2/phone_numbers/${id}`, { method: "PATCH", body: { connection_id: home } }).catch(() => {});
  if (id && cfg.tx?.msgProfileId) await tx(`/v2/phone_numbers/${id}/messaging`, { method: "PATCH", body: { messaging_profile_id: cfg.tx.msgProfileId } }).catch(() => {});
  let status = o.data?.status;
  if (!id && o.data?.id) status = (await tx(`/v2/number_orders/${o.data.id}`).catch(() => null))?.data?.status || status; // "failure" when Telnyx couldn't get it
  return { sid: id, orderId: o.data?.id, status };
}

export async function txRelease(sid) {
  if (!sid) return;
  await tx(`/v2/phone_numbers/${sid}`, { method: "DELETE" });
}

export async function txImport() {
  const cfg = await loadConfig();
  const home = cfg.tx?.appId || cfg.tx?.connId;
  const r = await tx("/v2/phone_numbers", { query: { "page[size]": 250 } });
  let added = 0;
  for (const n of r.data || []) {
    const e164 = n.phone_number;
    if (!e164) continue;
    if (home) await tx(`/v2/phone_numbers/${n.id}`, { method: "PATCH", body: { connection_id: home } }).catch(() => {});
    await updateJ("numbers", "all", (a) => {
      if (!a[e164] || a[e164].released) {
        a[e164] = { e164, sid: n.id, provider: "telnyx", areaCode: to10(e164).slice(0, 3), state: AREA[to10(e164).slice(0, 3)] || "", owner: "", shared: true, boughtAt: Date.parse(n.created_at) || Date.now(), label: "", days: {} };
        added++;
      }
      return a;
    }, {});
  }
  return { added };
}

/* ---------- live transcription from Telnyx call events ----------
   Telnyx signs each webhook with Ed25519 over "<telnyx-timestamp>|<raw body>".
   The key comes from TELNYX_PUBLIC_KEY (Mission Control → API keys → Public key) or, failing that, the account's public key endpoint.
   Transcripts are kept per lead phone number: txlive/<10 digits> = { sess, ccid, owner, lines, partial, started, declined, … }.
   A new call gets a new call_session_id, which resets the record so one call's lines never show up on the next. */
let PK = null;
function decodePk(b64) {
  const s = String(b64 || "").trim().replace(/-----BEGIN[^-]+-----/g, "").replace(/-----END[^-]+-----/g, "").replace(/\s+/g, "");
  if (!s) return null;
  let raw;
  try { raw = Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)); }
  catch { return null; }
  if (raw.length === 44) raw = raw.slice(12); // DER/SPKI wrapper around the 32-byte key
  return raw.length === 32 ? raw : null;
}
async function telnyxKey() {
  if (PK) return PK;
  let key = decodePk(env("TELNYX_PUBLIC_KEY"));
  // Telnyx's endpoint returns data.public (not data.public_key). Without this, every
  // call event is 401'd and live transcription never starts.
  if (!key) {
    const j = await tx("/v2/public_key").catch(() => null);
    key = decodePk(j?.data?.public || j?.data?.public_key || j?.public || j?.public_key || "");
  }
  return key ? (PK = key) : null;
}
// Returns "" when the signature is good, otherwise the reason (shown in the admin log).
async function verifyTelnyx(raw, sig, ts) {
  if (!sig || !ts) return "the request has no telnyx-signature-ed25519 or telnyx-timestamp header";
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return "the timestamp is more than five minutes off";
  const key = await telnyxKey(); if (!key) return "no public key: add TELNYX_PUBLIC_KEY in Cloudflare settings";
  const msg = new TextEncoder().encode(`${ts}|${raw}`);
  let s; try { s = Uint8Array.from(atob(String(sig)), (c) => c.charCodeAt(0)); } catch { return "the signature isn't valid base64"; }
  let web = "";
  try { // Web Crypto: Cloudflare Workers and recent Node
    const pub = await globalThis.crypto.subtle.importKey("raw", key, { name: "Ed25519" }, false, ["verify"]);
    return (await globalThis.crypto.subtle.verify({ name: "Ed25519" }, pub, s, msg)) ? "" : "the signature doesn't match TELNYX_PUBLIC_KEY";
  } catch (e) { web = e.message; }
  try { // fallback: node:crypto, if this runtime has Ed25519 there instead
    const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(key)]);
    const k = crypto.createPublicKey({ key: spki, format: "der", type: "spki" });
    return crypto.verify(null, msg, k, Buffer.from(s)) ? "" : "the signature doesn't match TELNYX_PUBLIC_KEY";
  } catch (e) { return "this runtime can't check Ed25519 signatures (" + web + "; " + e.message + ")"; }
}
// What the admin log shows: transcript text becomes a length, phone numbers keep only their last four digits.
const PHONE_KEY = /number|^from$|^to$|caller|destination|^ani$|^dnis$/i;
function scrub(v, k = "") {
  if (typeof v === "string") {
    if (/transcript|text|speech/i.test(k)) return `[${v.length} characters]`;
    if (PHONE_KEY.test(k) && /\d{7,}/.test(v)) return "…" + v.replace(/\D/g, "").slice(-4);
    return v;
  }
  if (Array.isArray(v)) return v.map((x) => scrub(x, k));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([kk, vv]) => [kk, scrub(vv, kk)]));
  return v;
}
export async function logEvent(entry) {
  await updateJ("txlog", "recent", (a) => [...(Array.isArray(a) ? a : []), { at: Date.now(), ...entry }].slice(-40), []);
}
// The lead's number is the far end of the call. A SIP address (an agent's browser) is never a lead.
const leadOf = (p) => { const v = String((/out/i.test(p.direction || "") ? p.to : p.from) || ""); return /sip:|@/i.test(v) ? "" : to10(v); };
const b64json = (o) => btoa(JSON.stringify(o));
const unjson = (s) => { try { return JSON.parse(atob(String(s || ""))); } catch { return null; } };
const act = (ccid, action, body = {}) => tx(`/v2/calls/${ccid}/actions/${action}`, { method: "POST", body });


// Words the speech engine should expect to hear on these calls (it gets them right far more often when told).
export const TX_TERMS = ["Highpoint Financial", "final expense", "burial insurance", "mortgage protection", "IUL", "indexed universal life", "whole life", "term life", "beneficiary", "premium", "underwriting", "graded benefit", "guaranteed issue", "simplified issue", "Medicare", "Mutual of Omaha", "Transamerica", "Aetna", "Americo", "Foresters", "Royal Neighbors", "Corebridge", "AIG", "Ethos", "F&G", "Columbian", "SBLI", "bank draft", "routing number", "face amount"];
const gBody = (model) => ({ transcription_engine: "Google", transcription_tracks: "both", transcription_engine_config: { transcription_engine: "Google", language: "en", ...(model ? { model, use_enhanced: true } : {}), ...(model ? { hints: TX_TERMS } : {}), interim_results: true } });
// Which engines to try, in order. "auto" = Deepgram Nova-3 (phone-call accuracy plus our word list), then Google's phone model, then plain Google.
export function engineOrder(pref) {
  const dg = { name: "Deepgram Nova-3", body: { transcription_engine: "Deepgram", transcription_tracks: "both", transcription_engine_config: { transcription_engine: "Deepgram", transcription_model: "deepgram/nova-3", language: "en", interim_results: true, smart_format: true, keyterms: TX_TERMS } } };
  const gp = { name: "Google phone model", body: gBody("phone_call") };
  const g0 = { name: "Google", body: { transcription_engine: "Google", transcription_tracks: "both", language: "en-US", interim_results: true } };
  if (pref === "google") return [gp, g0];
  if (pref === "basic") return [g0];
  return [dg, gp, g0];
}
// Start live transcription once per call. `target` is the leg whose "inbound" track is the lead's voice.
async function startTx(lead, sess, target) {
  const rec = await getJ("txlive", lead);
  if (!rec || rec.sess !== sess) return "answer for an earlier call";
  if (rec.declined) return "not transcribing: the client declined";
  if (rec.started) return "transcription already running";
  if ((await loadConfig()).settings?.transcribe === false) return "not transcribing: turned off in settings";
  let err = null, used = "";
  // best engine first; if Telnyx refuses it (not on this account, bad setting) the next one starts instead, so a call is never left with no transcript
  for (const o of engineOrder((await loadConfig()).settings?.transcribeEngine)) {
    try { await act(target, "transcription_start", o.body); err = null; used = o.name; break; }
    catch (e) { err = `${o.name}: ${e.message}`; await logEvent({ type: "transcription_start", note: "failed: " + err }).catch(() => {}); }
  }
  await updateJ("txlive", lead, (r) => { if (r.sess === sess) Object.assign(r, { started: !err, startErr: err, ccid: target, engine: used || r.engine }); return r; }, {});
  await logEvent({ type: "transcription_start", note: err ? "failed: " + err : "started with " + used });
  return err ? "transcription failed to start" : "transcription started";
}

// Map this Telnyx leg to the lead's live transcript. call.answered can beat call.initiated
// (two Workers handle the webhooks at once), so answered also binds — otherwise transcription
// starts nowhere and Copilot sits deaf on the call.
async function bindLeg(p) {
  const ccid = p.call_control_id || "", sess = p.call_session_id || ccid;
  const lead = leadOf(p) || (await getJ("txsess", sess))?.lead || "";
  if (!lead || !ccid) return null;
  const out = /out/i.test(p.direction || "");
  await setJ("txcc", ccid, { lead, sess });
  await setJ("txsess", sess, { lead });
  await updateJ("txlive", lead, (r) => {
    if (r.sess !== sess) Object.assign(r, { sess, ccid, out, lines: [], partial: {}, started: false, startErr: null, declined: false, endedAt: null, at: Date.now(), tlog: 0 });
    else if (!r.ccid) r.ccid = ccid;
    return r;
  }, {});
  return { lead, sess, ccid };
}

// Recording starts silently: no announcement is played. The agent reads the disclosure; Copilot waits for "Client agreed".
export async function startMedia(lead, sess, ccid) {
  const rec = await recordLeg(lead, sess, ccid);
  const tr = await startTx(lead, sess, ccid); // live transcript (Deepgram, then Google) for Copilot
  return rec + "; " + tr;
}
async function recordLeg(lead, sess, ccid) {
  const S = (await loadConfig()).settings || {};
  if (S.record !== false) {
    try {
      const r = await act(ccid, "record_start", { format: "mp3", channels: "dual" });
      const rid = r?.data?.recording_id || r?.data?.id || "";
      if (rid) {
        const live = lead ? await getJ("txlive", lead) : null;
        await patchCallBySid(sess, (c) => { c.recordingSid = rid; return c; })
          || (live?.callSid ? patchCallBySid(live.callSid, (c) => { c.recordingSid = rid; return c; }) : null)
          || patchCallBySid(lead, (c) => { c.recordingSid = rid; return c; });
      }
    } catch (e) { await logEvent({ type: "record_start", note: "failed: " + e.message }); }
  }
  return S.record !== false ? "recording started" : "connected";
}
async function finishOutbound(sess, ccid, lead) {
  const live = lead ? await getJ("txlive", lead) : null;
  const endedAt = Date.now();
  let first = false;
  const fin = (c) => {
    if (c.final) return c;
    first = true;
    const talkSec = c.answeredAt ? Math.max(0, Math.round((endedAt - (c.bridgedAt || c.answeredAt)) / 1000)) : 0;
    if (c.machine) return Object.assign(c, { endedAt, talkSec: 0, answered: true, human: false, status: "machine", final: true, sess: c.sess || sess, ccid: c.ccid || ccid }); // voicemail: the agent never joined
    return Object.assign(c, { endedAt, talkSec, answered: !!c.answeredAt, human: !!c.answeredAt, status: c.answeredAt ? "completed" : "no-answer", final: true, sess: c.sess || sess, ccid: c.ccid || ccid });
  };
  const rec = await patchCallBySid(sess, fin) || await patchCallBySid(ccid, fin) || (live?.callSid ? await patchCallBySid(live.callSid, fin) : null);
  if (live?.lines?.length && rec) {
    for (const sid of [...new Set([rec.sid, rec.sess, rec.ccid, rec.webrtcId, sess, ccid].filter(Boolean))]) await setJ("tx", sid, { lines: live.lines });
  }
  if (first && rec) await aggregate(rec, "end").catch(() => {});
  return rec;
}

/* ---------- inbound calls ----------
   Telnyx can't ring a browser's on-demand credential directly ("inbound calls directly to on-demand generated
   credential is not currently supported"), so our numbers point at a Call Control app and this webhook routes
   each call: ring the number's owner (a team number rings agents active in the last 12 hours), one at a time,
   by transferring the caller to that agent's credential. If nobody picks up, log a missed call in the inbox
   and tell the caller we'll call back. State per call: txin/<call_session_id>. */
async function ringList(num) {
  const cfg = await loadConfig();
  let ids = num.owner ? [num.owner] : [];
  if (!ids.length) { // unowned team numbers ring agents active in the last 12 hours
    for (const k of (await listKeys("agents", "")).slice(0, 60)) { const a = await getJ("agents", k); if (a && a.seen > Date.now() - 12 * 36e5) ids.push(a.identity); }
    ids = ids.slice(0, 10);
  }
  const out = [];
  for (const id of ids) { const c = await getJ("txcred", id); if (c?.sip && c.connId === cfg.tx?.connId) out.push({ id, sip: c.sip }); }
  return out;
}
async function inboundStart(p, sess) {
  const all = (await getJ("numbers", "all")) || {};
  const num = all[p.to] || all["+1" + to10(p.to)];
  if (!num || num.released) return ""; // not one of our numbers
  const queue = await ringList(num);
  let created = false;
  await updateJ("txin", sess, (x) => { if (x) return undefined; created = true; return { sess, ccid: p.call_control_id, from: p.from, to: num.e164 || p.to, owner: num.owner || "", queue, i: -1, at: Date.now() }; }, null);
  if (!created) return "already being routed";
  await saveCall({ id: sess, sid: sess, agent: queue[0]?.id || num.owner || "_team", dir: "in", mode: "inbound", to: to10(p.from), from: num.e164 || p.to, at: Date.now(), status: "ringing" });
  await ringNext(sess);
  return queue.length ? `ringing ${queue.length} agent${queue.length > 1 ? "s" : ""}` : "no agent can take it";
}
async function ringNext(sess) {
  let moved = false;
  const s = await updateJ("txin", sess, (x) => {
    if (!x || x.bridged || x.done || x.fallback || x.waitAnswer) return undefined;
    x.i += 1; if (x.i >= x.queue.length) x.fallback = true; moved = true; return x;
  }, null);
  if (!moved) return;
  if (s.fallback) return missedCall(s);
  const a = s.queue[s.i];
  const body = { to: `sip:${a.sip}@sip.telnyx.com`, from: s.from, timeout_secs: 22, target_leg_client_state: b64json({ in: sess, i: s.i }) };
  let err = null;
  try { await act(s.ccid, "transfer", body); }
  catch (e) {
    err = e.message;
    if (/answer/i.test(err) && !s.answered) { // this account wants the call answered before a transfer: answer, ring again on call.answered
      await updateJ("txin", sess, (x) => (x ? Object.assign(x, { i: x.i - 1, waitAnswer: true }) : undefined), null);
      await act(s.ccid, "answer").catch((e2) => logEvent({ type: "inbound", note: "couldn't answer the call: " + e2.message }));
      return;
    }
    if (/from|caller|ani/i.test(err)) { delete body.from; try { await act(s.ccid, "transfer", body); err = null; } catch (e2) { err = e2.message; } } // caller ID refused: ring without it
  }
  if (err) { await logEvent({ type: "inbound", note: `couldn't ring agent ${s.i + 1}: ${err}` }); return ringNext(sess); }
  await logEvent({ type: "inbound", note: `ringing agent ${s.i + 1} of ${s.queue.length}` });
}
async function missedCall(s) {
  let first = false;
  await updateJ("txin", s.sess, (x) => { if (!x || x.missed) return undefined; first = true; x.missed = true; return x; }, null);
  if (first) {
    await setJ("inbox", `${s.owner || "_team"}/${Date.now()}-${s.sess}`, { kind: "missed", from: to10(s.from), to: s.to, at: Date.now(), sid: s.sess, owner: s.owner });
    await logEvent({ type: "inbound", note: "nobody picked up: missed call logged" });
  }
  if (s.done) return;
  if (s.answered) await sayMissed(s); // otherwise answer first; call.answered plays the message
  else await act(s.ccid, "answer").catch(() => act(s.ccid, "hangup").catch(() => {}));
}
async function sayMissed(s) {
  const set = (await loadConfig()).settings || {};
  const co = set.company || "Highpoint Financial";
  const payload = String(set.inboundGreeting || "").trim() || `Thanks for calling ${co}. Everyone is with a client right now. We'll call you back shortly. Goodbye.`;
  try { await act(s.ccid, "speak", { payload, voice: "female", language: "en-US" }); }
  catch (e) { await logEvent({ type: "inbound", note: "missed-call message failed: " + e.message }); await act(s.ccid, "hangup").catch(() => {}); }
}
async function inboundAnswered(sess) { // the agent's browser picked up
  let first = false;
  const s = await updateJ("txin", sess, (x) => { if (!x || x.bridged || x.done) return undefined; first = true; return Object.assign(x, { bridged: true, agent: x.queue[x.i]?.id || "", bridgedAt: Date.now() }); }, null);
  if (!first) return "already connected";
  await patchCallBySid(sess, (c) => Object.assign(c, { status: "in-progress", answered: true, answeredAt: Date.now() }));
  await logEvent({ type: "inbound", note: `agent ${s.i + 1} picked up` });
  const lead = (await getJ("txsess", sess))?.lead;
  return lead ? startMedia(lead, sess, s.ccid) : "connected";
}
async function inboundEnded(sess) { // the caller's leg ended
  let first = false;
  const s = await updateJ("txin", sess, (x) => { if (!x || x.done) return undefined; first = true; return Object.assign(x, { done: true, endedAt: Date.now() }); }, null);
  if (!first) return;
  if (!s.bridged) await missedCall(s);
  const talkSec = s.bridged ? Math.max(0, Math.round((s.endedAt - s.bridgedAt) / 1000)) : 0;
  const rec = await patchCallBySid(sess, (c) => Object.assign(c, { endedAt: s.endedAt, talkSec, answered: !!s.bridged, human: !!s.bridged, status: s.bridged ? "completed" : "no-answer", final: true }));
  if (rec?.final) await aggregate({ ...rec, from: null }, "end").catch(() => {});
}

async function handleTelnyx(type, p) {
  if (type === "message.received") { // a text to one of our numbers
    const { receiveText } = await import("../lib/sms.mjs");
    await receiveText({ from: p.from?.phone_number, line: p.to?.[0]?.phone_number, body: p.text });
    return "text received";
  }
  if (type.startsWith("message.")) return "text status";
  const ccid = p.call_control_id || "", sess = p.call_session_id || ccid;
  const inb = sess ? await getJ("txin", sess) : null; // set when this is an inbound call we're routing
  const cs = unjson(p.client_state);
  // the leg we dialed to the lead for voicemail detection, and the agent's parked leg it belongs to
  const amdOf = !inb && ccid ? cs?.amd || (await getJ("txcc", ccid))?.amd || "" : "";
  if (amdOf) { const note = await amdLeadEvent(type, p, amdOf); if (note != null) return note; }
  const amdWeb = !inb && !amdOf && (type === "call.answered" || type === "call.hangup") ? await getJ("txamd", ccid) : null;
  if (type === "call.initiated") {
    const parked = p.state === "parked" && !inb && !cs; // a browser call waiting for us to dial the lead
    if (parked) p = { ...p, direction: "outgoing" };
    const out = /out/i.test(p.direction || "");
    const m = await bindLeg(p);
    if (!m) { if (parked) await act(ccid, "hangup").catch(() => {}); return "no lead number on this call"; }
    let rec = null;
    if (out && !inb) {
      const live = await getJ("txlive", m.lead);
      rec = live?.callSid ? await patchCallBySid(live.callSid, (c) => Object.assign(c, { sess: m.sess, ccid: m.ccid, sid: c.sid || m.sess }, parked && !c.amd ? { amd: "pending" } : {})) : null;
      if (rec) {
        await setJ("callidx", m.sess, { agent: rec.agent, id: rec.id });
        await setJ("callidx", m.ccid, { agent: rec.agent, id: rec.id });
      } else {
        await saveCall({ id: m.sess, sid: m.sess, ccid: m.ccid, sess: m.sess, agent: live?.owner || "_team", dir: "out", mode: "webrtc", to: m.lead, from: e164(p.from) || p.from || "", at: Date.now(), status: "initiated" });
        await aggregate({ agent: live?.owner || "_team", from: e164(p.from) || p.from || "", at: Date.now() }, "dial").catch(() => {});
      }
    }
    if (parked) return amdDial(m, p, rec);
    if (!out && !inb) { const note = await inboundStart(p, sess); if (note) return "incoming call: " + note; }
    return out ? "outgoing call started" : "incoming call ringing";
  }
  if (type === "call.answered") {
    if (amdWeb) return amdAgentAnswered(amdWeb); // we answered the agent's parked leg for a person; recording is on the lead's leg
    if (inb) {
      if (ccid !== inb.ccid) return inboundAnswered(sess); // the agent picked up
      await updateJ("txin", sess, (x) => (x ? Object.assign(x, { answered: true, waitAnswer: false }) : undefined), null);
      if (inb.fallback) { await sayMissed(inb); return "playing the missed-call message"; }
      if (inb.waitAnswer) { await ringNext(sess); return "answered; ringing agents"; }
      return "caller's leg answered";
    }
    const m = (await getJ("txcc", ccid)) || (await bindLeg(p));
    if (!m) return "answer for a call we never saw start";
    await patchCallBySid(m.sess, (c) => Object.assign(c, { status: "in-progress", answered: true, answeredAt: Date.now() }));
    return startMedia(m.lead, m.sess, m.ccid || ccid);
  }
  if (type === "call.recording.saved") {
    const rid = p.recording_id || p.recording?.id;
    const urls = p.recording_urls || p.recording?.recording_urls || p.download_urls || p.recording?.download_urls || {};
    const url = urls.mp3 || urls.wav || p.recording_url || "";
    const sec = Math.round((p.duration_millis || p.recording?.duration_millis || 0) / 1000);
    const patch = (c) => {
      if (rid) c.recordingSid = rid;
      if (url) c.recordingUrl = url;
      if (sec) c.recordingSec = sec;
      return c;
    };
    const m = await getJ("txcc", ccid);
    const live = m?.lead ? await getJ("txlive", m.lead) : null;
    if (rid || url) {
      const rec = await (m ? patchCallBySid(m.sess, patch) : null)
        || patchCallBySid(sess, patch)
        || (ccid ? patchCallBySid(ccid, patch) : null)
        || (live?.callSid ? patchCallBySid(live.callSid, patch) : null)
        || (m?.lead ? patchCallBySid(m.lead, patch) : null);
      if (rec) {
        for (const sid of [...new Set([rec.sid, rec.sess, rec.ccid, rec.webrtcId, sess, ccid, live?.callSid].filter(Boolean))]) {
          await setJ("callidx", sid, { agent: rec.agent, id: rec.id });
        }
      }
    }
    return rid || url ? "recording saved" : "recording saved without id";
  }
  if (type === "call.speak.ended" && inb && ccid === inb.ccid && inb.fallback) { await act(ccid, "hangup").catch(() => {}); return "missed-call message played"; }
  if (type === "call.transcription") {
    const m = (await getJ("txcc", ccid)) || (await bindLeg(p));
    if (!m) return "transcript for an unknown call";
    const td = p.transcription_data || p.transcription || p;
    const text = String(td.transcript ?? p.transcript ?? "").trim();
    const final = [td.is_final, p.is_final].some((v) => v === true || v === "true");
    const trk = String(td.track || p.track || "").toLowerCase();
    const track = trk.includes("out") ? "outbound_track" : trk.includes("in") ? "inbound_track" : "";
    const speaker = track === "inbound_track" ? "Lead" : track === "outbound_track" ? "Agent" : "";
    const line = { t: Date.now(), track, speaker, text, conf: td.confidence ?? null };
    let kept = false, logIt = false;
    await updateJ("txlive", m.lead, (r) => {
      if (r.sess !== m.sess || r.declined || !text) return r;
      kept = true; r.partial = r.partial || {};
      if (final) { r.lines = [...(r.lines || []), line].slice(-800); if (track) r.partial[track] = null; }
      else if (track) r.partial[track] = line;
      r.tlog = (r.tlog || 0) + 1; logIt = r.tlog <= 4; // the admin log keeps the first few payloads per call, enough to confirm the shape
      return r;
    }, {});
    if (logIt) await logEvent({ type, note: kept ? (final ? "final line kept" : "partial line kept") : "line dropped", body: scrub({ ...p, _track: track }) });
    return kept ? "line stored" : "line dropped";
  }
  if (type === "call.hangup") {
    if (inb && ccid !== inb.ccid) { // a leg that rang an agent
      if (inb.done) return "agent leg closed";
      if (cs && cs.in === sess && cs.i !== inb.i) return "an earlier ring attempt closed";
      if (inb.bridged) { await act(inb.ccid, "hangup").catch(() => {}); return "the agent hung up"; }
      await ringNext(sess);
      return `agent ${inb.i + 1} didn't pick up (${p.hangup_cause || "no answer"})`;
    }
    if (inb && ccid === inb.ccid) await inboundEnded(sess);
    if (amdWeb) await amdAgentGone(amdWeb);
    const m = await getJ("txcc", ccid); if (!m) return "hangup for an unknown call";
    await updateJ("txlive", m.lead, (r) => { if (r.sess === m.sess) Object.assign(r, { endedAt: Date.now(), partial: {} }); return r; }, {});
    if (!inb) await finishOutbound(m.sess, ccid, m.lead);
    return "call ended";
  }
  return "";
}

// POST /api/telnyx/events — Telnyx calls this. Unsigned or stale requests get a 401; everything else gets a quick 200.
export async function telnyxEvents(req) {
  const raw = await req.text();
  const why = await verifyTelnyx(raw, req.headers.get("telnyx-signature-ed25519"), req.headers.get("telnyx-timestamp"));
  if (why) {
    await logEvent({ type: "rejected", note: why }).catch(() => {});
    return new Response("bad signature", { status: 401 });
  }
  let body = {}; try { body = JSON.parse(raw); } catch {}
  const data = body.data || {}, type = data.event_type || "", p = data.payload || {};
  let note = ""; try { note = await handleTelnyx(type, p); } catch (e) { note = "error: " + e.message; }
  if (type !== "call.transcription") await logEvent({ type, note, body: scrub(data) }).catch(() => {});
  return new Response(null, { status: 200 });
}

// /api/telnyx/*  (events from Telnyx; the agent's live transcript; admin status + setup)
export const telnyxRoute = wrap(async (req, action) => {
  if (action === "events" && req.method === "POST") return telnyxEvents(req);
  const user = await requireUser(req);
  if (action === "token") return json({ ...(await txToken(user)), expires: Date.now() + 23 * 36e5 });
  if (action === "transcript") { // the agent who placed or answered the call reads its live lines
    const n = to10(new URL(req.url).searchParams.get("n")); if (!n) return bad("No number", 400);
    const rec = await getJ("txlive", n);
    if (!rec || (rec.owner !== user.identity && !user.admin)) return bad("Not found", 404);
    const fresh = (l) => l && l.t > Date.now() - 8000;
    const clean = (l) => ({ ...l, text: redact(l.text) });
    return json({
      transcript: (rec.lines || []).map(clean),
      partial: Object.values(rec.partial || {}).filter(fresh).map(clean),
      status: rec.declined ? "declined" : rec.endedAt ? "ended" : (rec.started || (rec.lines || []).length) ? "live" : rec.startErr ? "error" : "waiting",
      startErr: rec.startErr || null,
    });
  }
  if (action === "claim" && req.method === "POST") { // the desk tells us which agent is on this number's call
    const b = await req.json().catch(() => ({})); const n = to10(b.n); if (!n) return bad("No number", 400);
    // another agent's live call can't be taken over (that would expose its transcript); a call with no hangup after 2 hours counts as over
    const cur = await getJ("txlive", n);
    const busy = !!cur && !!cur.owner && cur.owner !== user.identity && !cur.endedAt && Date.now() - (cur.claimedAt || cur.at || 0) < 2 * 36e5;
    if (busy && !user.admin) return bad("Another agent is on this lead's call.", 409);
    await updateJ("txlive", n, (r) => {
      const live = !!(r.sess && !r.endedAt && Date.now() - (r.at || r.claimedAt || 0) < 2 * 36e5);
      if (live && r.owner === user.identity) { r.claimedAt = Date.now(); return r; }
      const keep = live && r.lines?.length;
      Object.assign(r, { owner: user.identity, claimedAt: Date.now() });
      if (!keep) Object.assign(r, { lines: [], partial: {}, endedAt: null });
      return r;
    }, {});
    return json({ ok: true });
  }
  if (action === "privacy" && req.method === "POST") { // consent answer: "declined" stops transcription and erases what was captured
    const b = await req.json().catch(() => ({})); const n = to10(b.n);
    const rec = n && (await getJ("txlive", n));
    if (!rec || (rec.owner !== user.identity && !user.admin)) return bad("Not your call", 403);
    const declined = !!b.declined;
    await updateJ("txlive", n, (r) => { if (declined) Object.assign(r, { declined: true, lines: [], partial: {} }); else r.consent = { at: Date.now(), by: user.identity }; return r; }, {});
    if (declined && rec.ccid) await tx(`/v2/calls/${rec.ccid}/actions/record_stop`, { method: "POST", body: {} }).catch(() => {});
    if (declined && rec.started && rec.ccid) {
      try { await tx(`/v2/calls/${rec.ccid}/actions/transcription_stop`, { method: "POST", body: {} }); await logEvent({ type: "transcription_stop", note: "stopped at the client's request" }); }
      catch (e) { await logEvent({ type: "transcription_stop", note: "failed: " + e.message }); }
    }
    return json({ ok: true, declined });
  }
  if (action === "transcribe" && req.method === "POST") { // desk retries if the answer webhook lost the race
    const b = await req.json().catch(() => ({}));
    const n = to10(b.n);
    const rec = n && (await getJ("txlive", n));
    if (!rec || (rec.owner !== user.identity && !user.admin)) return bad("Not your call", 403);
    if (rec.declined) return json({ ok: false, status: "declined" });
    if (!rec.ccid || !rec.sess) return json({ ok: false, status: "waiting" });
    const note = await startTx(n, rec.sess, rec.ccid);
    return json({ ok: /started|already/.test(note), note, status: /started|already/.test(note) ? "live" : "error" });
  }
  if (!user.admin) return bad("Admins only", 403);
  if (String(action || "").startsWith("trust")) return trustRoute(req, action);
  if (action === "setup" && req.method === "POST") return json({ ok: true, ...(await txSetup()) });
  if (action === "log") { // admin: the last webhook events, with transcript text and numbers masked
    const cfg = await loadConfig();
    return json({ webhook: `${siteUrl()}/api/telnyx/events`, publicKey: (await telnyxKey().catch(() => null)) ? "ok" : "missing (set TELNYX_PUBLIC_KEY)", connection: cfg.tx?.connId || null, hookErr: cfg.tx?.hookErr || null, inboundApp: cfg.tx?.appId || null, inboundAppErr: cfg.tx?.appErr || null, voicemailDetection: cfg.tx?.parkAt ? "on" : cfg.tx?.parkErr || "off (press Connect)", events: (await getJ("txlog", "recent")) || [] });
  }
  if (action === "get") { // admin read-only look at the Telnyx account (diagnostics)
    const path = new URL(req.url).searchParams.get("p") || "";
    const clean = path.split("?")[0];
    if (clean === "/v2/public_key") return json(await tx("/v2/public_key"));
    if (!/^\/v2\/[a-z_\/0-9-]+(\?[^#]*)?$/i.test(path) || /token|secret|key/i.test(path)) return bad("Not allowed", 400);
    return json(await tx(path));
  }
  if (action === "status") {
    if (!TX_KEY()) return json({ connected: false });
    const out = { connected: true, cfg: (await loadConfig()).tx || null };
    const safe = async (k, p, f) => { try { out[k] = f(await tx(p)); } catch (e) { out[k] = { error: e.message }; } };
    await safe("balance", "/v2/balance", (j) => ({ balance: j.data?.balance, available: j.data?.available_credit, currency: j.data?.currency }));
    await safe("numbers", "/v2/phone_numbers?page[size]=50", (j) => (j.data || []).map((n) => ({ number: n.phone_number, status: n.status, connection: n.connection_id || null })));
    await safe("credentialConnections", "/v2/credential_connections?page[size]=50", (j) => (j.data || []).map((c) => ({ id: c.id, name: c.connection_name, ovp: c.outbound?.outbound_voice_profile_id })));
    await safe("outboundProfiles", "/v2/outbound_voice_profiles?page[size]=50", (j) => (j.data || []).map((o) => ({ id: o.id, name: o.name, enabled: o.enabled })));
    return json(out);
  }
  return bad("Unknown action", 404);
});
