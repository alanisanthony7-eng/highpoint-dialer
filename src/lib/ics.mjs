// iCalendar (.ics) helpers: time-zone math, reading busy times from a calendar's secret iCal address
// (Google, Outlook, Apple), and writing a calendar feed that Google Calendar can subscribe to.

/* ---------- time zones ---------- */
const fmtCache = new Map();
function partsIn(t, tz) {
  let f = fmtCache.get(tz);
  if (!f) { f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" }); fmtCache.set(tz, f); }
  const o = {}; for (const p of f.formatToParts(t)) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second, dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(o.weekday) };
}
export const validTz = (tz) => { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; } };
const offsetAt = (t, tz) => { const p = partsIn(t, tz); return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(t / 1000) * 1000; };
// wall-clock time in a zone -> UTC milliseconds
export function zonedToUtc(y, m, d, h = 0, mi = 0, s = 0, tz = "UTC") {
  const guess = Date.UTC(y, m - 1, d, h, mi, s);
  let t = guess - offsetAt(guess, tz);
  const o2 = offsetAt(t, tz); if (guess - o2 !== t) t = guess - o2; // DST edges
  return t;
}
export const localParts = partsIn;
export const dayKey = (t, tz) => { const p = partsIn(t, tz); return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`; };

// Windows zone names some calendars (Outlook) put in TZID
const WIN = { "Eastern Standard Time": "America/New_York", "Central Standard Time": "America/Chicago", "Mountain Standard Time": "America/Denver", "US Mountain Standard Time": "America/Phoenix", "Pacific Standard Time": "America/Los_Angeles", "Alaskan Standard Time": "America/Anchorage", "Hawaiian Standard Time": "Pacific/Honolulu", "Atlantic Standard Time": "America/Halifax", "GMT Standard Time": "Europe/London", "UTC": "UTC" };
const zoneOf = (tzid, fallback) => { if (!tzid) return fallback; const z = tzid.replace(/^"|"$/g, "").replace(/^\/.*?\/(?=[A-Z])/, ""); return validTz(z) ? z : WIN[z] || fallback; };

/* ---------- reading ---------- */
function unfold(text) { return String(text || "").replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n"); }
function prop(line) {
  const i = line.indexOf(":"); if (i < 0) return null;
  const [name, ...params] = line.slice(0, i).split(";");
  const p = {}; for (const x of params) { const j = x.indexOf("="); if (j > 0) p[x.slice(0, j).toUpperCase()] = x.slice(j + 1); }
  return { name: name.toUpperCase(), params: p, value: line.slice(i + 1).trim() };
}
// a DTSTART/DTEND/EXDATE value -> { t (UTC ms), allDay, local: {y,m,d,h,mi,s}, tz }
function when(value, params, fallbackTz) {
  const v = String(value).trim(), m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [y, mo, d, h = "0", mi = "0", s = "0"] = [+m[1], +m[2], +m[3], m[4], m[5], m[6]];
  const local = { y, m: mo, d, h: +h, mi: +mi, s: +(s || 0) };
  if (!m[4] || params?.VALUE === "DATE") return { t: zonedToUtc(y, mo, d, 0, 0, 0, fallbackTz), allDay: true, local: { y, m: mo, d, h: 0, mi: 0, s: 0 }, tz: fallbackTz };
  if (m[7]) return { t: Date.UTC(y, mo - 1, d, +h, +mi, +(s || 0)), allDay: false, local, tz: "UTC" };
  const tz = zoneOf(params?.TZID, fallbackTz);
  return { t: zonedToUtc(y, mo, d, +h, +mi, +(s || 0), tz), allDay: false, local, tz };
}
function duration(v) { // P1DT2H30M, PT45M, P1W
  const m = String(v || "").match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/); if (!m) return null;
  return (m[1] === "-" ? -1 : 1) * (((+m[2] || 0) * 7 + (+m[3] || 0)) * 864e5 + (+m[4] || 0) * 36e5 + (+m[5] || 0) * 6e4 + (+m[6] || 0) * 1e3);
}
const DAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
// occurrences of a recurring event (DAILY, WEEKLY with BYDAY, MONTHLY by day of month, YEARLY), as UTC start times
function expand(start, rule, from, to, tz) {
  const r = {}; for (const kv of rule.split(";")) { const [k, v] = kv.split("="); if (k) r[k.toUpperCase()] = v; }
  const freq = r.FREQ, step = Math.max(1, +r.INTERVAL || 1), count = +r.COUNT || 0;
  const until = r.UNTIL ? when(r.UNTIL, {}, tz)?.t ?? Infinity : Infinity;
  const L = start.local, at = (y, m, d) => zonedToUtc(y, m, d, L.h, L.mi, L.s, start.allDay ? tz : start.tz);
  const out = []; let n = 0, guard = 0;
  const push = (t) => { if (t < start.t) return true; if (t > until || (count && n >= count)) return false; n++; if (t >= from && t <= to) out.push(t); return t <= to; };
  const base = new Date(Date.UTC(L.y, L.m - 1, L.d));
  if (freq === "DAILY") { for (let i = 0; guard++ < 20000; i += step) { const x = new Date(base.getTime() + i * 864e5); if (!push(at(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate()))) break; } }
  else if (freq === "WEEKLY") {
    const days = (r.BYDAY ? r.BYDAY.split(",").map((x) => DAYS[x.replace(/^[+-]?\d+/, "")]).filter((x) => x != null) : [base.getUTCDay()]).sort();
    const week0 = new Date(base.getTime() - base.getUTCDay() * 864e5);
    outer: for (let w = 0; guard++ < 5000; w += step) for (const dd of days) { const x = new Date(week0.getTime() + (w * 7 + dd) * 864e5); if (!push(at(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate()))) break outer; }
  } else if (freq === "MONTHLY") { for (let i = 0; guard++ < 2400; i += step) { const x = new Date(Date.UTC(L.y, L.m - 1 + i, 1)); const dim = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate(); if (L.d > dim) continue; if (!push(at(x.getUTCFullYear(), x.getUTCMonth() + 1, L.d))) break; } }
  else if (freq === "YEARLY") { for (let i = 0; guard++ < 200; i += step) { if (!push(at(L.y + i, L.m, L.d))) break; } }
  else if (start.t >= from && start.t <= to) out.push(start.t);
  return out;
}
// Busy blocks [[start, end], ...] (UTC ms) between from and to, from an .ics file.
// Free/transparent and canceled events are skipped. tz is used for all-day and floating times.
export function busyFromIcs(text, from, to, tz = "America/New_York") {
  const events = []; let cur = null;
  for (const line of unfold(text)) {
    if (line === "BEGIN:VEVENT") { cur = { ex: [] }; continue; }
    if (line === "END:VEVENT") { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const p = prop(line); if (!p) continue;
    if (p.name === "DTSTART") cur.start = when(p.value, p.params, tz);
    else if (p.name === "DTEND") cur.end = when(p.value, p.params, tz);
    else if (p.name === "DURATION") cur.dur = duration(p.value);
    else if (p.name === "RRULE") cur.rrule = p.value;
    else if (p.name === "EXDATE") for (const v of p.value.split(",")) { const w = when(v, p.params, tz); if (w) cur.ex.push(w.t); }
    else if (p.name === "TRANSP") cur.free = /TRANSPARENT/i.test(p.value);
    else if (p.name === "STATUS") cur.canceled = /CANCELLED/i.test(p.value);
    else if (p.name === "UID") cur.uid = p.value;
    else if (p.name === "RECURRENCE-ID") cur.recur = when(p.value, p.params, tz);
  }
  // moved or canceled single occurrences replace the series' original time
  const moved = new Map(); for (const e of events) if (e.recur && e.uid) { if (!moved.has(e.uid)) moved.set(e.uid, new Set()); moved.get(e.uid).add(e.recur.t); }
  const out = [];
  for (const e of events) {
    if (!e.start || e.free || e.canceled) continue;
    const len = e.end ? e.end.t - e.start.t : e.dur ?? (e.start.allDay ? 864e5 : 0);
    if (!(len > 0)) continue;
    const skip = new Set([...e.ex, ...(!e.recur && e.uid && moved.get(e.uid) ? moved.get(e.uid) : [])]);
    const starts = e.rrule && !e.recur ? expand(e.start, e.rrule, from - len, to, tz) : e.start.t + len > from && e.start.t < to ? [e.start.t] : [];
    for (const s of starts) if (!skip.has(s) && s + len > from && s < to) out.push([s, s + len]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/* ---------- writing ---------- */
const esc = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const stamp = (t) => new Date(t).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
function fold(line) { // lines longer than 75 bytes continue on the next line, indented by a space
  const enc = new TextEncoder(); if (enc.encode(line).length <= 75) return line;
  const out = []; let cur = "";
  for (const ch of line) { if (enc.encode(cur + ch).length > (out.length ? 74 : 75)) { out.push(cur); cur = ""; } cur += ch; }
  out.push(cur); return out.join("\r\n ");
}
// events: [{ uid, start, end, title, description, location, url, canceled }]
export function buildIcs({ name, events, refreshMin = 15 }) {
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Highpoint Financial//Agent Desk//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${esc(name)}`, `X-PUBLISHED-TTL:PT${refreshMin}M`, `REFRESH-INTERVAL;VALUE=DURATION:PT${refreshMin}M`];
  const now = stamp(Date.now());
  for (const e of events) {
    L.push("BEGIN:VEVENT", `UID:${esc(e.uid)}`, `DTSTAMP:${now}`, `DTSTART:${stamp(e.start)}`, `DTEND:${stamp(e.end)}`, `SUMMARY:${esc(e.title)}`);
    if (e.description) L.push(`DESCRIPTION:${esc(e.description)}`);
    if (e.location) L.push(`LOCATION:${esc(e.location)}`);
    if (e.url) L.push(`URL:${e.url}`);
    L.push(`STATUS:${e.canceled ? "CANCELLED" : "CONFIRMED"}`, "END:VEVENT");
  }
  L.push("END:VCALENDAR");
  return L.map(fold).join("\r\n") + "\r\n";
}
