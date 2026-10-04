// Twilio voice webhooks (TwiML).
//  POST /api/dialer/voice            outbound from the browser phone (TwiML App)
//  POST /api/dialer/voice?in=1       inbound to one of our numbers
//  POST /api/dialer/voice?step=...   follow-up steps
import {
  wrap, xml, x, twilioParams, config as loadConfig, siteUrl, getJ, setJ, listKeys, preflight, pickCallerId, bumpNumber,
  addAttempt, saveCall, aggregate, to10, e164, stateOf, later,
} from "../lib/hp.mjs";
import { txStart } from "../lib/calls.mjs";

const H = () => siteUrl();
const ev = (q) => x(`${H()}/api/dialer/events?${q}`);
const say = (t) => `<Say voice="Polly.Joanna">${x(t)}</Say>`;

export default wrap(async (req, ctx) => {
  const p = await twilioParams(req);
  const u = new URL(req.url);
  const step = u.searchParams.get("step");
  const cfg = await loadConfig(); const S = cfg.settings;

  /* ---------- follow-up steps ---------- */
  if (step === "after") return xml("<Hangup/>");
  if (step === "notice") return xml(say("This call may be recorded for quality."));
  if (step === "inafter") {
    if (["completed", "answered"].includes(p.DialCallStatus)) return xml("<Hangup/>");
    const num = (await getJ("numbers", "all"))?.[p.To] || {};
    const owner = num.owner || "";
    await setJ("inbox", `${owner || "_team"}/${Date.now()}-${p.CallSid}`, { kind: "missed", from: to10(p.From), to: p.To, at: Date.now(), sid: p.CallSid, owner });
    const greet = num.greeting || S.inboundGreeting;
    return xml(`${say(greet)}<Record maxLength="120" playBeep="true" trim="trim-silence" action="${x(H() + "/api/dialer/voice?step=vmdone")}" recordingStatusCallback="${ev("type=vmrec&owner=" + encodeURIComponent(owner) + "&from=" + to10(p.From) + "&to=" + encodeURIComponent(p.To))}" recordingStatusCallbackEvent="completed"/>`);
  }
  if (step === "vmdone") return xml(say("Thanks, we'll call you back soon. Goodbye.") + "<Hangup/>");

  /* ---------- inbound call to one of our numbers ---------- */
  if (u.searchParams.get("in")) {
    const all = (await getJ("numbers", "all")) || {};
    const num = all[p.To] || {};
    let clients = num.owner ? [num.owner] : [];
    if (!clients.length) {
      // nobody owns it: ring up to 10 agents active in the last 12h
      const keys = await listKeys("agents", "");
      const recent = [];
      for (const k of keys.slice(0, 60)) { const a = await getJ("agents", k); if (a && a.seen > Date.now() - 12 * 36e5) recent.push(a.identity); }
      clients = recent.slice(0, 10);
    }
    const rec = { id: p.CallSid, sid: p.CallSid, agent: clients[0] || "_team", dir: "in", mode: "inbound", to: to10(p.From), from: p.To, at: Date.now(), status: "ringing" };
    later(ctx, saveCall(rec));
    if (!clients.length) return xml(`<Redirect>${x(H() + "/api/dialer/voice?step=inafter")}</Redirect>`);
    const cl = clients.map((c) => `<Client><Identity>${x(c)}</Identity><Parameter name="from" value="${x(to10(p.From))}"/><Parameter name="line" value="${x(p.To)}"/><Parameter name="kind" value="inbound"/></Client>`).join("");
    const recAttr = S.record ? ` record="record-from-answer-dual" recordingStatusCallback="${ev("type=rec")}" recordingStatusCallbackEvent="completed"` : "";
    return xml(`${S.transcribe ? txStart(p.CallSid, "Lead", "Agent") : ""}<Dial timeout="22" answerOnBridge="true" action="${x(H() + "/api/dialer/voice?step=inafter")}"${recAttr}>${cl}</Dial>`);
  }

  /* ---------- outbound from the browser phone ---------- */
  const identity = String(p.From || "").replace(/^client:/, "");
  if (!identity.startsWith("hp_")) return xml(say("This number can't place calls.") + "<Hangup/>");
  const agent = (await getJ("agents", identity)) || { identity, name: "Agent" };
  const user = { identity, admin: false, name: agent.name, email: agent.email };

  // Multi-line: the agent's browser parks in a private conference while lines dial
  if (p.Mode === "conf") {
    const s = String(p.Session || "").replace(/[^a-z0-9-]/gi, "");
    return xml(`<Dial><Conference beep="false" startConferenceOnEnter="true" endConferenceOnExit="true" waitUrl="" statusCallback="${ev("type=conf&s=" + s)}" statusCallbackEvent="start end join leave">hp-${x(s)}</Conference></Dial>`);
  }

  const leadNum = to10(p.To);
  const check = await preflight(user, leadNum, S, p.LeadState);
  if (!check.ok) return xml(say("Call blocked. " + check.why) + "<Hangup/>");
  const prefs = (await getJ("prefs", identity)) || {};
  const cid = await pickCallerId(user, leadNum, { ...S, localPresence: prefs.localPresence ?? S.localPresence }, p.CallerId || prefs.defaultCallerId);
  if (!cid) return xml(say("You don't have a caller ID number yet. Buy or claim a number in the dialer's Numbers tab.") + "<Hangup/>");

  const rec = {
    id: p.CallSid, sid: p.CallSid, agent: identity, agentName: agent.name, leadId: p.LeadId || "", leadName: p.LeadName || "",
    to: leadNum, from: cid.e164, dir: "out", mode: "single", at: Date.now(), status: "dialing", state: stateOf(leadNum),
  };
  await saveCall(rec);
  later(ctx, Promise.all([bumpNumber(cid.e164, "dials"), addAttempt(leadNum), aggregate(rec, "dial")]));

  const recAttr = S.record ? ` record="record-from-answer-dual" recordingStatusCallback="${ev("type=rec")}" recordingStatusCallbackEvent="completed"` : "";
  const notice = S.recordNotice ? ` url="${x(H() + "/api/dialer/voice?step=notice")}"` : "";
  return xml(
    (S.transcribe ? txStart(p.CallSid, "Agent", "Lead") : "") +
    `<Dial answerOnBridge="true" callerId="${x(cid.e164)}" timeout="30" timeLimit="14400" action="${x(H() + "/api/dialer/voice?step=after")}"${recAttr}>` +
    `<Number${notice} machineDetection="DetectMessageEnd" amdStatusCallback="${ev("type=amd&p=" + p.CallSid)}" amdStatusCallbackMethod="POST" statusCallback="${ev("type=child&p=" + p.CallSid)}" statusCallbackEvent="initiated ringing answered completed">${x(e164(leadNum))}</Number></Dial>`
  );
});

export const config = { path: "/api/dialer/voice" };
