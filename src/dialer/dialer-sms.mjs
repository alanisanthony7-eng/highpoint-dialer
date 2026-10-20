// Texting from the same local numbers (Twilio or Telnyx)
//  GET  /api/dialer/sms               my threads
//  GET  /api/dialer/sms?with=3055551234  one thread
//  POST /api/dialer/sms/send  {to, body, leadId}
//  POST /api/dialer/sms/in    (Twilio inbound; Telnyx inbound arrives on /api/telnyx/events)
import { wrap, json, bad, xml, requireUser, twilioParams, getJ, updateJ, listKeys, to10 } from "../lib/hp.mjs";
import { sendText, receiveText } from "../lib/sms.mjs";

export default wrap(async (req) => {
  const u = new URL(req.url); const action = u.pathname.split("/").pop();

  if (action === "in") {
    const p = await twilioParams(req);
    await receiveText({ from: p.From, line: p.To, body: p.Body });
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
    const b = await req.json();
    return json({ ok: true, thread: await sendText({ user, to: b.to, body: b.body, leadId: b.leadId }) });
  }
  return bad("Unknown action", 404);
});

export const config = { path: ["/api/dialer/sms", "/api/dialer/sms/*"] };
