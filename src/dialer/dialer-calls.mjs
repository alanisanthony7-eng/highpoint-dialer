// Calls, analytics, recordings, transcripts, DNC and inbox
//  GET  /api/dialer/calls?days=7&agent=me|all|<identity>
//  GET  /api/dialer/calls/live?sid=            call record + live transcript
//  POST /api/dialer/calls/dispo   {sid, disposition, note, leadId}
//  GET  /api/dialer/calls/recording?sid=       mp3 stream (owner or admin)
//  GET  /api/dialer/calls/analytics?days=7&agent=
//  GET/POST/DELETE /api/dialer/calls/dnc
//  GET  /api/dialer/calls/inbox   POST /api/dialer/calls/inbox {key, done}
import { Buffer } from "node:buffer";
import { wrap, json, bad, requireUser, getJ, setJ, updateJ, store, listKeys, aggregate, patchCallBySid, tw, to10, today, SID, TOKEN, preflight, addAttempt, config as loadConfig, siteUrl, pickCallerId, bumpNumber, saveCall, e164, stateOf } from "../lib/hp.mjs";
import { randomUUID } from "node:crypto";
import { redact } from "../lib/redact.mjs";
import { tx, isTelnyx } from "../telnyx/tx.mjs";
import { callOutcome, leadState } from "../lib/calls.mjs";

const days = (n) => Array.from({ length: n }, (_, i) => today("America/New_York", Date.now() - i * 864e5));
const FIXTURE = "/fixtures/sample-ring.wav";
function isFixtureUrl(url) {
  const u = String(url || "");
  return u.startsWith(FIXTURE) || u.startsWith("demo-recording:") || u.startsWith("demo-");
}
async function telnyxAudio(id, fallbackUrl) {
  const tryUrl = async (url) => {
    if (!url) return null;
    try {
      const r = await fetch(url);
      if (!r.ok) return null;
      return new Response(r.body, { headers: { "content-type": r.headers.get("content-type") || "audio/mpeg", "cache-control": "private, max-age=600" } });
    } catch { return null; }
  };
  if (isFixtureUrl(fallbackUrl) || isFixtureUrl(id)) {
    const local = await tryUrl((siteUrl() || "") + FIXTURE);
    if (local) return local;
  }
  const fromId = async () => {
    if (!id || isFixtureUrl(id)) return null;
    const j = await tx(`/v2/recordings/${id}`).catch(() => null);
    return tryUrl(j?.data?.download_urls?.mp3 || j?.data?.download_urls?.wav);
  };
  return (await fromId()) || (await tryUrl(fallbackUrl));
}

const isTwilioRec = (id) => /^RE[0-9a-f]{32}$/i.test(String(id || ""));
async function twilioAudio(id) {
  if (!SID() || !TOKEN()) return null;
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID()}/Recordings/${id}.mp3`, { headers: { authorization: "Basic " + Buffer.from(SID() + ":" + TOKEN()).toString("base64") } }).catch(() => null);
  return r && r.ok ? new Response(r.body, { headers: { "content-type": "audio/mpeg", "cache-control": "private, max-age=600" } }) : null;
}
async function recordingAudio(id, fallbackUrl) {
  if (isTwilioRec(id)) return twilioAudio(id);
  return telnyxAudio(id, fallbackUrl);
}

export default wrap(async (req) => {
  const user = await requireUser(req);
  const u = new URL(req.url); const q = u.searchParams;
  const action = u.pathname.split("/").filter(Boolean).pop();
  const who = (a) => (!a || a === "me" ? user.identity : user.admin ? a : user.identity);

  if (action === "calls" && req.method === "GET") {
    const n = Math.min(90, +q.get("days") || 7), since = Date.now() - n * 864e5;
    const agents = q.get("agent") === "all" && user.admin ? (await listKeys("agents", "")) : [who(q.get("agent"))];
    const out = [];
    for (const a of agents) {
      const keys = (await listKeys("calls", a + "/")).slice(-600);
      const recs = await Promise.all(keys.map((k) => getJ("calls", k)));
      for (const r of recs) if (r && r.at >= since) out.push(r);
    }
    out.sort((a, b) => b.at - a.at);
    return json({ calls: out.slice(0, 1500) });
  }

  // Telnyx browser calls and "My phone" calls don't pass through the voice webhook, so the browser asks here first:
  // Do Not Call and state calling hours apply the same way.
  if (action === "check" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const cfg = await loadConfig();
    const r = await preflight(user, b.to, cfg.settings, b.leadState || "");
    if (r.ok) await addAttempt(b.to);
    return json(r);
  }

  // Browser line: run the same checks, pick a local caller ID, and open a call record before Telnyx rings.
  if (action === "start" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const cfg = await loadConfig();
    const r = await preflight(user, b.to, cfg.settings, b.leadState || "");
    if (!r.ok) return json(r);
    const prefs = (await getJ("prefs", user.identity)) || {};
    const cid = await pickCallerId(user, b.to, { ...cfg.settings, localPresence: prefs.localPresence ?? cfg.settings.localPresence, useNumbers: prefs.useNumbers }, b.prefer || prefs.defaultCallerId || "");
    if (!cid) return json({ ok: false, why: "Get a phone number first (Number groups tab)" });
    const id = randomUUID().replace(/-/g, "").slice(0, 12);
    const to = to10(b.to);
    const rec = { id, sid: id, webrtcId: String(b.webrtcId || ""), agent: user.identity, dir: "out", mode: "webrtc", to, from: cid.e164, leadId: b.leadId || "", leadName: String(b.leadName || "").slice(0, 80), at: Date.now(), status: "initiated", ...(b.ps ? { ps: true } : {}) };
    await saveCall(rec);
    await addAttempt(b.to);
    await bumpNumber(cid.e164, "dials");
    await aggregate(rec, "dial");
    await updateJ("txlive", to, (x) => {
      const live = x?.sess && !x.endedAt && x.started;
      return Object.assign(x || {}, { owner: user.identity, callSid: rec.sid, callId: rec.id, at: Date.now(), ...(live ? {} : { started: false, startErr: null }) });
    }, {});
    return json({ ok: true, sid: rec.sid, id, callerId: cid.e164 });
  }

  // Client declined recording: stop recording + transcription and erase what was captured.
  if (action === "privacy" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const sid = String(b.sid || ""); const ix = sid && (await getJ("callidx", sid));
    if (ix && ix.agent !== user.identity && !user.admin) return bad("Not your call", 403);
    if (!sid) return json({ ok: true, stopped: false });
    await setJ("txoff", sid, { at: Date.now(), by: user.identity });
    await setJ("tx", sid, { lines: [], declined: true });
    if (ix) await patchCallBySid(sid, (c) => { c.declined = true; c.recordingSid = null; c.recordingUrl = null; return c; });
    const rec = ix && (await getJ("calls", `${ix.agent}/${ix.id}`));
    if (rec?.to) await updateJ("txlive", rec.to, (r) => { Object.assign(r, { declined: true, lines: [], partial: {} }); return r; }, {});
    const live = rec?.to ? await getJ("txlive", rec.to) : null;
    if (live?.ccid) await tx(`/v2/calls/${live.ccid}/actions/transcription_stop`, { method: "POST", body: {} }).catch(() => null);
    if (SID() && TOKEN() && /^CA/.test(sid)) { // Twilio calls
      await tw(`/Accounts/{SID}/Calls/${sid}/Recordings/Twilio.CURRENT.json`, { method: "POST", form: { Status: "stopped" } }).catch(() => null);
      await tw(`/Accounts/{SID}/Calls/${sid}/Transcriptions/hp-${sid}.json`, { method: "POST", form: { Status: "stopped" } }).catch(() => null);
    }
    return json({ ok: true, stopped: true });
  }

  // Recorded cell bridging isn't available on Telnyx. The desk opens the agent's phone app instead.
  if (action === "cell" && req.method === "POST") {
    if (isTelnyx()) return bad("Calls to your cell are only available on Twilio numbers for now.", 400);
    const b = await req.json().catch(() => ({}));
    const prefs = (await getJ("prefs", user.identity)) || {};
    const cell = to10(prefs.cellPhone || "");
    if (!cell) return bad("Save your cell number in Phone settings first.", 400);
    const leadNum = to10(b.to);
    const cfg = await loadConfig(); const S = cfg.settings;
    const check = await preflight(user, leadNum, S, b.leadState || "");
    if (!check.ok) return bad(check.why, 403);
    const cid = await pickCallerId(user, leadNum, { ...S, localPresence: prefs.localPresence ?? S.localPresence, useNumbers: prefs.useNumbers }, prefs.defaultCallerId);
    if (!cid) return bad("You don't have a caller ID number yet. Buy or claim a number in the Numbers tab.", 400);
    const token = crypto.randomUUID().replace(/-/g, "");
    const bridge = { agent: user.identity, agentName: user.name || "", leadId: String(b.leadId || ""), leadName: String(b.leadName || "").slice(0, 80), to: leadNum, from: cid.e164, state: stateOf(leadNum), at: Date.now() };
    await setJ("cellbridge", token, bridge);
    let c;
    try {
      c = await tw("/Accounts/{SID}/Calls.json", {
        method: "POST",
        form: { To: e164(cell), From: cid.e164, Timeout: 25, Url: `${siteUrl()}/api/dialer/voice?step=cell&t=${token}`, Method: "POST" },
      });
    } catch (e) { return bad("Couldn't ring your cell: " + (e.message || "Twilio error"), 503); }
    const sid = c.sid;
    await setJ("cellbridge", token, { ...bridge, sid });
    const rec = { id: sid, sid, agent: user.identity, agentName: bridge.agentName, leadId: bridge.leadId, leadName: bridge.leadName, to: leadNum, from: cid.e164, dir: "out", mode: "cell", at: Date.now(), status: "dialing", state: bridge.state };
    await saveCall(rec);
    await Promise.all([bumpNumber(cid.e164, "dials"), addAttempt(leadNum), aggregate(rec, "dial")]);
    return json({ ok: true, sid, cell });
  }

  // The agent recorded that the client agreed after the disclosure. Kept on the call as evidence.
  if (action === "consent" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const sid = String(b.sid || "");
    if (!sid) return bad("No call to attach consent to", 400);
    const ix = await getJ("callidx", sid);
    if (ix && ix.agent !== user.identity && !user.admin) return bad("Not your call", 403);
    if (await getJ("txoff", sid)) return json({ ok: true, recorded: false });
    if (ix) await patchCallBySid(sid, (c) => { c.consent = { at: Date.now(), by: user.identity }; return c; });
    return json({ ok: true, recorded: !!ix });
  }

  if (action === "live") {
    const sid = q.get("sid"); const ix = await getJ("callidx", sid);
    if (!ix) return json({ call: null });
    if (ix.agent !== user.identity && !user.admin) return bad("Not your call", 403);
    const [call, stored, p1, p2] = await Promise.all([getJ("calls", `${ix.agent}/${ix.id}`), getJ("tx", sid), getJ("txp", `${sid}/inbound_track`), getJ("txp", `${sid}/outbound_track`)]);
    const live = call?.to ? await getJ("txlive", call.to) : null;
    const clean = (l) => ({ ...l, text: redact(l.text) });
    const lines = (stored?.lines?.length ? stored.lines : live?.lines) || [];
    const partial = stored?.lines?.length
      ? [p1, p2].filter((p) => p && p.t > Date.now() - 8000)
      : Object.values(live?.partial || {}).filter((p) => p && p.t > Date.now() - 8000);
    return json({ call: call && { ...call, outcome: callOutcome(call), leadState: leadState(call) }, transcript: lines.map(clean), partial: partial.map(clean) });
  }

  if (action === "dispo") {
    const b = await req.json();
    const rec = await patchCallBySid(b.sid, (c) => {
      if (c.agent !== user.identity && !user.admin) return undefined;
      c.disposition = String(b.disposition || "").slice(0, 60); c.note = redact(String(b.note || "").slice(0, 2000));
      if (b.leadId) c.leadId = b.leadId; c.dispoAt = Date.now();
      if (b.recordingUrl) c.recordingUrl = String(b.recordingUrl).slice(0, 2000);
      if (b.recordingSid) c.recordingSid = String(b.recordingSid).slice(0, 80);
      return c;
    });
    if (!rec) return bad("Call not found", 404);
    await aggregate({ ...rec, at: rec.at }, "dispo");
    if (/do not call|dnc/i.test(b.disposition)) await setJ("dnc", rec.to, { at: Date.now(), by: user.identity, reason: "Agent marked Do Not Call" });
    return json({ ok: true, call: rec });
  }

  if (action === "status") { // time spent in Ready / Break / Lunch…
    const b = await req.json().catch(() => ({}));
    const st = String(b.status || "").replace(/[^a-z]/g, "").slice(0, 12), sec = Math.max(0, Math.min(43200, +b.sec || 0));
    if (st && sec) await updateJ("stats", `${today()}/a/${user.identity}`, (a) => { a.statusSec = a.statusSec || {}; a.statusSec[st] = (a.statusSec[st] || 0) + sec; return a; }, {});
    return json({ ok: true });
  }

  if (action === "recording") {
    const sid = q.get("sid"); const ix = await getJ("callidx", sid);
    const rec = ix && (await getJ("calls", `${ix.agent}/${ix.id}`));
    if (!rec?.recordingSid && !rec?.recordingUrl) return bad("No recording for this call", 404);
    if (rec.agent !== user.identity && !user.admin) return bad("Not your call", 403);
    if (rec.declined) return bad("The client declined recording, so this call has no recording.", 404);
    const audio = await recordingAudio(rec.recordingSid, rec.recordingUrl);
    if (!audio) return bad("Recording isn't ready yet", 404);
    return audio;
  }

  if (action === "transcript") {
    const sid = q.get("sid"); const ix = await getJ("callidx", sid);
    if (!ix || (ix.agent !== user.identity && !user.admin)) return bad("Not found", 404);
    const stored = ((await getJ("tx", sid)) || {}).lines || [];
    const rec = await getJ("calls", `${ix.agent}/${ix.id}`);
    const live = !stored.length && rec?.to ? ((await getJ("txlive", rec.to)) || {}).lines || [] : [];
    return json({ lines: (stored.length ? stored : live).map((l) => ({ ...l, text: redact(l.text) })) });
  }

  if (action === "analytics") {
    const n = Math.min(90, +q.get("days") || 7);
    const wantAll = q.get("agent") === "all" && user.admin;
    const agentIds = wantAll ? await listKeys("agents", "") : [who(q.get("agent"))];
    const names = {};
    for (const a of agentIds) names[a] = (await getJ("agents", a))?.name || a;
    const sum = () => ({ dials: 0, answered: 0, connects: 0, machines: 0, abandoned: 0, short: 0, talkSec: 0, appts: 0, dispo: {}, hours: {}, statusSec: {} });
    const total = sum(), per = {}, byDay = {};
    const merge = (t, a) => {
      for (const k of ["dials", "answered", "connects", "machines", "abandoned", "short", "talkSec", "appts"]) t[k] += a[k] || 0;
      for (const [k, v] of Object.entries(a.dispo || {})) t.dispo[k] = (t.dispo[k] || 0) + v;
      for (const [k, v] of Object.entries(a.statusSec || {})) t.statusSec[k] = (t.statusSec[k] || 0) + v;
      for (const [h, v] of Object.entries(a.hours || {})) { const z = (t.hours[h] = t.hours[h] || { dials: 0, answered: 0, connects: 0 }); z.dials += v.dials || 0; z.answered += v.answered || 0; z.connects += v.connects || 0; }
    };
    for (const d of days(n)) {
      byDay[d] = sum();
      const docs = await Promise.all(agentIds.map((a) => getJ("stats", `${d}/a/${a}`)));
      docs.forEach((a, i) => { if (!a) return; merge(total, a); merge(byDay[d], a); merge((per[agentIds[i]] = per[agentIds[i]] || sum()), a); });
    }
    // number performance
    const nums = Object.values((await getJ("numbers", "all")) || {}).filter((z) => !z.released && (wantAll || z.owner === user.identity));
    const numbers = nums.map((z) => {
      let dials = 0, answered = 0, short = 0;
      for (const d of days(n)) { const v = z.days?.[d]; if (v) { dials += v.dials || 0; answered += v.answered || 0; short += v.short || 0; } }
      return { e164: z.e164, label: z.label, dials, answered, short, answerRate: dials ? answered / dials : 0 };
    }).sort((a, b) => b.dials - a.dials);
    return json({
      days: n, total, numbers,
      byDay: Object.entries(byDay).reverse().map(([d, v]) => ({ day: d, ...v, hours: undefined, dispo: undefined })),
      agents: Object.entries(per).map(([id, v]) => ({ id, name: names[id], ...v, hours: undefined })).sort((a, b) => b.appts - a.appts || b.connects - a.connects),
    });
  }

  // scrub a list against the National DNC, state DNC lists and TCPA litigators (cached 30 days per number)
  if (action === "scrub") {
    const { scrubOn, scrub, blockWhy, SCRUB_DEFAULTS } = await import("../lib/scrub.mjs");
    const cfg = await loadConfig(), set = { ...SCRUB_DEFAULTS, ...(cfg.settings.scrub || {}) };
    if (req.method === "GET") return json({ on: scrubOn() && set.on !== false, configured: scrubOn(), settings: set });
    if (!scrubOn() || set.on === false) return json({ on: false, results: {} });
    const b = await req.json().catch(() => ({}));
    const list = [...new Set((b.numbers || []).map(to10).filter(Boolean))].slice(0, 250), results = {};
    let i = 0;
    await Promise.all(Array.from({ length: 6 }, async () => { while (i < list.length) { const n = list[i++]; const r = await scrub(n); results[n] = { status: r.status, why: r.status === "error" ? r.why : blockWhy(r, set) || "", blocked: !!blockWhy(r, set), at: r.at || Date.now() }; } }));
    return json({ on: true, results });
  }

  if (action === "dnc") {
    if (req.method === "GET") {
      const keys = await listKeys("dnc", "");
      return json({ count: keys.length, numbers: user.admin ? keys.slice(0, 5000) : undefined, check: q.get("n") ? !!(await getJ("dnc", to10(q.get("n")))) : undefined });
    }
    const b = await req.json();
    const list = (Array.isArray(b.numbers) ? b.numbers : [b.number]).map(to10).filter(Boolean).slice(0, 5000);
    if (req.method === "POST") { for (const n of list) await setJ("dnc", n, { at: Date.now(), by: user.identity, reason: b.reason || "Added by agent" }); return json({ ok: true, added: list.length }); }
    if (req.method === "DELETE") { if (!user.admin) return bad("Only admins can remove numbers from Do Not Call.", 403); for (const n of list) await store("dnc").delete(n); return json({ ok: true }); }
  }

  if (action === "inbox") {
    const prefixes = [user.identity + "/", ...(user.admin ? ["_team/"] : [])];
    if (req.method === "GET") {
      const items = [];
      for (const p of prefixes) for (const k of (await listKeys("inbox", p)).slice(-150)) { const v = await getJ("inbox", k); if (v) items.push({ ...v, key: k }); }
      return json({ items: items.sort((a, b) => b.at - a.at) });
    }
    const b = await req.json();
    if (!prefixes.some((p) => String(b.key).startsWith(p))) return bad("Not yours", 403);
    if (b.done) await store("inbox").delete(b.key);
    return json({ ok: true });
  }

  if (action === "vmaudio") { // inbound voicemail playback
    const k = q.get("key"); if (!k?.startsWith(user.identity + "/") && !(user.admin && k?.startsWith("_team/"))) return bad("Not yours", 403);
    const v = await getJ("inbox", k); if (!v?.recordingSid) return bad("Not found", 404);
    const audio = await recordingAudio(v.recordingSid);
    return audio || bad("Not found", 404);
  }
  return bad("Unknown action", 404);
});

export const config = { path: ["/api/dialer/calls", "/api/dialer/calls/*"] };
