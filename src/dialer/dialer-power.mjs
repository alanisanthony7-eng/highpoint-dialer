// Multi-line power dialing (1–3 lines) with "always hear hello", async voicemail detection,
// automatic voicemail drop, and a compliant message for any second answer.
//  POST /api/dialer/power/start   {lines}
//  POST /api/dialer/power/dial    {session, leads:[{id,phone,name,state}]}
//  GET  /api/dialer/power/state?session=
//  POST /api/dialer/power/hangup  {session}
//  POST /api/dialer/power/skip    {session}         cancel lines still ringing
//  POST /api/dialer/power/end     {session}
//  POST /api/dialer/power/answer  (Twilio)
//  POST /api/dialer/power/optout  (Twilio)
import {
  wrap, json, bad, xml, x, requireUser, twilioParams, config as loadConfig, siteUrl, getJ, setJ, tw, store,
  preflight, pickCallerId, bumpNumber, addAttempt, saveCall, aggregate, patchCallBySid, to10, e164, stateOf, today, later, recordNoticeFor,
} from "../lib/hp.mjs";
import { hangup, sess, updSess, sessKey } from "../lib/calls.mjs";
import { txStart } from "../lib/calls.mjs";
import { randomUUID } from "node:crypto";

const H = () => siteUrl();
const ev = (q) => `${H()}/api/dialer/events?${q}`;
const say = (t) => `<Say voice="Polly.Joanna">${x(t)}</Say>`;
const spell = (n) => to10(n).split("").join(" ").replace(/^(\d \d \d) (\d \d \d) /, "$1, $2, ");

async function abandonRate(identity) {
  let ans = 0, ab = 0;
  for (let i = 0; i < 30; i++) {
    const d = today("America/New_York", Date.now() - i * 864e5);
    const a = await getJ("stats", `${d}/a/${identity}`); if (a) { ans += a.answered || 0; ab += a.abandoned || 0; }
  }
  return { rate: ans ? (ab / ans) * 100 : 0, answered: ans, abandoned: ab };
}

export default wrap(async (req, ctx) => {
  const action = new URL(req.url).pathname.split("/").pop();
  const q = new URL(req.url).searchParams;
  const cfg = await loadConfig(); const S = cfg.settings;

  /* ---------------- Twilio webhooks ---------------- */
  if (action === "answer") {
    const p = await twilioParams(req);
    const s = q.get("s"), agent = q.get("a"), b = q.get("b");
    const v = await sess(agent, s);
    let won = false;
    if (v?.active && !v.connected) {
      const r = await store("claims").setJSON(`${s}/${b}`, { sid: p.CallSid, at: Date.now() }, { onlyIfNew: true });
      won = r?.modified !== false;
    }
    if (won) {
      let siblings = [];
      await updSess(agent, s, (v) => {
        v.connected = p.CallSid; v.connectedAt = Date.now();
        const l = v.calls[p.CallSid]; if (l) { l.claimed = true; l.status = "in-progress"; }
        siblings = Object.entries(v.calls).filter(([sid, l]) => l.batch === +b && sid !== p.CallSid && ["queued", "initiated", "ringing"].includes(l.status)).map(([sid]) => sid);
        return v;
      });
      later(ctx, Promise.all(siblings.map((sid) => hangup(sid, true))));
      return xml(
        (recordNoticeFor(S, p.To) ? say("This call may be recorded.") : "") +
        (S.transcribe ? txStart(p.CallSid, "Lead", "Agent") : "") +
        `<Dial><Conference beep="false" startConferenceOnEnter="true" endConferenceOnExit="false">hp-${x(s)}</Conference></Dial>`
      );
    }
    // Someone else already picked up for this agent: FCC abandoned-call message, within 2 seconds,
    // with who's calling, a call-back number, and an automated opt-out.
    await patchCallBySid(p.CallSid, (c) => { c.abandoned = true; c.disposition = "Abandoned – message played"; return c; });
    later(ctx, updSess(agent, s, (v) => { const l = v.calls[p.CallSid]; if (l) l.result = "Abandoned – message played"; return v; }));
    const cb = S.callbackNumber || p.From;
    const msg = S.abandonMessage || `Hi, this is ${S.company}, following up on the life insurance information you asked about. Sorry we missed you. Please call us back at ${spell(cb)}.`;
    return xml(`${say(msg)}<Gather numDigits="1" timeout="5" action="${x(H() + "/api/dialer/power/optout")}">${say("To stop receiving calls from us, press 9 now.")}</Gather><Hangup/>`);
  }
  if (action === "optout") {
    const p = await twilioParams(req);
    if (p.Digits === "9") {
      await setJ("dnc", to10(p.To), { at: Date.now(), reason: "Pressed 9 to opt out", by: "caller" });
      return xml(say("You've been removed from our call list. Goodbye.") + "<Hangup/>");
    }
    return xml("<Hangup/>");
  }

  /* ---------------- agent actions ---------------- */
  const user = await requireUser(req);
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const s = String(body.session || q.get("session") || "").replace(/[^a-z0-9-]/gi, "");

  if (action === "start") {
    let lines = Math.max(1, Math.min(S.maxLines, +body.lines || 1));
    let note = "";
    if (lines > 1) {
      const ab = await abandonRate(user.identity);
      if (ab.answered >= 30 && ab.rate > S.abandonCap) { lines = 1; note = `Single line for now: your 30-day abandoned-call rate is ${ab.rate.toFixed(1)}% (limit ${S.abandonCap}%).`; }
    }
    const id = randomUUID().slice(0, 13);
    await setJ("power", sessKey(user.identity, id), { id, agent: user.identity, lines, active: true, calls: {}, connected: null, batch: 0, created: Date.now(), autoSkip: body.autoSkip !== false });
    await setJ("powerix", id, { agent: user.identity });
    return json({ session: id, lines, note });
  }

  const v = s ? await sess(user.identity, s) : null;
  if (!v) return bad("That dialing session has ended. Start again.", 404);

  if (action === "state") {
    let live = null;
    if (v.connected) {
      const tx = (await getJ("tx", v.connected)) || {};
      const parts = await Promise.all(["inbound_track", "outbound_track"].map((t) => getJ("txp", `${v.connected}/${t}`)));
      live = { lines: (tx.lines || []).slice(-40), partial: parts.filter((p) => p && p.t > Date.now() - 8000) };
    }
    return json({ ...v, live, now: Date.now() });
  }

  if (action === "dial") {
    if (!v.active) return bad("Session ended.", 409);
    if (v.connected) return bad("You're still on a call.", 409);
    const leads = (body.leads || []).slice(0, v.lines);
    const prefs = (await getJ("prefs", user.identity)) || {};
    const batch = (v.batch || 0) + 1;
    const placed = [], skipped = [];
    await Promise.all(leads.map(async (l) => {
      const num = to10(l.phone);
      const chk = await preflight(user, num, S, l.state);
      if (!chk.ok) { skipped.push({ leadId: l.id, why: chk.why, hard: !!chk.hard }); return; }
      const cid = await pickCallerId(user, num, { ...S, localPresence: prefs.localPresence ?? S.localPresence }, prefs.defaultCallerId);
      if (!cid) { skipped.push({ leadId: l.id, why: "No caller ID number available. Buy a number first." }); return; }
      const sq = `s=${s}&a=${encodeURIComponent(user.identity)}`;
      try {
        const c = await tw("/Accounts/{SID}/Calls.json", {
          method: "POST",
          form: {
            To: e164(num), From: cid.e164, Timeout: 25,
            Url: `${H()}/api/dialer/power/answer?${sq}&b=${batch}`, Method: "POST",
            StatusCallback: ev(`type=pcall&${sq}`), StatusCallbackMethod: "POST", StatusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
            MachineDetection: "DetectMessageEnd", AsyncAmd: "true", AsyncAmdStatusCallback: ev(`type=amd&${sq}`), AsyncAmdStatusCallbackMethod: "POST",
            ...(S.record ? { Record: "true", RecordingChannels: "dual", RecordingStatusCallback: ev("type=rec"), RecordingStatusCallbackEvent: "completed" } : {}),
          },
        });
        const rec = { id: c.sid, sid: c.sid, agent: user.identity, agentName: user.name, leadId: l.id || "", leadName: l.name || "", to: num, from: cid.e164, dir: "out", mode: "power", session: s, batch, at: Date.now(), status: "queued", state: stateOf(num) };
        await saveCall(rec);
        later(ctx, Promise.all([bumpNumber(cid.e164, "dials"), addAttempt(num), aggregate(rec, "dial")]));
        placed.push({ leadId: l.id, sid: c.sid, from: cid.e164, local: cid.areaCode === num.slice(0, 3) });
      } catch (e) { skipped.push({ leadId: l.id, why: e.message }); }
    }));
    await updSess(user.identity, s, (v) => {
      v.batch = batch; v.freedAt = null;
      for (const pl of placed) { const l = leads.find((z) => z.id === pl.leadId) || {}; v.calls[pl.sid] = { leadId: pl.leadId, name: l.name || "", to: to10(l.phone), from: pl.from, batch, status: "queued", at: Date.now() }; }
      // keep the state document small
      const keys = Object.keys(v.calls); if (keys.length > 60) for (const k of keys.slice(0, keys.length - 60)) delete v.calls[k];
      return v;
    });
    return json({ batch, placed, skipped });
  }

  if (action === "hangup") { if (v.connected) await hangup(v.connected); return json({ ok: true }); }
  if (action === "skip") {
    const ring = Object.entries(v.calls).filter(([, l]) => l.batch === v.batch && ["queued", "initiated", "ringing"].includes(l.status));
    await Promise.all(ring.map(([sid]) => hangup(sid, true)));
    return json({ ok: true, canceled: ring.length });
  }
  if (action === "end") {
    await updSess(user.identity, s, (v) => { v.active = false; return v; });
    await Promise.all(Object.entries(v.calls).filter(([, l]) => ["queued", "initiated", "ringing"].includes(l.status)).map(([sid]) => hangup(sid, true)));
    return json({ ok: true });
  }
  return bad("Unknown action", 404);
});

export const config = { path: "/api/dialer/power/*" };
