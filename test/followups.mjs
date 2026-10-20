// Automatic text follow-ups and the job runner — local, with a fake Twilio and a movable clock.
import { DatabaseSync } from "node:sqlite";
const realNow = Date.now; let skew = 0; Date.now = () => realNow() + skew;
const { onRequest } = await import("../functions/api/[[path]].js");
const sql = new DatabaseSync(":memory:");
const norm = (v) => (v instanceof ArrayBuffer ? new Uint8Array(v) : v === undefined ? null : v);
const out = (row) => row && Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Uint8Array ? Array.from(v) : v]));
const stmt = (q, args = []) => ({ bind: (...a) => stmt(q, a.map(norm)), first: async () => out(sql.prepare(q).get(...args)) ?? null, all: async () => ({ results: sql.prepare(q).all(...args).map(out) }), run: async () => { const r = sql.prepare(q).run(...args); return { meta: { changes: r.changes } }; } });
const DB = { prepare: (q) => stmt(q), batch: async (list) => { const r = []; for (const s of list) r.push(await s.run()); return r; } };
const env = { DB, HP_ADMIN_EMAILS: "boss@hp.com", HP_INVITE_CODE: "HP2026", HP_PUBLIC_URL: "https://desk.example.com", TWILIO_ACCOUNT_SID: "AC_test", TWILIO_AUTH_TOKEN: "tok", HP_CRON_SECRET: "cronsecret" };
const texts = [];
globalThis.fetch = async (url, o = {}) => {
  const u = new URL(url);
  if (/Messages\.json$/.test(u.pathname)) { const b = Object.fromEntries(new URLSearchParams(String(o.body))); texts.push(b); return new Response(JSON.stringify({ sid: "SM" + texts.length }), { status: 201, headers: { "content-type": "application/json" } }); }
  return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
};
const jars = {};
async function call(who, path, { method = "GET", body } = {}) {
  const h = {}; if (jars[who]) h.cookie = jars[who];
  let b; if (body !== undefined) { b = JSON.stringify(body); h["content-type"] = "application/json"; }
  const waits = [];
  const r = await onRequest({ request: new Request("https://desk.example.com" + path, { method, headers: h, body: b }), env, waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  const sc = r.headers.get("set-cookie"); if (sc) jars[who] = sc.split(";")[0];
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { s: r.status, j };
}
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) process.exitCode = 1; };
const run = () => call("boss", "/api/followups/run", { method: "POST", body: {} });
const queue = async () => (await call("rep", "/api/followups/queue")).j;

await call("boss", "/api/auth/signup", { method: "POST", body: { email: "boss@hp.com", password: "password2", name: "Boss Lady" } });
await call("rep", "/api/auth/signup", { method: "POST", body: { email: "rep@hp.com", password: "password1", name: "Rita Rep", invite: "HP2026", agree: true } });
const rep = (await call("rep", "/api/auth/me")).j.user;
await call("boss", "/api/dialer/setup", { method: "PUT", body: { settings: { quietHours: { start: 0, end: 24 }, company: "Highpoint Financial" } } });
const { setJ } = await import("../src/lib/hp.mjs");
await setJ("numbers", "all", { "+12125550000": { e164: "+12125550000", areaCode: "212", state: "NY", owner: rep.identity, provider: "twilio" } });
await call("rep", "/api/dialer/sms"); // registers the agent (name for texts)
const lead = { first: "Margaret", last: "Lee", phone: "2125550111", state: "NY", stage: "contacted" };

// off by default
await call("rep", "/api/docs/leads/L1", { method: "PUT", body: { ...lead, lastDisposition: "No answer", lastCallAt: Date.now() } });
ok((await queue()).queue.length === 0, "automatic texts are off until the agent turns them on");
let r = await call("rep", "/api/followups/settings", { method: "POST", body: { on: true, noAnswer: { on: true, delayMin: 5 } } });
ok(r.j.settings.on && r.j.settings.noAnswer.delayMin === 5 && /\{first\}/.test(r.j.settings.noAnswer.text), "an agent turns them on (with ready-made messages)");
r = await call("rep", "/api/followups/preview", { method: "POST", body: {} });
ok(/^Hi Margaret, this is Rita with Highpoint Financial/.test(r.j.preview.noAnswer) && /Reply STOP to opt out\.$/.test(r.j.preview.noAnswer), "messages fill in the names and always say how to opt out: " + r.j.preview.noAnswer);
ok(/(tomorrow|today|day) at \d/.test(r.j.preview.apptDayBefore), "reminders say when: " + r.j.preview.apptDayBefore);

// no answer -> a text in 5 minutes and one the next morning
await call("rep", "/api/docs/leads/L1", { method: "PUT", body: { ...lead, lastDisposition: "No answer", lastCallAt: Date.now() } });
let q = await queue();
ok(q.queue.length === 2 && q.queue[0].kind === "noAnswer" && q.queue[1].kind === "nextMorning" && q.queue[0].name === "Margaret Lee", "a no-answer schedules a text soon and one tomorrow morning");
ok(Math.abs(q.queue[0].due - (Date.now() + 5 * 60_000)) < 5000, "the first one 5 minutes later");
const nm = new Date(q.queue[1].due).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
ok(nm === "9:30 AM", "the second at 9:30 the next morning in the client's time zone (" + nm + ")");
await call("rep", "/api/docs/leads/L1", { method: "PUT", body: { ...lead, lastDisposition: "Left voicemail", lastCallAt: Date.now() + 1000 } });
ok((await queue()).queue.length === 2, "calling again the same day doesn't stack more texts");
r = await run(); ok(texts.length === 0, "nothing goes out before it's due");
skew += 6 * 60_000; await run();
const t1 = texts[0];
ok(t1 && t1.To === "+12125550111" && t1.From === "+12125550000" && /^Hi Margaret, this is Rita/.test(t1.Body), "5 minutes later the text goes out from the agent's local number");
r = await call("rep", "/api/dialer/sms?with=2125550111");
ok(r.j.thread?.msgs?.[0]?.auto === "noAnswer" && r.j.thread.msgs[0].by === "Automatic text", "it shows in the agent's Inbox thread, marked automatic");
// the client texts back -> tomorrow's text is skipped
const { receiveText } = await import("../src/lib/sms.mjs");
await receiveText({ from: "+12125550111", line: "+12125550000", body: "Call me after 5" });
skew += 36 * 36e5; await run();
q = await queue();
ok(texts.length === 1 && q.log.some((x) => x.kind === "nextMorning" && x.status === "skipped" && /texted back/.test(x.note)), "when the client texts back, the next-morning text is skipped");

// appointment reminders
await call("rep", "/api/docs/leads/L2", { method: "PUT", body: { ...lead, first: "Ray", phone: "2125550122" } });
const apptAt = Date.now() + 3 * 864e5;
await call("rep", "/api/docs/appts/A1", { method: "PUT", body: { leadId: "L2", at: apptAt, title: "Call Ray", done: false } });
q = await queue();
ok(q.queue.filter((x) => x.kind.startsWith("appt")).length === 2, "an appointment schedules a reminder the day before and an hour before");
skew += 2 * 864e5 + 60_000; await run();
const t2 = texts[texts.length - 1];
ok(texts.length === 2 && /^Hi Ray, it's Rita with Highpoint Financial\. Just confirming our call tomorrow at/.test(t2.Body), "the day-before reminder goes out: " + t2.Body);
await call("rep", "/api/docs/appts/A1", { method: "PUT", body: { leadId: "L2", at: apptAt + 2 * 36e5, title: "Call Ray", done: false } });
skew += 864e5 - 36e5; await run(); // the old hour-before time
q = await queue();
ok(q.log.some((x) => x.kind === "apptHourBefore" && /appointment changed/.test(x.note)), "a reminder for an old time is skipped when the appointment moves");
ok(q.queue.some((x) => x.kind === "apptHourBefore"), "and the new time gets its own reminder");

// Do Not Call, calling hours, cancel
await call("rep", "/api/docs/leads/L3", { method: "PUT", body: { ...lead, first: "Dee", phone: "2125550133", lastDisposition: "No answer", lastCallAt: Date.now() } });
await call("rep", "/api/dialer/calls/dnc", { method: "POST", body: { number: "2125550133" } });
skew += 10 * 60_000; await run();
ok(!texts.some((t) => t.To === "+12125550133") && (await queue()).log.some((x) => /Do Not Call/.test(x.note)), "never texts a Do Not Call number");
await call("boss", "/api/dialer/setup", { method: "PUT", body: { settings: { quietHours: { start: 0, end: 0.01 } } } });
await call("rep", "/api/docs/leads/L4", { method: "PUT", body: { ...lead, first: "Eve", phone: "2125550144", lastDisposition: "No answer", lastCallAt: Date.now() } });
skew += 10 * 60_000; await run();
q = await queue();
ok(!texts.some((t) => t.To === "+12125550144") && q.queue.some((x) => x.name.startsWith("Eve") && x.kind === "noAnswer" && x.due > Date.now()), "outside the client's calling hours it waits and tries again later");
const eve = q.queue.find((x) => x.name.startsWith("Eve") && x.kind === "nextMorning");
r = await call("rep", "/api/followups/cancel", { method: "POST", body: { key: eve.key, name: "Eve" } });
ok(r.j.ok && !(await queue()).queue.some((x) => x.key === eve.key), "an agent can cancel a scheduled text");
r = await call("boss", "/api/followups/cancel", { method: "POST", body: { key: "j:nope" } }); ok(r.s === 404, "cancel only finds real texts");
r = await call("x", "/api/cron?key=wrong"); ok(r.s === 403, "the outside timer needs the secret");
r = await call("x", "/api/cron?key=cronsecret"); ok(r.s === 200 && typeof r.j.ran === "number", "with it, the timer runs due texts");
console.log(process.exitCode ? "SOME FAILED" : "ALL PASSED");
