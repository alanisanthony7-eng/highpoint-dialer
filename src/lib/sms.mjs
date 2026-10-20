// Sending a text from the agent's local numbers, on Twilio or Telnyx, into the same threads the Inbox shows.
import { getJ, updateJ, tw, to10, e164, pickCallerId, config as loadConfig, isDnc, siteUrl, httpErr, setJ } from "./hp.mjs";
import { isTelnyx, tx } from "../telnyx/tx.mjs";

export const STOP = /^\s*(stop|stopall|unsubscribe|cancel|end|quit|revoke|optout|opt out)\s*$/i;

// Telnyx texts go out through a messaging profile; make one (and put our numbers on it) the first time
export async function txMessagingProfile() {
  const cfg = await loadConfig(), t = cfg.tx || {};
  if (t.msgProfileId) return t.msgProfileId;
  let id = null;
  try {
    const list = (await tx("/v2/messaging_profiles", { query: { "page[size]": 50 } })).data || [];
    const hook = siteUrl() + "/api/telnyx/events";
    const found = list.find((p) => p.name === "Highpoint Desk");
    id = found?.id || (await tx("/v2/messaging_profiles", { method: "POST", body: { name: "Highpoint Desk", enabled: true, webhook_url: hook, webhook_api_version: "2", whitelisted_destinations: ["US"] } })).data.id;
    const all = (await getJ("numbers", "all")) || {};
    for (const n of Object.values(all)) if (!n.released && n.provider === "telnyx" && n.sid) await tx(`/v2/phone_numbers/${n.sid}/messaging`, { method: "PATCH", body: { messaging_profile_id: id } }).catch(() => {});
    await setJ("config", "app", { ...cfg, tx: { ...t, msgProfileId: id } });
  } catch (e) { console.error("messaging profile", e.message); }
  return id;
}

// user: { identity, name } (the agent the text is from)
export async function sendText({ user, to, body, leadId, auto }) {
  to = to10(to); body = String(body || "").trim().slice(0, 1600);
  if (!to || !body) throw httpErr(400, "Add a number and a message.");
  if (await isDnc(to)) throw httpErr(400, "This number opted out. You can't text it.");
  const cfg = await loadConfig();
  const thread = await getJ("sms", `${user.identity}/${to}`);
  const from = thread?.line || (await pickCallerId(user, to, cfg.settings))?.e164;
  if (!from) throw httpErr(400, "You need a number before you can text.");
  let sid = "";
  if (isTelnyx()) {
    const prof = await txMessagingProfile();
    sid = (await tx("/v2/messages", { method: "POST", body: { from, to: e164(to), text: body, ...(prof ? { messaging_profile_id: prof } : {}) } })).data?.id || "";
  } else {
    sid = (await tw("/Accounts/{SID}/Messages.json", { method: "POST", form: { To: e164(to), From: from, Body: body, StatusCallback: siteUrl() + "/api/dialer/events?type=sms" } })).sid;
  }
  return updateJ("sms", `${user.identity}/${to}`, (t) => {
    t.with = to; t.line = from; t.last = Date.now(); t.leadId = leadId || t.leadId;
    t.msgs = [...(t.msgs || []), { dir: "out", body, at: Date.now(), sid, by: auto ? "Automatic text" : user.name, ...(auto ? { auto } : {}) }].slice(-200);
    return t;
  }, {});
}

// a text that came in (Twilio or Telnyx): into the owner's thread; STOP adds the number to Do Not Call
export async function receiveText({ from, line, body }) {
  from = to10(from);
  const num = (await getJ("numbers", "all"))?.[line] || {};
  const owner = num.owner || "_team";
  await updateJ("sms", `${owner}/${from}`, (t) => { t.with = from; t.line = line; t.unread = (t.unread || 0) + 1; t.last = Date.now(); t.msgs = [...(t.msgs || []), { dir: "in", body: String(body || "").slice(0, 1600), at: Date.now() }].slice(-200); return t; }, {});
  if (STOP.test(body || "")) await setJ("dnc", from, { at: Date.now(), reason: "Replied STOP by text", by: "lead" });
}
