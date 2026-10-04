// Call-control helpers shared by events, power dial and voicemail drop
import { tw, signedUrl, siteUrl, x, getJ, updateJ, patchCallBySid } from "./hp.mjs";

export function txStart(callSid, inboundLabel, outboundLabel) {
  return `<Start><Transcription name="hp-${x(callSid)}" statusCallbackUrl="${x(`${siteUrl()}/api/dialer/events?type=tx&c=${callSid}`)}" track="both_tracks" partialResults="true" inboundTrackLabel="${inboundLabel}" outboundTrackLabel="${outboundLabel}" languageCode="en-US"/></Start>`;
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
