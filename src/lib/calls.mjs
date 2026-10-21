// Call-control helpers shared by events, power dial and voicemail drop
import { tw, signedUrl, siteUrl, x, getJ, updateJ, patchCallBySid } from "./hp.mjs";

export function txStart(callSid, inboundLabel, outboundLabel) {
  return `<Start><Transcription name="hp-${x(callSid)}" statusCallbackUrl="${x(`${siteUrl()}/api/dialer/events?type=tx&c=${callSid}&in=${inboundLabel}&out=${outboundLabel}`)}" track="both_tracks" partialResults="true" inboundTrackLabel="${inboundLabel}" outboundTrackLabel="${outboundLabel}" languageCode="en-US"/></Start>`;
}



export const greetingUrl = (key) => signedUrl("/api/dialer/vm/audio", { k: key }, 6 * 3600);

// Play a pre-recorded voicemail into a live call, then hang up that leg.
export async function dropVoicemail(leadCallSid, greetingKey) {
  const g = await getJ("vmmeta", greetingKey);
  if (!g) throw new Error("That voicemail greeting no longer exists.");
  await tw(`/Accounts/{SID}/Calls/${leadCallSid}.json`, { method: "POST", form: { Twiml: `<Response><Play>${x(greetingUrl(greetingKey))}</Play><Hangup/></Response>` } });
  return g;
}
export async function hangup(callSid, ringingOnly = false) {
  return tw(`/Accounts/{SID}/Calls/${callSid}.json`, { method: "POST", form: { Status: ringingOnly ? "canceled" : "completed" } }).catch(() => null);
}
// The lead-side leg of a browser call (child of the agent's call)
export async function childOf(parentSid) {
  const r = await tw("/Accounts/{SID}/Calls.json", { query: { ParentCallSid: parentSid, PageSize: 5 } });
  return (r.calls || []).find((c) => ["in-progress", "ringing", "queued"].includes(c.status))?.sid || r.calls?.[0]?.sid || null;
}

/* ---------- multi-line session state ---------- */
export const sessKey = (agent, s) => `${agent}/${s}`;
export async function sess(agent, s) { return getJ("power", sessKey(agent, s)); }
export async function updSess(agent, s, fn) { return updateJ("power", sessKey(agent, s), (v) => (v && v.id ? fn(v) : undefined), null); }

export const isMachine = (a) => /^machine|^fax/.test(a || "");
export { patchCallBySid };
/* ---------- how a browser call ended, for the desk's log ----------
   Only a call a person answered gets the agent's "Log this call" popup. Everything else logs itself:
   voicemail keeps the note detection wrote, the rest are No answer with the reason. final=false means Telnyx
   hasn't said why yet (the desk asks again shortly). */
export function callOutcome(c) {
  if (!c) return null;
  const done = (kind, note, label = "No answer") => ({ kind, label, note, final: true });
  if (c.machine || isMachine(c.amd)) return done("voicemail", c.note || "Voicemail detected", c.disposition || "No answer");
  if (c.human || c.answeredAt) return { kind: "answered", final: true };
  if (c.agentCancel) return done("cancel", "Agent hung up while ringing");
  const cause = String(c.cause || "").toLowerCase(), sip = +c.sipCause || 0;
  if (/busy/.test(cause) || sip === 486 || sip === 600) return done("busy", "Busy");
  if (c.status === "failed" || c.amd === "dial-failed" || /not_found|unallocated|invalid|failure|congestion|unavailable|incompatible/.test(cause) || [403, 404, 410, 484, 488, 502, 503, 603].includes(sip)) return done("failed", "Call failed");
  if (cause || c.final) return done("no-answer", "Rang out");
  return { kind: "pending", label: "No answer", note: "Rang out", final: false };
}

/* What the desk shows for the lead while a browser call is up: dialing → ringing → connected, or voicemail / ended.
   With voicemail detection the agent's own leg is parked (it looks answered at once), so this follows the lead:
   their phone ringing and the ~2 s check after they pick up are both "ringing"; "connected" is the agent bridged
   to a person. Calls without detection are connected when Telnyx says the lead answered. */
export function leadState(c) {
  if (!c) return "";
  if (c.machine || isMachine(c.amd)) return "voicemail";
  if (c.answeredAt && (!c.amd || c.bridgedAt)) return c.final ? "ended" : "connected";
  if (c.final || c.endedAt || c.cause || c.agentCancel || c.status === "failed" || c.amd === "dial-failed") return "ended";
  if (c.ringingAt || (c.amd && c.amd !== "pending") || (!c.amd && c.ccid)) return "ringing";
  return "dialing";
}
