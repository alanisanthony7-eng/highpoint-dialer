/* ---------- voicemail detection for browser calls ----------
   The browser's call is parked (outbound call parking on the credential connection), so the lead's audio never
   reaches the agent on its own. We dial the lead with Telnyx answering machine detection, linked to the parked leg.
   A person, or a result Telnyx isn't sure about, gets the agent: answer the parked leg and bridge it to the lead.
   A machine never reaches the agent: the parked leg is hung up (their ringing just stops), the call is logged
   No answer · Voicemail detected, and in a power session with "leave my voicemail automatically" on, the agent's
   default drop plays at the beep. State per agent call: txamd/<parked call_control_id>. */
import { getJ, setJ, updateJ, listKeys, patchCallBySid, e164, siteUrl, config as loadConfig } from "../lib/hp.mjs";
import { greetingUrl } from "../lib/calls.mjs";
import { tx, startMedia, logEvent } from "./tx.mjs";

const act = (ccid, action, body = {}) => tx(`/v2/calls/${ccid}/actions/${action}`, { method: "POST", body });
const b64json = (o) => btoa(JSON.stringify(o));
// Machines and fax lose the call. human_*, not_sure, silence and anything new connect: never drop a real person.
export const isMachineResult = (r) => /^(machine|fax)/i.test(String(r || ""));
// greeting_duration_millis: a greeting longer than this is a machine (Telnyx default 3500).
// total_analysis_time_millis: no decision by then = not_sure, which connects. It also bounds the wait for the beep,
// so it stays long when a drop has to play after the beep.
export const amdConfig = (drop) => ({ greeting_duration_millis: 3000, total_analysis_time_millis: drop ? 30000 : 5000 });
const NOTE = "Voicemail detected", NOTE_VM = "Voicemail detected · VM dropped";

async function autoDrop(rec) {
  if (!rec?.ps || !rec.agent) return "";
  const p = (await getJ("prefs", rec.agent)) || {};
  if (!p.autoVm) return "";
  const mine = (k) => k && String(k).startsWith(rec.agent + "/");
  const key = mine(p.vmGreeting) ? p.vmGreeting : (await listKeys("vmmeta", rec.agent + "/"))[0] || "";
  return key && (await getJ("vmmeta", key)) ? key : "";
}

// call.initiated for the agent's parked leg: dial the lead with detection
export async function amdDial(m, p, rec) {
  const web = m.ccid;
  if (!rec) {
    await act(web, "hangup").catch(() => {});
    return "parked call without a call record (the desk didn't start it): not dialed";
  }
  const cfg = await loadConfig();
  const drop = await autoDrop(rec);
  await setJ("txamd", web, { web, lead: m.lead, sess: m.sess, callSid: rec.sid, agent: rec.agent, drop, at: Date.now() });
  const body = {
    connection_id: cfg.tx?.appId || cfg.tx?.connId || p.connection_id,
    to: e164(m.lead), from: e164(p.from) || rec.from, link_to: web, timeout_secs: 30,
    answering_machine_detection: "premium", answering_machine_detection_config: amdConfig(drop),
    client_state: b64json({ amd: web }), webhook_url: `${siteUrl()}/api/telnyx/events`,
  };
  let r = null, mode = "premium", err = "";
  try { r = await tx("/v2/calls", { method: "POST", body }); }
  catch (e) {
    err = e.message;
    if (/premium|answering|machine|amd/i.test(err)) { // the account can't use premium: standard detection, same timings
      mode = "detect";
      const std = { ...body, answering_machine_detection: "detect", answering_machine_detection_config: { ...amdConfig(drop), after_greeting_silence_millis: 800, initial_silence_millis: 3500 } };
      try { r = await tx("/v2/calls", { method: "POST", body: std }); err = ""; } catch (e2) { err = e2.message; }
    }
  }
  const pstn = r?.data?.call_control_id || "";
  if (!pstn) {
    await patchCallBySid(rec.sid, (c) => Object.assign(c, { status: "failed", amd: "dial-failed" }));
    await act(web, "hangup").catch(() => {});
    return "couldn't dial the lead: " + (err || "no call id");
  }
  await updateJ("txamd", web, (s) => (s ? Object.assign(s, { pstn, mode }) : undefined), null);
  await setJ("txcc", pstn, { lead: m.lead, sess: m.sess, amd: web });
  await patchCallBySid(rec.sid, (c) => Object.assign(c, { amd: "pending", amdMode: mode, leadCcid: pstn }));
  return `dialing the lead with ${mode} voicemail detection${drop ? " (drop at the beep)" : ""}`;
}

async function decide(web, pstn, result) {
  let first = false;
  const s = await updateJ("txamd", web, (x) => {
    if (!x || x.decided || x.agentEnded || x.leadEnded) return undefined;
    first = true;
    return Object.assign(x, { decided: isMachineResult(result) ? "machine" : "human", result, decidedAt: Date.now(), pstn: x.pstn || pstn });
  }, null);
  if (!first) return null;
  const ms = s.answeredAt ? s.decidedAt - s.answeredAt : null;
  return s.decided === "human" ? connectAgent(s, ms) : machine(s, ms);
}

async function bridge(s) {
  try { await act(s.web, "bridge", { call_control_id: s.pstn }); }
  catch (e) { await updateJ("txamd", s.web, (x) => (x ? Object.assign(x, { bridgeWait: true }) : undefined), null); return "bridge waits for the agent's answer: " + e.message; }
  await updateJ("txamd", s.web, (x) => (x ? Object.assign(x, { bridged: true, bridgeWait: false }) : undefined), null);
  await patchCallBySid(s.callSid, (c) => (c.bridgedAt ? undefined : Object.assign(c, { bridgedAt: Date.now() }))); // the desk shows Connected from here
  return "";
}

async function connectAgent(s, ms) {
  await patchCallBySid(s.callSid, (c) => Object.assign(c, { amd: s.result, amdMs: ms, status: "in-progress", answered: true, answeredAt: Date.now() }));
  // the lead's leg is the one voicemail drop and a client's decline act on
  await updateJ("txlive", s.lead, (r) => { if (r.sess === s.sess) r.ccid = s.pstn; return r; }, {});
  try { await act(s.web, "answer"); }
  catch (e) { await act(s.pstn, "hangup").catch(() => {}); return "the agent's line was gone: " + e.message; }
  const wait = await bridge(s);
  const media = await startMedia(s.lead, s.sess, s.pstn);
  return `${s.result}${ms != null ? ` after ${ms} ms` : ""}: agent connected${wait ? " (" + wait + ")" : ""}, ${media}`;
}

async function machine(s, ms) {
  await patchCallBySid(s.callSid, (c) => Object.assign(c, {
    amd: s.result, amdMs: ms, machine: true, human: false, answered: true, disposition: "No answer", note: s.drop ? NOTE_VM : NOTE, autoLogged: "voicemail", dispoAt: Date.now(), ...(s.drop ? { vmDrop: s.drop } : {}),
  }));
  await act(s.web, "hangup").catch(() => {});
  if (!s.drop) await act(s.pstn, "hangup").catch(() => {});
  return `${s.result}${ms != null ? ` after ${ms} ms` : ""}: agent not connected, logged No answer${s.drop ? ", drop waits for the beep" : ""}`;
}

async function playDrop(web) {
  let first = false;
  const s = await updateJ("txamd", web, (x) => { if (!x || x.decided !== "machine" || !x.drop || x.dropped || x.leadEnded) return undefined; first = true; return Object.assign(x, { dropped: Date.now() }); }, null);
  if (!first) return "";
  try { await act(s.pstn, "playback_start", { audio_url: greetingUrl(s.drop) }); }
  catch (e) {
    await act(s.pstn, "hangup").catch(() => {});
    await patchCallBySid(s.callSid, (c) => Object.assign(c, { note: NOTE }));
    return "voicemail drop failed: " + e.message;
  }
  await patchCallBySid(s.callSid, (c) => Object.assign(c, { vmDropped: s.drop, note: NOTE_VM }));
  return "voicemail drop playing";
}

// Events on the lead's leg (tagged with client_state {amd}). null = let the normal handler take it (recordings).
export async function amdLeadEvent(type, p, web) {
  const pstn = p.call_control_id || "";
  if (type === "call.initiated") {
    const s = await getJ("txamd", web);
    if (s?.callSid) await patchCallBySid(s.callSid, (c) => (c.ringingAt ? undefined : Object.assign(c, { ringingAt: Date.now() })));
    return "lead's phone ringing";
  }
  if (type === "call.answered") {
    await updateJ("txamd", web, (x) => (x && !x.answeredAt ? Object.assign(x, { answeredAt: Date.now() }) : undefined), null);
    return "lead picked up: checking for voicemail";
  }
  if (type === "call.machine.premium.detection.ended" || type === "call.machine.detection.ended") {
    return (await decide(web, pstn, p.result || "not_sure")) ?? "already decided";
  }
  if (type === "call.machine.premium.greeting.ended" || type === "call.machine.greeting.ended") {
    // a beep before detection.ended means a machine (Telnyx then skips detection.ended)
    const first = /beep/i.test(p.result || "") ? await decide(web, pstn, "machine") : null;
    const drop = await playDrop(web);
    return [first, drop].filter(Boolean).join("; ") || "greeting ended";
  }
  if (type === "call.playback.ended") {
    const s = await getJ("txamd", web);
    if (s?.dropped) { await act(pstn, "hangup").catch(() => {}); return "voicemail drop played"; }
    return "playback ended";
  }
  if (type === "call.hangup") {
    const s = await updateJ("txamd", web, (x) => (x ? Object.assign(x, { leadEnded: Date.now() }) : undefined), null);
    if (!s) return "lead's leg ended";
    const cause = p.hangup_cause || "", sip = String(p.sip_hangup_cause || "");
    // the cause is saved before the agent's side ends, so the desk can read why as soon as its ringing stops
    await patchCallBySid(s.callSid, (c) => {
      if (cause && !c.cause) c.cause = cause;
      if (sip && !c.sipCause) c.sipCause = sip;
      if (s.drop && !s.dropped && c.note === NOTE_VM) c.note = NOTE; // hung up before the beep: nothing was left
      return c;
    });
    await act(web, "hangup").catch(() => {}); // no answer, busy, failed or done: the agent's side ends too
    return `lead's leg ended (${cause || "hangup"})`;
  }
  return null;
}

// The agent's parked leg answered (we answered it for a person): bridge if the first try was too early
export async function amdAgentAnswered(s) {
  if (s.bridgeWait && s.pstn && !s.bridged) return (await bridge(s)) || "agent connected";
  return "agent connected";
}

// The agent's leg ended: stop the lead's leg too, unless a voicemail drop is still to play there
export async function amdAgentGone(s) {
  const cur = await updateJ("txamd", s.web, (x) => (x ? Object.assign(x, { agentEnded: x.agentEnded || Date.now() }) : undefined), null) || s;
  const keep = cur.decided === "machine" && cur.drop && !cur.leadEnded;
  if (cur.pstn && !cur.leadEnded && !keep) await act(cur.pstn, "hangup").catch(() => {});
  if (!cur.decided && !cur.leadEnded) await patchCallBySid(cur.callSid, (c) => (c.answeredAt || c.cause ? undefined : Object.assign(c, { agentCancel: true }))).catch(() => {});
  if (!cur.decided) await logEvent({ type: "amd", note: "agent hung up before the lead answered or detection finished" }).catch(() => {});
}
