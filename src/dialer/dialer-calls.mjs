// Calls, analytics, recordings, transcripts, DNC and inbox
//  GET  /api/dialer/calls?days=7&agent=me|all|<identity>
//  GET  /api/dialer/calls/live?sid=            call record + live transcript
//  POST /api/dialer/calls/dispo   {sid, disposition, note, leadId}
//  GET  /api/dialer/calls/recording?sid=       mp3 stream (owner or admin)
//  GET  /api/dialer/calls/analytics?days=7&agent=
//  GET/POST/DELETE /api/dialer/calls/dnc
//  GET  /api/dialer/calls/inbox   POST /api/dialer/calls/inbox {key, done}
import { Buffer } from "node:buffer";
import { wrap, json, bad, requireUser, getJ, setJ, updateJ, store, listKeys, aggregate, patchCallBySid, tw, to10, today, SID, TOKEN } from "../lib/hp.mjs";

const days = (n) => Array.from({ length: n }, (_, i) => today("America/New_York", Date.now() - i * 864e5));

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

  if (action === "live") {
    const sid = q.get("sid"); const ix = await getJ("callidx", sid);
    if (!ix) return json({ call: null });
    if (ix.agent !== user.identity && !user.admin) return bad("Not your call", 403);
    const [call, tx, p1, p2] = await Promise.all([getJ("calls", `${ix.agent}/${ix.id}`), getJ("tx", sid), getJ("txp", `${sid}/inbound_track`), getJ("txp", `${sid}/outbound_track`)]);
    return json({ call, transcript: tx?.lines || [], partial: [p1, p2].filter((p) => p && p.t > Date.now() - 8000) });
  }

  if (action === "dispo") {
    const b = await req.json();
    const rec = await patchCallBySid(b.sid, (c) => {
      if (c.agent !== user.identity && !user.admin) return undefined;
      c.disposition = String(b.disposition || "").slice(0, 60); c.note = String(b.note || "").slice(0, 2000);
      if (b.leadId) c.leadId = b.leadId; c.dispoAt = Date.now(); return c;
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
    if (!rec?.recordingSid) return bad("No recording for this call", 404);
    if (rec.agent !== user.identity && !user.admin) return bad("Not your call", 403);
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID()}/Recordings/${rec.recordingSid}.mp3`, { headers: { authorization: "Basic " + Buffer.from(SID() + ":" + TOKEN()).toString("base64") } });
    if (!r.ok) return bad("Recording isn't ready yet", 404);
    return new Response(r.body, { headers: { "content-type": "audio/mpeg", "cache-control": "private, max-age=600" } });
  }

  if (action === "transcript") {
    const sid = q.get("sid"); const ix = await getJ("callidx", sid);
    if (!ix || (ix.agent !== user.identity && !user.admin)) return bad("Not found", 404);
    return json({ lines: ((await getJ("tx", sid)) || {}).lines || [] });
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
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID()}/Recordings/${v.recordingSid}.mp3`, { headers: { authorization: "Basic " + Buffer.from(SID() + ":" + TOKEN()).toString("base64") } });
    return new Response(r.body, { status: r.status, headers: { "content-type": "audio/mpeg" } });
  }
  return bad("Unknown action", 404);
});

export const config = { path: ["/api/dialer/calls", "/api/dialer/calls/*"] };
