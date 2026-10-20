// Booking links and calendar feeds.
//  - Each agent gets a public booking page (/book/<name>) where clients pick an open time. Open times come from
//    the agent's weekly hours, minus desk appointments and (optionally) busy times on their Google/Outlook
//    calendar, read from its secret iCal address. A booking adds or updates the client in the CRM, puts the
//    appointment on the desk calendar, emails both sides, and schedules the reminder texts if they're on.
//  - A secret calendar feed (.ics) of desk appointments and callbacks that Google Calendar can subscribe to.
//
//   GET|POST /api/book/settings            the agent's booking settings (POST saves; { op: "feed" } makes a new feed link)
//   POST     /api/book/check-busy          { url } tests a secret iCal address
//   GET      /api/book/p/<slug>?tz=        public: the agent and open times
//   POST     /api/book/p/<slug>             public: book a time
//   GET|POST /api/book/m/<token>            public: see or cancel a booking
//   GET      /api/cal/<token>.ics           the calendar feed
import { getStore, D1, ensureSchema } from "./store.mjs";
import { to10, siteUrl, config as loadConfig, getJ } from "./hp.mjs";
import { requireFeature, userById } from "./auth.mjs";
import { emailOn, sendEmail, layout } from "./email.mjs";
import { busyFromIcs, buildIcs, zonedToUtc, localParts, dayKey, validTz } from "./ics.mjs";

const kv = () => getStore("hpd-book");
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const rand = (n) => { const b = crypto.getRandomValues(new Uint8Array(n)); return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const fmtPhone = (p) => (p && p.length === 10 ? `(${p.slice(0, 3)}) ${p.slice(3, 6)}-${p.slice(6)}` : p || "");
const WEEK = [null, ["09:00", "17:00"], ["09:00", "17:00"], ["09:00", "17:00"], ["09:00", "17:00"], ["09:00", "17:00"], null]; // Sun..Sat
export const BOOK_DEFAULTS = { on: false, slug: "", title: "", intro: "", length: 20, buffer: 10, notice: 2, ahead: 14, tz: "America/New_York", hours: WEEK, type: "Phone call", busyUrl: "", maxPerDay: 8 };
const PRODUCTS = { FE: "Final expense", MP: "Mortgage protection", IUL: "IUL / cash value", "": "Not sure yet" };
const STATES = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR".split(" ");
const slugify = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 40).replace(/^-|-$/g, "");
const okTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s || "");
export const bookUrl = (slug) => `${siteUrl()}/book/${slug}`;
const feedUrl = (tok) => `${siteUrl()}/api/cal/${tok}.ics`;
const err = (status, msg) => Object.assign(new Error(msg), { status });

async function settingsOf(uid) { const s = (await kv().get("s:" + uid, { type: "json" }).catch(() => null)) || {}; return { ...BOOK_DEFAULTS, ...s, hours: Array.isArray(s.hours) && s.hours.length === 7 ? s.hours : WEEK }; }
async function uidForSlug(slug) { return slug && /^[a-z0-9-]{2,40}$/.test(slug) ? await kv().get("slug:" + slug).catch(() => null) : null; }
// a free link name, from the agent's name
async function claimSlug(uid, want) {
  let base = slugify(want) || "agent"; if (base.length < 2) base += "-agent";
  for (let i = 0; i < 50; i++) {
    const s = i ? `${base}-${i + 1}` : base, owner = await kv().get("slug:" + s).catch(() => null);
    if (owner === uid) return s;
    if (!owner && !["settings", "check-busy", "p", "m", "admin", "api", "book"].includes(s)) { const r = await kv().set("slug:" + s, uid, { onlyIfNew: true }); if (r?.modified !== false) return s; }
  }
  throw err(409, "That link name is taken. Try another.");
}

/* ---------- busy times ---------- */
async function deskBusy(uid, from, to) {
  const out = [];
  const r = await D1().prepare("SELECT id, data FROM docs WHERE scope=?1 AND col='appts'").bind(uid).all();
  for (const x of r.results || []) { const a = JSON.parse(x.data); if (a.done || a.canceled || !(a.at >= from - 864e5 && a.at <= to)) continue; out.push([a.at, a.at + (+a.dur || 30) * 6e4]); }
  return out;
}
async function calBusy(uid, s, from, to, { fresh = false } = {}) {
  if (!s.busyUrl) return { blocks: [] };
  const key = "busy:" + uid, c = !fresh && (await kv().get(key, { type: "json" }).catch(() => null));
  if (c && c.url === s.busyUrl && Date.now() - c.at < 10 * 60_000 && c.from <= from && c.to >= to) return { blocks: c.blocks, at: c.at, error: c.error };
  let blocks = [], error = "";
  try {
    const url = s.busyUrl.replace(/^webcal:/i, "https:");
    const r = await fetch(url, { headers: { accept: "text/calendar" } });
    const text = r.ok ? await r.text() : "";
    if (!r.ok) error = r.status === 404 ? "That calendar address wasn't found. Copy the secret address again." : `The calendar didn't answer (${r.status}).`;
    else if (!/BEGIN:VCALENDAR/.test(text)) error = "That link isn't a calendar file. Use the secret address in iCal format.";
    else blocks = busyFromIcs(text, from - 864e5, to + 864e5, s.tz);
  } catch { error = "Couldn't reach that calendar."; }
  await kv().setJSON(key, { url: s.busyUrl, at: Date.now(), from: from - 864e5, to: to + 864e5, blocks: error && c?.url === s.busyUrl ? c.blocks : blocks, error }).catch(() => {});
  return { blocks: error && c?.url === s.busyUrl ? c.blocks : blocks, at: Date.now(), error };
}

// open start times (UTC ms) by day, in the agent's time zone
export async function openSlots(uid, s, { days, fresh } = {}) {
  const now = Date.now(), tz = validTz(s.tz) ? s.tz : "America/New_York", len = Math.max(10, +s.length || 20) * 6e4, buf = Math.max(0, +s.buffer || 0) * 6e4;
  const earliest = now + Math.max(0, +s.notice || 0) * 36e5, ahead = Math.min(60, Math.max(1, +s.ahead || 14));
  const t0 = localParts(now, tz), from = zonedToUtc(t0.y, t0.m, t0.d, 0, 0, 0, tz), to = from + (ahead + 1) * 864e5;
  const busy = [...(await deskBusy(uid, from, to)), ...(await calBusy(uid, s, from, to, { fresh })).blocks].map(([a, b]) => [a - buf, b + buf]);
  const step = Math.min(len, 30 * 6e4), out = [];
  const perDay = {}; // bookings already made through the link, per day
  for (const x of (await D1().prepare("SELECT data FROM docs WHERE scope=?1 AND col='appts'").bind(uid).all()).results || []) { const a = JSON.parse(x.data); if (a.booked && !a.canceled && a.at >= from) { const k = dayKey(a.at, tz); perDay[k] = (perDay[k] || 0) + 1; } }
  for (let i = 0; i <= ahead; i++) {
    const noon = zonedToUtc(t0.y, t0.m, t0.d + i, 12, 0, 0, tz), p = localParts(noon, tz), win = s.hours[p.dow], key = dayKey(noon, tz);
    if (days && !days.includes(key)) continue;
    const slots = [];
    if (win && okTime(win[0]) && okTime(win[1]) && !(s.maxPerDay && (perDay[key] || 0) >= s.maxPerDay)) {
      const [sh, sm] = win[0].split(":").map(Number), [eh, em] = win[1].split(":").map(Number);
      const start = zonedToUtc(p.y, p.m, p.d, sh, sm, 0, tz), end = zonedToUtc(p.y, p.m, p.d, eh, em, 0, tz);
      for (let t = start; t + len <= end; t += step) if (t >= earliest && !busy.some(([a, b]) => t < b && t + len > a)) slots.push(t);
    }
    out.push({ day: key, dow: p.dow, slots });
  }
  return out;
}

/* ---------- the calendar feed ---------- */
async function feedRoute(req, file) {
  const tok = String(file || "").replace(/\.ics$/i, "");
  const uid = /^[A-Za-z0-9_-]{20,60}$/.test(tok) ? await kv().get("feed:" + tok).catch(() => null) : null;
  if (!uid) return new Response("Not found", { status: 404 });
  const u = await userById(uid); if (!u || u.disabled) return new Response("Not found", { status: 404 });
  const from = Date.now() - 30 * 864e5, to = Date.now() + 180 * 864e5;
  const leads = new Map(((await D1().prepare("SELECT id, data FROM docs WHERE scope=?1 AND col='leads'").bind(uid).all()).results || []).map((x) => [x.id, JSON.parse(x.data)]));
  const events = [];
  for (const x of (await D1().prepare("SELECT id, data FROM docs WHERE scope=?1 AND col='appts'").bind(uid).all()).results || []) {
    const a = JSON.parse(x.data); if (!(a.at >= from && a.at <= to)) continue;
    const l = leads.get(a.leadId), phone = l?.phone ? fmtPhone(l.phone) : "";
    const who = a.leadName || [l?.first, l?.last].filter(Boolean).join(" ");
    events.push({ uid: `${x.id}@highpoint-desk`, start: a.at, end: a.at + (+a.dur || 30) * 6e4, title: `${a.type === "Callback" ? "Callback" : a.type || "Call"}: ${who || a.title || "Appointment"}`, description: [phone && `Phone: ${phone}`, a.title && a.title !== who && a.title, l?.product && `Product: ${l.product}`, a.booked && "Booked online by the client", "Open the desk: " + siteUrl()].filter(Boolean).join("\n"), canceled: !!a.canceled });
  }
  for (const [id, l] of leads) if (l.callbackAt >= from && l.callbackAt <= to && !["sold", "lost"].includes(l.stage)) {
    const who = [l.first, l.last].filter(Boolean).join(" ") || "Client";
    events.push({ uid: `cb-${id}-${l.callbackAt}@highpoint-desk`, start: l.callbackAt, end: l.callbackAt + 15 * 6e4, title: `Callback: ${who}`, description: [l.phone && `Phone: ${fmtPhone(l.phone)}`, "Open the desk: " + siteUrl()].filter(Boolean).join("\n") });
  }
  const body = buildIcs({ name: `Highpoint Desk · ${u.name}`, events: events.sort((a, b) => a.start - b.start) });
  return new Response(req.method === "HEAD" ? null : body, { headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "no-store", "content-disposition": 'inline; filename="highpoint-desk.ics"' } });
}

/* ---------- booking ---------- */
const whenText = (t, tz) => new Date(t).toLocaleString("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).replace(/\u202f/g, " ");
async function publicInfo(uid, s) {
  const u = await userById(uid), cfg = await loadConfig().catch(() => ({ settings: {} })), company = cfg.settings?.company || "Highpoint Financial";
  const first = String(u?.name || "").split(" ")[0] || "your agent";
  return { u, company, agent: { name: u?.name || "Your agent", first, title: s.title || `Talk with ${first} about life insurance`, intro: s.intro || `Pick a time for a short ${s.type === "Zoom" ? "Zoom" : "phone"} call. ${first} will go over your options, answer questions and get you a quote. No cost, no obligation.` } };
}
async function bump(scope, col) { await D1().prepare("INSERT INTO colver (scope, col, v) VALUES (?1, ?2, 1) ON CONFLICT(scope, col) DO UPDATE SET v = v + 1").bind(scope, col).run(); }

async function bookRoute(req, slug) {
  await ensureSchema();
  const uid = await uidForSlug(slug), s = uid ? await settingsOf(uid) : null;
  if (!uid || !s.on || s.slug !== slug) return json({ error: "This booking link isn't active. Contact your agent for a new one." }, 404);
  const { u, company, agent } = await publicInfo(uid, s);
  if (!u || u.disabled || u.access?.ok === false) return json({ error: "This booking link isn't active right now." }, 404);
  if (req.method === "GET") {
    const days = await openSlots(uid, s);
    return json({ agent, company, length: s.length, type: s.type, tz: s.tz, products: PRODUCTS, states: STATES, days });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const b = await req.json().catch(() => ({}));
  if (b.website) return json({ ok: true }); // a bot filled the hidden field
  const at = +b.at, first = String(b.first || "").trim().slice(0, 60), last = String(b.last || "").trim().slice(0, 60), phone = to10(b.phone), email = String(b.email || "").trim().toLowerCase().slice(0, 120);
  if (!first) return json({ error: "Add your first name." }, 400);
  if (!phone) return json({ error: "Add a 10-digit US phone number so your agent can call you." }, 400);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "That email doesn't look right." }, 400);
  if (!b.consent) return json({ error: "Check the box so your agent can call you at this number." }, 400);
  const tz = validTz(s.tz) ? s.tz : "America/New_York", ctz = validTz(b.tz) ? b.tz : tz;
  const day = dayKey(at, tz), open = (await openSlots(uid, s, { days: [day], fresh: true }))[0]?.slots || [];
  if (!open.includes(at)) return json({ error: "That time was just taken. Pick another one.", code: "taken" }, 409);
  // two people choosing the same time at once: the first one gets it
  const lockKey = `slot:${uid}:${at}`, lk = await kv().set(lockKey, String(Date.now()), { onlyIfNew: true });
  if (lk?.modified === false) {
    const held = +(await kv().get(lockKey).catch(() => 0) || 0);
    if (Date.now() - held < 60_000) return json({ error: "That time was just taken. Pick another one.", code: "taken" }, 409);
    await kv().set(lockKey, String(Date.now())); // an old hold for a time that's open again
  }
  // at most 3 bookings a day from one phone number
  const pk = `ph:${phone}:${dayKey(Date.now(), tz)}`, n = +(await kv().get(pk).catch(() => 0) || 0);
  if (n >= 3) return json({ error: "You've already booked today. Your agent will be in touch." }, 429);
  await kv().set(pk, String(n + 1));
  const now = Date.now(), product = PRODUCTS[b.product] && b.product ? b.product : "", state = STATES.includes(String(b.state || "").toUpperCase()) ? String(b.state).toUpperCase() : "";
  const name = [first, last].filter(Boolean).join(" "), notes = String(b.notes || "").trim().slice(0, 1000);
  const consentText = `Booked a call on the online booking page and agreed to be contacted by ${company} at ${fmtPhone(phone)} about this appointment.`;
  const ip = req.headers.get("cf-connecting-ip") || "";
  // the client in the CRM (same phone -> same client)
  const ex = await D1().prepare("SELECT id, data FROM docs WHERE scope=?1 AND col='leads' AND (json_extract(data,'$.phone')=?2 OR json_extract(data,'$.phone2')=?2) LIMIT 1").bind(uid, phone).first();
  let leadId, lead;
  if (ex) {
    leadId = ex.id; lead = JSON.parse(ex.data);
    if (!["application", "sold"].includes(lead.stage)) lead.stage = "appointment";
    if (email && !lead.email) lead.email = email; if (state && !lead.state) lead.state = state; if (product && !lead.product) lead.product = product;
    lead.notes = [...(lead.notes || []), { t: now, text: `Booked a call online for ${whenText(at, tz)}${notes ? `: ${notes}` : ""}` }];
    lead.consent = { ...(lead.consent || {}), consentText, consentAt: new Date(now).toISOString(), ip, via: "booking link" };
    lead.updatedAt = now;
  } else {
    leadId = newId();
    lead = { first, last, phone, ...(email ? { email } : {}), ...(state ? { state } : {}), product, stage: "appointment", source: "Booking link", callCount: 0, createdAt: now, updatedAt: now, notes: [{ t: now, text: `Booked a call online for ${whenText(at, tz)}` }, ...(notes ? [{ t: now, text: notes }] : [])], consent: { consentText, consentAt: new Date(now).toISOString(), ip, via: "booking link" } };
  }
  const apptId = newId(), token = rand(18);
  const appt = { leadId, leadName: name, title: `${name} (booked online)`, at, dur: +s.length || 20, type: s.type || "Phone call", done: false, createdAt: now, booked: { at: now, token, clientTz: ctz, ...(notes ? { notes } : {}) } };
  await D1().batch([
    D1().prepare("INSERT OR REPLACE INTO docs (scope, col, id, data, updated) VALUES (?1, 'leads', ?2, ?3, ?4)").bind(uid, leadId, JSON.stringify(lead), now),
    D1().prepare("INSERT INTO docs (scope, col, id, data, updated) VALUES (?1, 'appts', ?2, ?3, ?4)").bind(uid, apptId, JSON.stringify(appt), now),
  ]);
  await bump(uid, "leads"); await bump(uid, "appts");
  await kv().setJSON("bk:" + token, { uid, apptId, leadId, at, slug, name });
  try { const fu = await import("./followups.mjs"); await fu.onApptSaved(u, apptId, appt); } catch (e) { console.error("booking reminders", e); }
  const manage = `${bookUrl(slug)}?m=${token}`;
  if (emailOn()) {
    const jobs = [];
    if (email) { const m = layout({ title: `You're booked with ${agent.first}`, paras: [`Your call with <b>${agent.name}</b> of ${company} is set for <b>${whenText(at, ctz)}</b>.`, `${agent.first} will call you at ${fmtPhone(phone)}. It takes about ${s.length} minutes.`], button: { label: "Change or cancel", url: manage }, after: ["Can't make it? Use the button above to cancel, then pick a new time."] }); jobs.push(sendEmail({ to: email, subject: `Your call with ${agent.first} · ${whenText(at, ctz)}`, ...m })); }
    if (u.email) { const m = layout({ title: `New booking: ${name}`, paras: [`<b>${name}</b> booked a call for <b>${whenText(at, tz)}</b>.`, `Phone: ${fmtPhone(phone)}${email ? `<br>Email: ${email}` : ""}${state ? `<br>State: ${state}` : ""}${product ? `<br>Interested in: ${PRODUCTS[product]}` : ""}`, ...(notes ? [`Notes: ${notes.replace(/[<>&]/g, "")}`] : [])], button: { label: "Open the desk", url: siteUrl() + "/#calendar" } }); jobs.push(sendEmail({ to: u.email, subject: `New booking: ${name}, ${whenText(at, tz)}`, ...m })); }
    await Promise.all(jobs);
  }
  return json({ ok: true, at, length: s.length, agent: agent.name, manage, emailed: !!(email && emailOn()) });
}

async function manageRoute(req, token) {
  const bk = /^[A-Za-z0-9_-]{16,40}$/.test(token || "") ? await kv().get("bk:" + token, { type: "json" }).catch(() => null) : null;
  if (!bk) return json({ error: "That booking wasn't found." }, 404);
  const row = await D1().prepare("SELECT data FROM docs WHERE scope=?1 AND col='appts' AND id=?2").bind(bk.uid, bk.apptId).first();
  const a = row ? JSON.parse(row.data) : null, s = await settingsOf(bk.uid), { u, company, agent } = await publicInfo(bk.uid, s);
  const canceled = !a || a.canceled || a.booked?.token !== token;
  if (req.method === "GET") return json({ agent, company, at: bk.at, length: a?.dur || s.length, canceled, past: bk.at < Date.now(), slug: bk.slug });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (canceled) return json({ ok: true, canceled: true });
  if (bk.at < Date.now()) return json({ error: "This call already happened." }, 400);
  const now = Date.now();
  a.canceled = true; a.done = true; a.title = `${bk.name} (canceled by client)`;
  await D1().prepare("UPDATE docs SET data=?3, updated=?4 WHERE scope=?1 AND col='appts' AND id=?2").bind(bk.uid, bk.apptId, JSON.stringify(a), now).run();
  const lr = await D1().prepare("SELECT data FROM docs WHERE scope=?1 AND col='leads' AND id=?2").bind(bk.uid, bk.leadId).first();
  if (lr) { const l = JSON.parse(lr.data); l.notes = [...(l.notes || []), { t: now, text: `Canceled their booked call for ${whenText(bk.at, s.tz)}` }]; if (l.stage === "appointment") l.stage = "contacted"; l.updatedAt = now; await D1().prepare("UPDATE docs SET data=?3, updated=?4 WHERE scope=?1 AND col='leads' AND id=?2").bind(bk.uid, bk.leadId, JSON.stringify(l), now).run(); await bump(bk.uid, "leads"); }
  await bump(bk.uid, "appts");
  await kv().delete(`slot:${bk.uid}:${bk.at}`).catch(() => {});
  if (emailOn() && u?.email) { const m = layout({ title: `Canceled: ${bk.name}`, paras: [`<b>${bk.name}</b> canceled their call for <b>${whenText(bk.at, s.tz)}</b>. The time is open again on your booking page.`], button: { label: "Open the desk", url: siteUrl() + "/#calendar" } }); await sendEmail({ to: u.email, subject: `Canceled: ${bk.name}, ${whenText(bk.at, s.tz)}`, ...m }); }
  return json({ ok: true, canceled: true, slug: bk.slug });
}

/* ---------- routes ---------- */
export async function calRoute(req, file) { await ensureSchema(); return feedRoute(req, file); }
export async function bookingRoute(req, parts) {
  const [action, arg] = parts;
  if (action === "p") return bookRoute(req, String(arg || "").toLowerCase());
  if (action === "m") return manageRoute(req, arg);
  const user = await requireFeature(req, "crm");
  const b = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  if (action === "settings") {
    let s = await settingsOf(user.id);
    if (req.method === "POST") {
      if (b.op === "feed") { if (s.feedToken) await kv().delete("feed:" + s.feedToken); s.feedToken = rand(24); await kv().set("feed:" + s.feedToken, user.id); }
      else {
        if (b.slug !== undefined || !s.slug) { const want = slugify(b.slug || s.slug || user.name); if (want !== s.slug) { const got = await claimSlug(user.id, want); if (s.slug && s.slug !== got) await kv().delete("slug:" + s.slug); s.slug = got; } }
        if (b.on !== undefined) s.on = !!b.on;
        if (b.title !== undefined) s.title = String(b.title || "").trim().slice(0, 90);
        if (b.intro !== undefined) s.intro = String(b.intro || "").trim().slice(0, 600);
        for (const [k, lo, hi] of [["length", 10, 120], ["buffer", 0, 60], ["notice", 0, 168], ["ahead", 1, 60], ["maxPerDay", 0, 50]]) if (b[k] !== undefined) s[k] = Math.min(hi, Math.max(lo, Math.round(+b[k] || 0)));
        if (b.tz !== undefined && validTz(b.tz)) s.tz = b.tz;
        if (b.type !== undefined) s.type = ["Phone call", "Zoom"].includes(b.type) ? b.type : "Phone call";
        if (Array.isArray(b.hours) && b.hours.length === 7) s.hours = b.hours.map((w) => (Array.isArray(w) && okTime(w[0]) && okTime(w[1]) && w[0] < w[1] ? [w[0], w[1]] : null));
        if (b.busyUrl !== undefined) { const v = String(b.busyUrl || "").trim(); if (v && !/^(https|webcal):\/\/\S+$/i.test(v)) throw err(400, "Paste the calendar's secret address (it starts with https://)."); s.busyUrl = v.slice(0, 1000); await kv().delete("busy:" + user.id).catch(() => {}); }
      }
      if (!s.slug) s.slug = await claimSlug(user.id, user.name);
      await kv().setJSON("s:" + user.id, s);
    }
    if (!s.slug) { s.slug = await claimSlug(user.id, user.name); await kv().setJSON("s:" + user.id, s); }
    const { feedToken, ...pub } = s;
    const busy = s.busyUrl ? await kv().get("busy:" + user.id, { type: "json" }).catch(() => null) : null;
    return json({ settings: pub, link: bookUrl(s.slug), feed: feedToken ? feedUrl(feedToken) : null, busy: busy ? { at: busy.at, error: busy.error || "", count: (busy.blocks || []).length } : null, email: emailOn() });
  }
  if (action === "check-busy" && req.method === "POST") {
    const s = { ...(await settingsOf(user.id)), busyUrl: String(b.url || "").trim() };
    if (!/^(https|webcal):\/\/\S+$/i.test(s.busyUrl)) return json({ error: "Paste the calendar's secret address (it starts with https://)." }, 400);
    const from = Date.now(), to = from + 14 * 864e5, r = await calBusy(user.id, s, from, to, { fresh: true });
    if (r.error) return json({ error: r.error }, 400);
    return json({ ok: true, count: r.blocks.filter(([a, e]) => e > from && a < to).length });
  }
  if (action === "preview") { const s = await settingsOf(user.id); return json({ days: await openSlots(user.id, s) }); }
  return json({ error: "Not found" }, 404);
}
