// WAVV (embedded dialer) — the server half. Needs two Cloudflare secrets:
//   WAVV_SDK_KEY          mints the short-lived token each agent's browser hands to WAVV's init()
//   WAVV_WEBHOOK_SECRET   (whsec_…) verifies the call.* / message.* events WAVV posts to us
//  GET  /api/wavv/status   {configured, webhook}                     any signed-in agent
//  POST /api/wavv/token    {token, expiresIn}                        one per page load; never cached, single use
//  POST /api/wavv/events   WAVV webhooks (signature checked, not a session)
// The SDK key never leaves the server. Agents are WAVV users keyed by their own stable id (user.identity).
import crypto from "node:crypto";
import { env, json, bad, httpErr, requireUser, getJ, setJ, wrap, aggregate, patchCallBySid, saveCall, to10, e164 } from "../lib/hp.mjs";
import { redact } from "../lib/redact.mjs";

const API = "https://api.wavv.com/v3";
export const SDK_KEY = () => env("WAVV_SDK_KEY");
export const HOOK_SECRET = () => env("WAVV_WEBHOOK_SECRET");

// X-WAVV-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.rawBody">. 5 minutes of clock tolerance blocks replays.
export function verifySignature(raw, header, secret, tolerance = 300, now = Date.now() / 1000) {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(String(header).split(",").map((kv) => { const i = kv.indexOf("="); return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()]; }));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(now - t) > tolerance) return false;
  const expected = Buffer.from(crypto.createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex"), "hex");
  const given = Buffer.from(/^[0-9a-f]+$/i.test(parts.v1 || "") && parts.v1.length % 2 === 0 ? parts.v1 : "", "hex");
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

// WAVV's own outcome -> the status vocabulary the desk's call log already uses
const STATUS = { BUSY: "busy", NO_ANSWER: "no-answer", VOICEMAIL: "no-answer", NO_VOICEMAIL: "no-answer", VOICEMAIL_RETRY: "no-answer", DISCONNECTED: "failed", REJECTED: "failed" };
export function statusOf(d) {
  if (d.endedAt || d.outcome !== "UNKNOWN") {
    if (STATUS[d.outcome]) return STATUS[d.outcome];
    return d.answeredAt || d.seconds > 0 ? "completed" : "no-answer";
  }
  return d.answeredAt ? "in-progress" : "dialing";
}

function record(d) {
  const inbound = d.direction === "inbound";
  const num = to10(inbound ? d.callerId : d.phone) || (inbound ? d.callerId : d.phone) || "";
  const mine = to10(inbound ? d.phone : d.callerId);
  return {
    id: "wv_" + d.id, sid: "wv_" + d.id, wavvId: d.id, agent: d.userId || "_team", leadId: d.contactId || "", leadName: d.contactName || "",
    to: num, from: mine ? e164(mine) : "", dir: inbound ? "in" : "out", mode: "wavv", at: Date.parse(d.startedAt) || Date.now(),
    status: statusOf(d), campaignId: d.campaignId || undefined,
  };
}

export async function handleEvent(ev) {
  const d = ev?.data;
  if (!ev?.event || !d?.id) return { ignored: true };
  // at-least-once delivery: the same (event, id) can arrive twice
  const dedupe = `${ev.event}:${d.id}`;
  if (await getJ("wavvseen", dedupe)) return { duplicate: true };
  await setJ("wavvseen", dedupe, { at: Date.now() });

  if (ev.event.startsWith("call.")) {
    const sid = "wv_" + d.id;
    const base = record(d);
    // events for one call can arrive out of order, so every one is a patch onto whatever is already stored
    const exists = await getJ("callidx", sid);
    if (!exists) { await saveCall(base); if (ev.event === "call.started") await aggregate(base, "dial"); }
    if (ev.event === "call.answered") {
      await patchCallBySid(sid, (c) => { if (!c.final) { c.status = "in-progress"; c.answered = true; c.answeredAt = Date.parse(d.answeredAt) || Date.now(); } return c; });
    } else if (ev.event === "call.ended") {
      const rec = await patchCallBySid(sid, (c) => {
        const answered = !!(d.answeredAt || d.seconds > 0);
        c.status = statusOf(d); c.answered = answered; c.final = true; c.talkSec = d.seconds || 0; c.endedAt = Date.parse(d.endedAt) || Date.now();
        c.human = d.human === true; c.machine = d.human === false; c.outcomeRaw = d.outcome;
        if (d.disposition) c.disposition = String(d.disposition).slice(0, 60);
        if (d.note) c.note = redact(String(d.note).slice(0, 2000));
        if (d.contactId) c.leadId = d.contactId;
        return c;
      });
      if (rec) {
        await aggregate({ ...rec }, "end");
        if (rec.disposition) await aggregate({ ...rec }, "dispo");
        if (/do not call|dnc/i.test(rec.disposition || "") && rec.to) await setJ("dnc", to10(rec.to) || rec.to, { at: Date.now(), by: rec.agent, reason: "Marked Do Not Call in WAVV" });
      }
    } else if (ev.event === "call.recorded") {
      // the signed audio URL lasts 72 hours and WAVV says not to keep it, so only remember that audio exists
      await patchCallBySid(sid, (c) => { c.wavvRecorded = true; if (d.summary) c.summary = redact(String(d.summary).slice(0, 4000)); return c; });
    }
    return { ok: true, call: sid };
  }
  if (ev.event.startsWith("message.")) {
    const key = `${d.userId || "_team"}/${Date.now()}-${d.id}`;
    await setJ("wavvmsg", key, { event: ev.event, id: d.id, userId: d.userId, contactId: d.contactId, direction: d.direction, number: d.contactNumber, body: redact(String(d.body || "").slice(0, 1600)), failedReason: d.failedReason || undefined, at: Date.now() });
    return { ok: true, message: d.id };
  }
  return { ignored: true };
}

// POST /tokens with the SDK key. WAVV answers 201 {token, expiresIn:60}; a token works once, so nothing here caches it.
export async function mintToken(user) {
  if (!SDK_KEY()) throw httpErr(503, "WAVV isn't connected yet. Add WAVV_SDK_KEY in Cloudflare Pages → Settings → Variables and secrets.");
  let r;
  try {
    r = await fetch(API + "/tokens", {
      method: "POST", headers: { authorization: "Bearer " + SDK_KEY(), "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ userId: user.identity }),
    });
  } catch { throw httpErr(502, "Couldn't reach WAVV. Try again in a moment."); }
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 || r.status === 403) throw httpErr(502, "WAVV rejected the SDK key (" + (j.code || r.status) + "). Check WAVV_SDK_KEY in Cloudflare.");
  if (!r.ok || !j.token) throw httpErr(502, "WAVV couldn't start your session" + (j.code ? " (" + j.code + ")" : "") + ".");
  return { token: j.token, expiresIn: j.expiresIn || 60 };
}

export async function wavvRoute(req, action) {
  return wrap(async () => {
    if (action === "events" && req.method === "POST") {
      if (!HOOK_SECRET()) return bad("WAVV webhooks aren't set up yet (WAVV_WEBHOOK_SECRET).", 503);
      const raw = await req.text();
      if (!verifySignature(raw, req.headers.get("x-wavv-signature"), HOOK_SECRET())) return bad("Bad signature", 401);
      let ev; try { ev = JSON.parse(raw); } catch { return bad("Bad JSON", 400); }
      await handleEvent(ev); // always 2xx once the signature is good, or WAVV retries a payload we can't use
      return json({ ok: true });
    }
    const user = await requireUser(req);
    if (action === "status") return json({ configured: !!SDK_KEY(), webhook: !!HOOK_SECRET() });
    if (action === "token" && req.method === "POST") return json(await mintToken(user), 200, { "cache-control": "no-store" });
    return bad("Not found", 404);
  })(req);
}
