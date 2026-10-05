// Texting from the same local numbers
//  GET  /api/dialer/sms               my threads
//  GET  /api/dialer/sms?with=3055551234  one thread
//  POST /api/dialer/sms/send  {to, body, leadId}
//  POST /api/dialer/sms/in    (Twilio inbound)
import { wrap, json, bad, xml, requireUser, twilioParams, getJ, setJ, updateJ, listKeys, tw, to10, e164, pickCallerId, config as loadConfig, isDnc, siteUrl } from "../lib/hp.mjs";

const STOP = /^\s*(stop|stopall|unsubscribe|cancel|end|quit|revoke|optout|opt out)\s*$/i;

export default wrap(async (req) => {
  const u = new URL(req.url); const action = u.pathname.split("/").pop();

  if (action === "in") {
    const p = await twilioParams(req);
    const from = to10(p.From); const num = (await getJ("numbers", "all"))?.[p.To] || {};
    const owner = num.owner || "_team";
    await updateJ("sms", `${owner}/${from}`, (t) => { t.with = from; t.line = p.To; t.unread = (t.unread || 0) + 1; t.last = Date.now(); t.msgs = [...(t.msgs || []), { dir: "in", body: String(p.Body || "").slice(0, 1600), at: Date.now() }].slice(-200); return t; }, {});
    if (STOP.test(p.Body || "")) await setJ("dnc", from, { at: Date.now(), reason: "Replied STOP by text", by: "lead" });
    return xml(""); // Twilio's own opt-out handling sends the STOP confirmation
  }

  const user = await requireUser(req);
  if (req.method === "GET") {
    const w = to10(u.searchParams.get("with") || "");
    if (w) { const t = await updateJ("sms", `${user.identity}/${w}`, (t) => (t.with ? { ...t, unread: 0 } : undefined), {}); return json({ thread: t || null }); }
    const keys = (await listKeys("sms", user.identity + "/")).slice(-200);
    const threads = (await Promise.all(keys.map((k) => getJ("sms", k)))).filter(Boolean).map((t) => ({ with: t.with, line: t.line, unread: t.unread || 0, last: t.last, preview: t.msgs?.at(-1)?.body?.slice(0, 80) || "" })).sort((a, b) => b.last - a.last);
    return json({ threads });
  }

  if (action === "send") {
    const b = await req.json(); const to = to10(b.to); const body = String(b.body || "").trim().slice(0, 1600);
    if (!to || !body) return bad("Add a number and a message.");
    if (await isDnc(to)) return bad("This number opted out. You can't text it.");
    const cfg = await loadConfig();
    const thread = await getJ("sms", `${user.identity}/${to}`);
    const from = thread?.line || (await pickCallerId(user, to, cfg.settings))?.e164;
    if (!from) return bad("You need a number before you can text.");
    const m = await tw("/Accounts/{SID}/Messages.json", { method: "POST", form: { To: e164(to), From: from, Body: body, StatusCallback: siteUrl() + "/api/dialer/events?type=sms" } });
    const t = await updateJ("sms", `${user.identity}/${to}`, (t) => { t.with = to; t.line = from; t.last = Date.now(); t.leadId = b.leadId || t.leadId; t.msgs = [...(t.msgs || []), { dir: "out", body, at: Date.now(), sid: m.sid, by: user.name }].slice(-200); return t; }, {});
    return json({ ok: true, thread: t });
  }
  return bad("Unknown action", 404);
});

export const config = { path: ["/api/dialer/sms", "/api/dialer/sms/*"] };
