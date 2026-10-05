// Twilio status callbacks: call progress, answering-machine detection, recordings, live transcription
import { wrap, json, twilioParams, getJ, setJ, updateJ, aggregate, patchCallBySid, to10, later, config as loadConfig } from "../lib/hp.mjs";
import { dropVoicemail, hangup, updSess, isMachine } from "../lib/calls.mjs";

const ok = () => new Response(null, { status: 204 });
const DONE = ["completed", "busy", "no-answer", "failed", "canceled"];

export default wrap(async (req, ctx) => {
  const p = await twilioParams(req);
  const q = new URL(req.url).searchParams;
  const type = q.get("type");

  /* live transcription */
  if (type === "tx") {
    const c = q.get("c");
    if (p.TranscriptionEvent !== "transcription-content") return ok();
    let d = {}; try { d = JSON.parse(p.TranscriptionData || "{}"); } catch {}
    const text = (d.transcript || "").trim(); if (!text) return ok();
    const line = { t: Date.now(), track: p.Track, text, conf: d.confidence };
    if (p.Final === "true") {
      await updateJ("tx", c, (a) => { a.lines = a.lines || []; a.lines.push(line); if (a.lines.length > 800) a.lines.shift(); a.partial = {}; return a; }, {});
    } else {
      await setJ("txp", `${c}/${p.Track}`, line); // overwrite: only the newest partial matters
    }
    return ok();
  }

  /* browser-call child leg (the lead) */
  if (type === "child") {
    const parent = q.get("p");
    const st = p.CallStatus;
    const rec = await patchCallBySid(parent, (c) => {
      c.childSid = p.CallSid; c.status = st;
      if (st === "in-progress") { c.answered = true; c.answeredAt = Date.now(); }
      if (DONE.includes(st)) {
        c.endedAt = Date.now(); c.talkSec = +p.CallDuration || 0;
        c.answered = c.answered || (st === "completed" && c.talkSec > 0);
        c.human = c.answered && !isMachine(c.answeredBy);
        c.machine = isMachine(c.answeredBy);
        c.final = true;
      }
      return c;
    });
    if (rec?.final && DONE.includes(st)) later(ctx, aggregate(rec, "end"));
    return ok();
  }

  /* answering-machine detection (both browser calls and multi-line) */
  if (type === "amd") {
    const by = p.AnsweredBy || "unknown";
    const parent = q.get("p");
    const s = q.get("s"), agent = q.get("a");
    if (parent) {
      const rec = await patchCallBySid(parent, (c) => { c.answeredBy = by; c.machine = isMachine(by); return c; });
      // agent pressed "Drop at beep" before the beep arrived
      if (rec?.vmPending && /machine_end/.test(by)) {
        later(ctx, dropVoicemail(p.CallSid, rec.vmPending).then(() => patchCallBySid(parent, (c) => { c.vmDropped = rec.vmPending; c.vmPending = null; c.disposition = c.disposition || "Left voicemail"; return c; })));
      }
      return ok();
    }
    if (s && agent) {
      const cfg = await loadConfig(); const prefs = (await getJ("prefs", agent)) || {};
      let action = null;
      const state = await updSess(agent, s, (v) => {
        const line = v.calls[p.CallSid]; if (!line) return v;
        line.answeredBy = by;
        if (v.connected === p.CallSid && /machine_end|fax/.test(by)) {
          const greet = line.vmPending || (prefs.autoVm && prefs.vmGreeting) || null;
          if (line.vmPending || (cfg.settings.amdAutoSkip && v.autoSkip !== false)) {
            action = greet ? { drop: greet } : { hang: true };
            line.result = greet ? "Left voicemail" : "Machine – skipped"; line.vmDropped = greet || null;
            v.connected = null; v.freedAt = Date.now(); // agent is free for the next batch
          }
        }
        return v;
      });
      if (action?.drop) later(ctx, dropVoicemail(p.CallSid, action.drop).catch(() => hangup(p.CallSid)));
      else if (action?.hang) later(ctx, hangup(p.CallSid));
      await patchCallBySid(p.CallSid, (c) => { c.answeredBy = by; c.machine = isMachine(by); if (action?.drop) c.vmDropped = action.drop; if (action) c.disposition = action.drop ? "Left voicemail" : "Machine – skipped"; return c; });
      return ok();
    }
    return ok();
  }

  /* multi-line lead leg progress */
  if (type === "pcall") {
    const s = q.get("s"), agent = q.get("a"), st = p.CallStatus;
    let finished = null;
    await updSess(agent, s, (v) => {
      const line = v.calls[p.CallSid]; if (!line) return v;
      line.status = st;
      if (DONE.includes(st)) {
        line.endedAt = Date.now(); line.talkSec = +p.CallDuration || 0;
        if (v.connected === p.CallSid) { v.connected = null; v.freedAt = Date.now(); }
        finished = line;
      }
      return v;
    });
    const rec = await patchCallBySid(p.CallSid, (c) => {
      c.status = st;
      if (st === "in-progress") { c.answered = true; c.answeredAt = c.answeredAt || Date.now(); }
      if (DONE.includes(st)) {
        c.endedAt = Date.now(); c.talkSec = +p.CallDuration || 0;
        c.answered = c.answered || (st === "completed" && c.talkSec > 0);
        c.machine = isMachine(c.answeredBy); c.human = c.answered && !c.machine && !c.abandoned;
        if (!c.disposition) c.disposition = st === "busy" ? "Busy" : st === "no-answer" ? "No answer" : st === "failed" ? "Bad number" : st === "canceled" ? "Not dialed (another line answered)" : c.disposition;
        c.final = true;
      }
      return c;
    });
    if (rec?.final && DONE.includes(st)) later(ctx, aggregate(rec, "end"));
    return ok();
  }

  /* agent left their multi-line conference → session over, stop any ringing lines */
  if (type === "conf") {
    if (p.StatusCallbackEvent === "conference-end") {
      const s = q.get("s");
      const idx = await getJ("powerix", s);
      if (idx) {
        const v = await updSess(idx.agent, s, (v) => { v.active = false; return v; });
        for (const [sid, l] of Object.entries(v?.calls || {})) if (["queued", "initiated", "ringing"].includes(l.status)) later(ctx, hangup(sid, true));
      }
    }
    return ok();
  }

  /* recordings */
  if (type === "rec") {
    if (p.RecordingStatus !== "completed") return ok();
    await patchCallBySid(p.CallSid, (c) => { c.recordingSid = p.RecordingSid; c.recordingSec = +p.RecordingDuration || 0; return c; });
    return ok();
  }

  /* inbound voicemail left for an agent */
  if (type === "vmrec") {
    if (p.RecordingStatus !== "completed") return ok();
    const owner = q.get("owner") || "_team";
    await setJ("inbox", `${owner}/${Date.now()}-${p.CallSid}`, { kind: "voicemail", from: q.get("from"), to: q.get("to"), at: Date.now(), sid: p.CallSid, recordingSid: p.RecordingSid, sec: +p.RecordingDuration || 0, owner });
    return ok();
  }

  /* inbound / parent call finished */
  if (type === "inbound" || type === "parent") {
    if (DONE.includes(p.CallStatus)) {
      const rec = await patchCallBySid(p.CallSid, (c) => {
        c.endedAt = c.endedAt || Date.now();
        if (c.dir === "in") { c.talkSec = +p.CallDuration || 0; c.answered = c.talkSec > 0; c.human = c.answered; c.final = true; }
        c.status = c.final ? c.status : p.CallStatus;
        return c;
      });
      if (rec?.dir === "in" && rec.final) later(ctx, aggregate({ ...rec, from: null }, "end"));
    }
    return ok();
  }
  return ok();
});

export const config = { path: "/api/dialer/events" };
