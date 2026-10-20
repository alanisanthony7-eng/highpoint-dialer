// Booking links, Google Calendar busy times and the calendar feed — local, with in-memory D1 and fake email/calendar.
import { DatabaseSync } from "node:sqlite";
const { onRequest } = await import("../functions/api/[[path]].js");
const { busyFromIcs, buildIcs, zonedToUtc } = await import("../src/lib/ics.mjs");
const sql = new DatabaseSync(":memory:");
const norm = (v) => (v instanceof ArrayBuffer ? new Uint8Array(v) : v === undefined ? null : v);
const out = (row) => row && Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Uint8Array ? Array.from(v) : v]));
const stmt = (q, args = []) => ({ bind: (...a) => stmt(q, a.map(norm)), first: async () => out(sql.prepare(q).get(...args)) ?? null, all: async () => ({ results: sql.prepare(q).all(...args).map(out) }), run: async () => { const r = sql.prepare(q).run(...args); return { meta: { changes: r.changes } }; } });
const DB = { prepare: (q) => stmt(q), batch: async (list) => { const r = []; for (const s of list) r.push(await s.run()); return r; } };
const env = { DB, HP_ADMIN_EMAILS: "boss@hp.com", HP_INVITE_CODE: "HP2026", HP_PUBLIC_URL: "https://desk.example.com", RESEND_API_KEY: "re_test" };
const mails = []; let ICS = "";
globalThis.fetch = async (url, o = {}) => {
  const u = new URL(url);
  if (u.hostname === "api.resend.com") { mails.push(JSON.parse(o.body)); return new Response(JSON.stringify({ id: "em" + mails.length }), { status: 200, headers: { "content-type": "application/json" } }); }
  if (u.hostname === "calendar.google.com") return u.pathname.includes("missing") ? new Response("nope", { status: 404 }) : new Response(ICS, { status: 200, headers: { "content-type": "text/calendar" } });
  return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
};
const jars = {};
async function call(who, path, { method = "GET", body } = {}) {
  const h = { "cf-connecting-ip": "203.0.113.9" }; if (who && jars[who]) h.cookie = jars[who];
  let b; if (body !== undefined) { b = JSON.stringify(body); h["content-type"] = "application/json"; }
  const waits = [];
  const r = await onRequest({ request: new Request("https://desk.example.com" + path, { method, headers: h, body: b }), env, waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  const sc = r.headers.get("set-cookie"); if (sc && who) jars[who] = sc.split(";")[0];
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { s: r.status, j, h: r.headers };
}
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) process.exitCode = 1; };
const NY = "America/New_York";
const nyParts = (t) => Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: NY, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" }).formatToParts(t).map((p) => [p.type, p.type === "literal" ? p.value : +p.value]));

/* ---------- .ics reading and writing ---------- */
ok(zonedToUtc(2026, 10, 20, 9, 0, 0, NY) === Date.UTC(2026, 9, 20, 13, 0) && zonedToUtc(2026, 12, 1, 9, 0, 0, NY) === Date.UTC(2026, 11, 1, 14, 0), "wall-clock times convert to UTC on both sides of daylight saving");
const cal = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:a
DTSTART:20261020T150000Z
DTEND:20261020T160000Z
SUMMARY:UTC meeting
END:VEVENT
BEGIN:VEVENT
UID:b
DTSTART;TZID=America/Chicago:20261021T090000
DTEND;TZID=America/Chicago:20261021T093000
END:VEVENT
BEGIN:VEVENT
UID:c
DTSTART;VALUE=DATE:20261022
DTEND;VALUE=DATE:20261023
SUMMARY:Out of office
END:VEVENT
BEGIN:VEVENT
UID:d
DTSTART;VALUE=DATE:20261023
DTEND;VALUE=DATE:20261024
TRANSP:TRANSPARENT
SUMMARY:Birthday
END:VEVENT
BEGIN:VEVENT
UID:e
DTSTART;TZID=America/New_York:20261005T120000
DTEND;TZID=America/New_York:20261005T130000
RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261231T000000Z
EXDATE;TZID=America/New_York:20261021T120000
END:VEVENT
BEGIN:VEVENT
UID:e
RECURRENCE-ID;TZID=America/New_York:20261026T120000
DTSTART;TZID=America/New_York:20261026T150000
DTEND;TZID=America/New_York:20261026T160000
END:VEVENT
BEGIN:VEVENT
UID:f
DTSTART:20261019T200000Z
DURATION:PT45M
RRULE:FREQ=DAILY;COUNT=3
END:VEVENT
BEGIN:VEVENT
UID:g
DTSTART:20261024T150000Z
DTEND:20261024T160000Z
STATUS:CANCELLED
END:VEVENT
BEGIN:VEVENT
UID:h
DTSTART;TZID=America/New_York:20261025T090000
DTEND;TZID=America/New_York:20261025T100000
RRULE:FREQ=WEEKLY
END:VEVENT
END:VCALENDAR`.replace(/\n/g, "\r\n");
const from = Date.UTC(2026, 9, 19), to = Date.UTC(2026, 10, 9);
const busy = busyFromIcs(cal, from, to, NY), has = (s, e) => busy.some(([a, b]) => a === s && b === e);
ok(has(Date.UTC(2026, 9, 20, 15), Date.UTC(2026, 9, 20, 16)), "UTC events are busy");
ok(has(Date.UTC(2026, 9, 21, 14), Date.UTC(2026, 9, 21, 14, 30)), "events in another time zone convert (9:00 Chicago = 14:00 UTC)");
ok(has(zonedToUtc(2026, 10, 22, 0, 0, 0, NY), zonedToUtc(2026, 10, 23, 0, 0, 0, NY)), "all-day busy events block the whole day");
ok(!busy.some(([a]) => a === zonedToUtc(2026, 10, 23, 0, 0, 0, NY)) && !busy.some(([a]) => a === Date.UTC(2026, 9, 24, 15)), "free (transparent) and canceled events don't block");
const weekly = busy.filter(([a, b]) => b - a === 36e5 && nyParts(a).hour === 12).map(([a]) => nyParts(a).day + "/" + nyParts(a).month);
ok(JSON.stringify(weekly) === JSON.stringify(["19/10", "28/10", "2/11", "4/11"]), "weekly repeats on Mon and Wed, minus the skipped date and the moved one: " + weekly.join(" "));
ok(has(zonedToUtc(2026, 10, 26, 15, 0, 0, NY), zonedToUtc(2026, 10, 26, 16, 0, 0, NY)), "a moved occurrence is busy at its new time");
ok(busy.filter(([a, b]) => b - a === 45 * 6e4).length === 3, "daily repeats stop after COUNT");
const h = busy.filter(([a, b]) => b - a === 36e5 && nyParts(a).hour === 9).map(([a]) => a);
ok(h.length === 3 && h[1] - h[0] === 7 * 864e5 + 36e5 && h[2] - h[1] === 7 * 864e5, "weekly repeats keep their wall-clock time across the end of daylight saving");
const feed = buildIcs({ name: "Desk", events: [{ uid: "x@hp", start: Date.UTC(2026, 9, 20, 15), end: Date.UTC(2026, 9, 20, 15, 30), title: "Call: Lee, Margaret; FE", description: "Line one\nLine two " + "x".repeat(120) }] });
ok(/SUMMARY:Call: Lee\\, Margaret\\; FE/.test(feed) && /DESCRIPTION:Line one\\nLine two/.test(feed) && feed.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75) && /\r\n x/.test(feed), "the feed escapes text and folds long lines");
ok(busyFromIcs(feed, from, to, NY).length === 1, "and reads back");

/* ---------- booking ---------- */
await call("boss", "/api/auth/signup", { method: "POST", body: { email: "boss@hp.com", password: "password2", name: "Boss Lady" } });
await call("rep", "/api/auth/signup", { method: "POST", body: { email: "rep@hp.com", password: "password1", name: "Rita Rep", invite: "HP2026", agree: true } });
await call("rep2", "/api/auth/signup", { method: "POST", body: { email: "rita2@hp.com", password: "password3", name: "Rita Rep", invite: "HP2026", agree: true } });
const rep = (await call("rep", "/api/auth/me")).j.user;
let r = await call("rep", "/api/book/settings");
ok(r.s === 200 && r.j.settings.slug === "rita-rep" && r.j.link === "https://desk.example.com/book/rita-rep" && r.j.settings.on === false, "each agent gets a booking link from their name: " + r.j.link);
ok((await call("rep2", "/api/book/settings")).j.settings.slug === "rita-rep-2", "two agents with the same name get different links");
ok((await call(null, "/api/book/p/rita-rep")).s === 404, "the link is off until the agent turns it on");
const all = Array(7).fill(["09:00", "17:00"]);
r = await call("rep", "/api/book/settings", { method: "POST", body: { on: true, hours: all, length: 20, buffer: 10, notice: 0, ahead: 14, tz: NY, title: "Talk with Rita", maxPerDay: 0 } });
ok(r.j.settings.on && r.j.settings.length === 20, "the agent turns it on");
r = await call(null, "/api/book/p/rita-rep");
ok(r.s === 200 && r.j.agent.name === "Rita Rep" && r.j.agent.title === "Talk with Rita" && r.j.days.length === 15 && r.j.company === "Highpoint Financial", "the public page gets the agent and two weeks of days");
const day = r.j.days[3], slots = day.slots;
ok(slots.length === 24 && nyParts(slots[0]).hour === 9 && nyParts(slots[0]).minute === 0 && nyParts(slots.at(-1)).hour === 16 && nyParts(slots.at(-1)).minute === 40 && slots[1] - slots[0] === 20 * 6e4, "open times run 9:00 to 4:40 (last 20-minute call ends at 5) in 20-minute steps");
ok(r.j.days[0].slots.every((t) => t > Date.now()), "no times in the past");
const at = slots[6]; // 11:00
const form = { at, tz: "America/Chicago", first: "Margaret", last: "Lee", phone: "(212) 555-0142", email: "margaret@example.com", state: "NY", product: "FE", notes: "Prefers mornings", consent: true };
ok((await call(null, "/api/book/p/rita-rep", { method: "POST", body: { ...form, consent: false } })).s === 400, "booking needs the call consent box");
ok((await call(null, "/api/book/p/rita-rep", { method: "POST", body: { ...form, phone: "555" } })).s === 400, "and a real phone number");
ok((await call(null, "/api/book/p/rita-rep", { method: "POST", body: { ...form, at: at + 7 * 6e4 } })).j.code === "taken", "only offered times can be booked");
r = await call(null, "/api/book/p/rita-rep", { method: "POST", body: form });
ok(r.s === 200 && r.j.ok && r.j.at === at && /\/book\/rita-rep\?m=/.test(r.j.manage) && r.j.emailed, "a client books a time: " + JSON.stringify(r.j).slice(0, 120));
const manage = r.j.manage.split("m=")[1];
const docs = (col) => sql.prepare("SELECT id, data FROM docs WHERE scope=? AND col=?").all(rep.id, col).map((x) => ({ id: x.id, ...JSON.parse(x.data) }));
let lead = docs("leads")[0], appt = docs("appts")[0];
ok(lead && lead.first === "Margaret" && lead.phone === "2125550142" && lead.stage === "appointment" && lead.source === "Booking link" && lead.product === "FE" && lead.consent?.via === "booking link" && lead.consent.ip === "203.0.113.9", "the client lands in the CRM with their consent recorded");
ok(appt && appt.at === at && appt.dur === 20 && appt.leadId === lead.id && appt.booked?.token === manage && /booked online/.test(appt.title), "the call is on the desk calendar");
ok(lead.notes.some((n) => n.text === "Prefers mornings"), "their note is saved");
ok(mails.length === 2 && mails.some((m) => m.to[0] === "margaret@example.com" && /booked with Rita/.test(m.html) && /10:00 AM CDT/.test(m.html)) && mails.some((m) => m.to[0] === "rep@hp.com" && /New booking: Margaret Lee/.test(m.subject)), "the client gets a confirmation in their time zone, and the agent is emailed");
r = await call(null, "/api/book/p/rita-rep");
const d3 = r.j.days.find((d) => d.day === day.day).slots;
ok(!d3.includes(at) && !d3.includes(at - 20 * 6e4) && !d3.includes(at + 20 * 6e4) && d3.includes(at + 40 * 6e4) && d3.includes(at - 40 * 6e4), "the booked time and the 10-minute break around it are gone");
ok((await call(null, "/api/book/p/rita-rep", { method: "POST", body: { ...form, phone: "2125550199" } })).j.code === "taken", "nobody else can book it");
r = await call(null, "/api/book/p/rita-rep", { method: "POST", body: { ...form, at: r.j.days[5].slots[2], email: "", notes: "" } });
ok(r.j.ok && docs("leads").length === 1 && docs("appts").length === 2 && docs("leads")[0].notes.filter((n) => /Booked a call online/.test(n.text)).length === 2, "the same client booking again updates their file instead of making a new one");

// managing a booking
r = await call(null, "/api/book/m/" + manage);
ok(r.s === 200 && r.j.at === at && r.j.canceled === false && r.j.agent.name === "Rita Rep", "the client's link shows their booking");
mails.length = 0;
r = await call(null, "/api/book/m/" + manage, { method: "POST", body: { cancel: true } });
appt = docs("appts").find((a) => a.at === at);
ok(r.j.canceled && appt.canceled && appt.done && /canceled by client/.test(appt.title), "they can cancel it");
ok((await call(null, "/api/book/p/rita-rep")).j.days.find((d) => d.day === day.day).slots.includes(at), "the time opens up again");
ok(mails.length === 1 && /Canceled: Margaret Lee/.test(mails[0].subject), "the agent is told");
ok(docs("leads")[0].notes.some((n) => /Canceled their booked call/.test(n.text)), "a note goes on the client");
ok((await call(null, "/api/book/m/nope-nope-nope-nope")).s === 404, "made-up booking links don't work");

// busy times from Google Calendar
const dd = (await call(null, "/api/book/p/rita-rep")).j.days[7], dp = nyParts(dd.slots[0]);
ICS = `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:z\r\nDTSTART;TZID=America/New_York:${dp.year}${String(dp.month).padStart(2, "0")}${String(dp.day).padStart(2, "0")}T130000\r\nDTEND;TZID=America/New_York:${dp.year}${String(dp.month).padStart(2, "0")}${String(dp.day).padStart(2, "0")}T150000\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
r = await call("rep", "/api/book/check-busy", { method: "POST", body: { url: "https://calendar.google.com/calendar/ical/x/private-abc/basic.ics" } });
ok(r.j.ok && r.j.count === 1, "Check finds the busy times on a secret iCal address");
ok(/wasn't found/.test((await call("rep", "/api/book/check-busy", { method: "POST", body: { url: "https://calendar.google.com/missing.ics" } })).j.error), "a wrong address gets a clear error");
ok((await call("rep", "/api/book/settings", { method: "POST", body: { busyUrl: "not a url" } })).s === 400, "only real addresses are saved");
await call("rep", "/api/book/settings", { method: "POST", body: { busyUrl: "https://calendar.google.com/calendar/ical/x/private-abc/basic.ics" } });
const after = (await call(null, "/api/book/p/rita-rep")).j.days[7].slots.map((t) => nyParts(t)), hrs = after.map((p) => p.hour + p.minute / 60);
ok(!hrs.some((x) => x > 12.5 && x < 15.17) && hrs.includes(12) && hrs.includes(15 + 1 / 3), "busy Google Calendar time (1–3 PM, plus the break) isn't offered");
r = await call("rep", "/api/book/settings");
ok(r.j.busy && r.j.busy.count === 1 && !r.j.busy.error, "the settings show when the calendar was last read");

// limits and link names
await call("rep", "/api/book/settings", { method: "POST", body: { maxPerDay: 1 } });
ok((await call(null, "/api/book/p/rita-rep")).j.days[5].slots.length === 0, "a day with the most bookings allowed shows no more times");
await call("rep", "/api/book/settings", { method: "POST", body: { maxPerDay: 0, hours: [null, ["09:00", "12:00"], null, null, null, null, null] } });
r = await call(null, "/api/book/p/rita-rep");
ok(r.j.days.every((d) => d.dow === 1 || !d.slots.length) && r.j.days.some((d) => d.dow === 1 && d.slots.length), "only the days and hours the agent works are offered");
r = await call("rep", "/api/book/settings", { method: "POST", body: { slug: "Rita!" } });
ok(r.j.settings.slug === "rita" && (await call(null, "/api/book/p/rita-rep")).s === 404 && (await call(null, "/api/book/p/rita")).s === 200, "the agent can rename their link");
ok((await call("rep2", "/api/book/settings", { method: "POST", body: { slug: "rita" } })).j.settings.slug === "rita-2", "a taken name gets a number");

// calendar feed
const L = docs("leads")[0];
sql.prepare("UPDATE docs SET data=? WHERE scope=? AND col='leads' AND id=?").run(JSON.stringify({ ...L, callbackAt: Date.now() + 3 * 864e5 }), rep.id, L.id);
r = await call("rep", "/api/book/settings", { method: "POST", body: { op: "feed" } });
const fu = r.j.feed, ft = fu.split("/").pop();
ok(/^https:\/\/desk\.example\.com\/api\/cal\/[A-Za-z0-9_-]{30,}\.ics$/.test(fu), "the agent makes a private calendar link: " + fu);
r = await call(null, "/api/cal/" + ft);
ok(r.s === 200 && /text\/calendar/.test(r.h.get("content-type")) && /BEGIN:VCALENDAR/.test(r.j), "Google Calendar can read it");
ok(/SUMMARY:Phone call: Margaret Lee/.test(r.j) && /Phone: \(212\) 555-0142/.test(r.j) && /STATUS:CANCELLED/.test(r.j) && /SUMMARY:Callback: Margaret Lee/.test(r.j), "it lists appointments (canceled ones marked) and callbacks");
await call("rep", "/api/book/settings", { method: "POST", body: { op: "feed" } });
ok((await call(null, "/api/cal/" + ft)).s === 404, "a new link turns the old one off");
await call("rep", "/api/book/settings", { method: "POST", body: { on: false } });
ok((await call(null, "/api/book/p/rita")).s === 404, "turning the link off stops bookings");
