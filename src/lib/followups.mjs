// Automatic text follow-ups, and the small job runner behind them.
//  - No answer / voicemail: a text a few minutes later, and another the next morning (at most once a day per client).
//  - Appointments: a reminder the day before and an hour before.
// Texts only go out inside the client's calling hours, never to Do Not Call (or flagged) numbers, and they're
// skipped when the client has replied, been called again, or moved on (appointment, sold, not interested).
// Jobs run whenever the desk is in use (at most once a minute) and from /api/cron for an outside timer.
import { getStore, D1 } from "./store.mjs";
import { getJ, to10, callWindow, zonesOf, config as loadConfig, isDnc, json, bad } from "./hp.mjs";
import { requireUser } from "./auth.mjs";
import { sendText } from "./sms.mjs";

const env = (k, d = "") => globalThis.__ENV?.[k] ?? d;
const kv = () => getStore("hpd-fu");
const rid = () => Math.random().toString(36).slice(2, 10);
export const FU_DEFAULTS = {
  on: false,
  noAnswer: { on: true, delayMin: 10, text: "Hi {first}, this is {agent} with {company}. Sorry I missed you just now about the coverage you asked about. When's a good time to call you back?" },
  nextMorning: { on: true, text: "Good morning {first}, it's {agent} again. I'll try you again today, or reply with a time that works and I'll call you then." },
  apptDayBefore: { on: true, text: "Hi {first}, it's {agent} with {company}. Just confirming our call {when}. Reply here if you need a different time." },
  apptHourBefore: { on: true, text: "Hi {first}, {agent} here. I'll be calling you in about an hour, at {time}. Talk soon!" },
};
const merge = (s = {}) => { const o = { ...FU_DEFAULTS, on: !!s.on }; for (const k of ["noAnswer", "nextMorning", "apptDayBefore", "apptHourBefore"]) o[k] = { ...FU_DEFAULTS[k], ...(s[k] || {}) }; return o; };
export async function fuSettings(uid) { return merge(await kv().get("s:" + uid, { type: "json" }).catch(() => null) || {}); }

const tzOf = (phone, state) => zonesOf(phone, state)[0];
const fmtWhen = (at, tz) => {
  const d = new Date(at), now = new Date(), tm = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
  const day = (x) => x.toLocaleDateString("en-US", { timeZone: tz });
  if (day(d) === day(now)) return `today at ${tm}`;
  if (day(d) === day(new Date(Date.now() + 864e5))) return `tomorrow at ${tm}`;
  return `${d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: tz })} at ${tm}`;
};
export function fill(text, { lead = {}, agent = {}, company = "", at, tz }) {
  const v = { first: String(lead.first || "").trim() || "there", agent: String(agent.name || "").split(" ")[0] || "your agent", company: company || "Highpoint Financial", when: at ? fmtWhen(at, tz) : "", time: at ? new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }) : "" };
  let out = String(text || "").replace(/\{(first|agent|company|when|time)\}/g, (m, k) => v[k]);
  if (!/\bstop\b/i.test(out)) out += " Reply STOP to opt out."; // opt-out language on every automatic text
  return out.trim();
}
// 9:30 tomorrow morning in the client's time zone
function nextMorning(tz) {
  const t = new Date(Date.now() + 864e5);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", hourCycle: "h23", minute: "2-digit" }).formatToParts(t).map((p) => [p.type, p.value]));
  const local = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute), offset = local - Math.floor(t.getTime() / 60000) * 60000;
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, 9, 30) - offset;
}

/* ---------- the queue ---------- */
const jkey = (due, id) => `j:${String(Math.round(due)).padStart(15, "0")}:${id}`;
async function schedule(job, ref) {
  if (ref) { const r = await kv().set("r:" + ref, "1", { onlyIfNew: true }).catch(() => null); if (r?.modified === false) return false; } // already scheduled
  job.id = job.id || rid(); job.createdAt = Date.now(); job.tries = job.tries || 0;
  await kv().setJSON(jkey(job.due, job.id), job);
  return true;
}
async function leadDoc(uid, id) { const r = await D1().prepare("SELECT data FROM docs WHERE scope=?1 AND col=?2 AND id=?3").bind(uid, "leads", id).first(); return r ? JSON.parse(r.data) : null; }
async function apptDoc(uid, id) { const r = await D1().prepare("SELECT data FROM docs WHERE scope=?1 AND col=?2 AND id=?3").bind(uid, "appts", id).first(); return r ? JSON.parse(r.data) : null; }
const NOANSWER = /no answer|voicemail/i;

// a client file was saved: a no-answer result schedules the follow-up texts
export async function onLeadSaved(user, id, prev, next) {
  if (!next || !NOANSWER.test(next.lastDisposition || "") || !next.lastCallAt || next.lastCallAt === prev?.lastCallAt) return;
  if (Date.now() - next.lastCallAt > 30 * 60_000) return; // only fresh results
  const s = await fuSettings(user.id); if (!s.on) return;
  const phone = to10(next.phone); if (!phone) return;
  const tz = tzOf(phone, next.state), day = new Date().toLocaleDateString("en-CA", { timeZone: tz });
  if (s.noAnswer.on) await schedule({ kind: "noAnswer", uid: user.id, identity: user.identity, leadId: id, to: phone, callAt: next.lastCallAt, due: Date.now() + Math.max(1, +s.noAnswer.delayMin || 10) * 60_000 }, `na:${user.id}:${id}:${day}`);
  if (s.nextMorning.on) await schedule({ kind: "nextMorning", uid: user.id, identity: user.identity, leadId: id, to: phone, callAt: next.lastCallAt, due: nextMorning(tz) }, `nm:${user.id}:${id}:${day}`);
}
// an appointment was saved: reminders the day before and an hour before
export async function onApptSaved(user, id, appt) {
  if (!appt || appt.done || !appt.leadId || !(appt.at > Date.now())) return;
  const s = await fuSettings(user.id); if (!s.on) return;
  const lead = await leadDoc(user.id, appt.leadId); const phone = to10(lead?.phone); if (!phone) return;
  const base = { uid: user.id, identity: user.identity, leadId: appt.leadId, apptId: id, apptAt: appt.at, to: phone };
  if (s.apptDayBefore.on && appt.at - 24 * 36e5 > Date.now() + 10 * 60_000) await schedule({ ...base, kind: "apptDayBefore", due: appt.at - 24 * 36e5 }, `ad:${user.id}:${id}:${appt.at}`);
  if (s.apptHourBefore.on && appt.at - 36e5 > Date.now() + 5 * 60_000) await schedule({ ...base, kind: "apptHourBefore", due: appt.at - 36e5 }, `ah:${user.id}:${id}:${appt.at}`);
}

async function logFor(uid, entry) {
  const key = "log:" + uid, cur = (await kv().get(key, { type: "json" }).catch(() => null)) || [];
  await kv().setJSON(key, [{ at: Date.now(), ...entry }, ...cur].slice(0, 60));
}
// why a queued text shouldn't go out anymore (or null to send it)
async function stale(job, lead) {
  if (!lead) return "The client was deleted";
  if (await isDnc(job.to)) return "The client is on Do Not Call";
  if (lead.dnc || lead.scrub?.blocked) return "The client is flagged Do Not Call";
  const th = await getJ("sms", `${job.identity}/${job.to}`);
  if ((th?.msgs || []).some((m) => m.dir === "in" && m.at > job.createdAt)) return "The client texted back";
  if (job.kind === "noAnswer" || job.kind === "nextMorning") {
    if ((lead.lastCallAt || 0) > job.callAt + 1000 && !NOANSWER.test(lead.lastDisposition || "")) return "The client was reached on a later call";
    if (["appointment", "sold", "lost"].includes(lead.stage)) return "The client already moved on";
  } else {
    const a = await apptDoc(job.uid, job.apptId);
    if (!a || a.done || a.at !== job.apptAt) return "The appointment changed";
  }
  return null;
}
async function runOne(job) {
  const lead = await leadDoc(job.uid, job.leadId), why = await stale(job, lead);
  const name = lead ? [lead.first, lead.last].filter(Boolean).join(" ") || "Client" : "Client";
  if (why) return logFor(job.uid, { kind: job.kind, leadId: job.leadId, name, status: "skipped", note: why });
  const cfg = await loadConfig(), w = callWindow(job.to, cfg.settings, lead.state);
  if (!w.ok) { // outside the client's hours: try again in half an hour (reminders give up once they'd be late)
    const late = job.kind.startsWith("appt") && Date.now() + 30 * 60_000 > job.apptAt - 15 * 60_000;
    if (late || job.tries > 48) return logFor(job.uid, { kind: job.kind, leadId: job.leadId, name, status: "skipped", note: "Outside the client's calling hours" });
    return schedule({ ...job, due: Date.now() + 30 * 60_000, tries: job.tries + 1 });
  }
  const s = await fuSettings(job.uid); if (!s.on || !s[job.kind]?.on) return logFor(job.uid, { kind: job.kind, leadId: job.leadId, name, status: "skipped", note: "Automatic texts are off" });
  const agent = (await getJ("agents", job.identity)) || { identity: job.identity, name: "" };
  const body = fill(s[job.kind].text, { lead, agent, company: cfg.settings.company, at: job.apptAt, tz: tzOf(job.to, lead.state) });
  try { await sendText({ user: { identity: job.identity, name: agent.name, admin: false }, to: job.to, body, leadId: job.leadId, auto: job.kind }); await logFor(job.uid, { kind: job.kind, leadId: job.leadId, name, status: "sent", note: body }); }
  catch (e) {
    if (job.tries < 3 && !/opted out/i.test(e.message)) return schedule({ ...job, due: Date.now() + 15 * 60_000, tries: job.tries + 1 });
    await logFor(job.uid, { kind: job.kind, leadId: job.leadId, name, status: "failed", note: e.message });
  }
}
// due jobs, one runner at a time
export async function runJobs(max = 25) {
  const st = kv(), lock = await st.set("lock", String(Date.now()), { onlyIfNew: true }).catch(() => null);
  if (lock?.modified === false) { const at = +(await st.get("lock").catch(() => 0)); if (Date.now() - at < 120_000) return { ran: 0, busy: true }; await st.delete("lock"); return runJobs(max); }
  let ran = 0;
  try {
    const keys = (await D1().prepare("SELECT key FROM blobs WHERE store='hpd-fu' AND key LIKE 'j:%' ORDER BY key LIMIT ?1").bind(max).all()).results || [];
    for (const { key } of keys) {
      if (+key.split(":")[1] > Date.now()) break;
      const job = await st.get(key, { type: "json" }).catch(() => null); await st.delete(key);
      if (job) { try { await runOne(job); } catch (e) { console.error("job", e); } ran++; }
    }
  } finally { await st.delete("lock").catch(() => {}); }
  return { ran };
}
// run due jobs at most once a minute while anyone uses the desk
let lastPoke = 0;
export async function poke() {
  if (Date.now() - lastPoke < 60_000) return; lastPoke = Date.now();
  const st = kv(), last = +(await st.get("ran").catch(() => 0) || 0);
  if (Date.now() - last < 60_000) return;
  await st.set("ran", String(Date.now()));
  await runJobs();
}

// /api/followups/{settings|queue|cancel|preview|run}  and  /api/cron
export async function followupsRoute(req, action) {
  if (action === "cron") {
    const key = new URL(req.url).searchParams.get("key") || "", secret = String(env("HP_CRON_SECRET") || "");
    if (!secret || key !== secret) return bad("Not allowed", 403);
    return json(await runJobs(50));
  }
  const user = await requireUser(req);
  const b = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  if (action === "settings") {
    if (req.method === "POST") { const s = merge({ ...(await fuSettings(user.id)), ...b }); for (const k of ["noAnswer", "nextMorning", "apptDayBefore", "apptHourBefore"]) s[k].text = String(s[k].text || "").slice(0, 480); s.noAnswer.delayMin = Math.min(240, Math.max(1, Math.round(+s.noAnswer.delayMin || 10))); await kv().setJSON("s:" + user.id, s); }
    return json({ settings: await fuSettings(user.id) });
  }
  if (action === "preview") {
    const s = merge({ ...(await fuSettings(user.id)), ...(b.settings || {}) }), cfg = await loadConfig();
    const sample = { first: "Margaret" }, at = nextMorning("America/New_York") + 4.5 * 36e5; // tomorrow at 2:00 PM
    const out = {}; for (const k of ["noAnswer", "nextMorning", "apptDayBefore", "apptHourBefore"]) out[k] = fill(s[k].text, { lead: sample, agent: user, company: cfg.settings.company, at, tz: "America/New_York" });
    return json({ preview: out });
  }
  if (action === "queue") {
    const r = await D1().prepare("SELECT key, txt FROM blobs WHERE store='hpd-fu' AND key LIKE 'j:%' ORDER BY key LIMIT 2000").all();
    const mine = (r.results || []).map((x) => ({ key: x.key, ...JSON.parse(x.txt) })).filter((j) => j.uid === user.id).slice(0, 100);
    const names = {};
    for (const j of mine) if (!(j.leadId in names)) { const l = await leadDoc(user.id, j.leadId); names[j.leadId] = l ? [l.first, l.last].filter(Boolean).join(" ") || "Client" : "Client"; }
    return json({ queue: mine.map((j) => ({ key: j.key, kind: j.kind, due: j.due, leadId: j.leadId, name: names[j.leadId], to: j.to })), log: (await kv().get("log:" + user.id, { type: "json" }).catch(() => null)) || [] });
  }
  if (action === "cancel" && req.method === "POST") {
    const k = String(b.key || ""); if (!k.startsWith("j:")) return bad("Unknown text");
    const j = await kv().get(k, { type: "json" }).catch(() => null);
    if (!j || (j.uid !== user.id && !user.admin)) return bad("Not found", 404);
    await kv().delete(k); await logFor(j.uid, { kind: j.kind, leadId: j.leadId, name: b.name || "Client", status: "skipped", note: "Canceled" });
    return json({ ok: true });
  }
  if (action === "run" && req.method === "POST") { if (!user.admin) return bad("Admins only", 403); return json(await runJobs(50)); }
  return bad("Unknown action", 404);
}
