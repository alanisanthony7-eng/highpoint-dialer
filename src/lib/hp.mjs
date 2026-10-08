// Highpoint Dialer: shared server helpers (Netlify Functions v2, Node 18+)
import { Buffer } from "node:buffer";
import { getStore } from "./store.mjs";
import { requireDialer as authUser, httpErr as authErr } from "./auth.mjs";
import crypto from "node:crypto";

export const env = (k, d = "") => (globalThis.__ENV?.[k] ?? d);
export const SID = () => env("TWILIO_ACCOUNT_SID");
export const TOKEN = () => env("TWILIO_AUTH_TOKEN");
export const siteUrl = () => (env("HP_PUBLIC_URL") || globalThis.__ORIGIN || "").replace(/\/$/, "");

/* ---------- responses ---------- */
export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
export const bad = (msg, status = 400, extra = {}) => json({ error: msg, ...extra }, status);
export const xml = (body) => new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, { headers: { "content-type": "text/xml" } });
export const x = (s) => String(s ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]));

/* ---------- storage ---------- */
export const store = (name) => getStore({ name: "hpd-" + name, consistency: "strong" });
export async function getJ(st, key, d = null) { const v = await store(st).get(key, { type: "json" }); return v ?? d; }
export async function setJ(st, key, v, opts) { return store(st).setJSON(key, v, opts); }
// read-modify-write with optimistic concurrency
export async function updateJ(st, key, fn, d = {}) {
  const s = store(st);
  for (let i = 0; i < 6; i++) {
    const cur = await s.getWithMetadata(key, { type: "json" });
    const next = fn(cur ? structuredClone(cur.data) : structuredClone(d));
    if (next === undefined) return cur?.data;
    const r = cur ? await s.setJSON(key, next, { onlyIfMatch: cur.etag }) : await s.setJSON(key, next, { onlyIfNew: true });
    if (r?.modified !== false) return next;
    await new Promise((res) => setTimeout(res, 40 + Math.random() * 120));
  }
  throw new Error("Busy, try again");
}
export async function listKeys(st, prefix) {
  const out = []; const s = store(st);
  for await (const page of s.list({ prefix, paginate: true })) for (const b of page.blobs) out.push(b.key);
  return out;
}

/* ---------- auth (Highpoint accounts) ---------- */
export async function requireUser(req) {
  const user = await authUser(req);
  setJ("agents", user.identity, { id: user.id, email: user.email, name: user.name, identity: user.identity, seen: Date.now() }).catch(() => {});
  return user;
}
export function httpErr(status, msg) { const e = new Error(msg); e.status = status; return e; }
export const wrap = (fn) => async (req, ctx) => {
  try { return await fn(req, ctx); }
  catch (e) { console.error(e); return bad(e.message || "Server error", e.status || 500); }
};

/* ---------- Twilio REST (no SDK) ---------- */
export async function tw(path, { method = "GET", form, base = "https://api.twilio.com/2010-04-01", query } = {}) {
  if (!SID() || !TOKEN()) throw httpErr(503, "Twilio isn't connected yet. Add TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in Cloudflare Pages → Settings → Variables and secrets.");
  let url = base + path.replace("{SID}", SID());
  if (query) url += "?" + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== "")).toString();
  const body = form ? new URLSearchParams() : undefined;
  if (form) for (const [k, v] of Object.entries(form)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) v.forEach((i) => body.append(k, i)); else body.append(k, String(v));
  }
  const r = await fetch(url, {
    method, body,
    headers: { authorization: "Basic " + Buffer.from(SID() + ":" + TOKEN()).toString("base64"), ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
  });
  if (r.status === 204) return {};
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw httpErr(r.status >= 500 ? 502 : 400, "Twilio: " + (j.message || r.statusText));
  return j;
}

// Verify X-Twilio-Signature so nobody can fake webhooks
export async function twilioParams(req) {
  const raw = await req.text();
  const params = Object.fromEntries(new URLSearchParams(raw));
  if (env("HP_SKIP_SIGNATURE") === "1") return params;
  const sig = req.headers.get("x-twilio-signature") || "";
  // Twilio signs the public URL it called
  const u = new URL(req.url);
  const pub = siteUrl() ? siteUrl() + u.pathname + u.search : req.url;
  const ok = [pub, req.url].some((url) => {
    const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
    const h = crypto.createHmac("sha1", TOKEN()).update(Buffer.from(data, "utf-8")).digest("base64");
    return h.length === sig.length && crypto.timingSafeEqual(Buffer.from(h), Buffer.from(sig));
  });
  if (!ok) throw httpErr(403, "Bad signature");
  return params;
}

/* ---------- Access token (JWT) for the browser phone ---------- */
const b64u = (b) => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
export function voiceToken({ identity, keySid, keySecret, appSid, ttl = 3600 }) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT", cty: "twilio-fpa;v=1" };
  const payload = {
    jti: `${keySid}-${now}`, iss: keySid, sub: SID(), iat: now, nbf: now, exp: now + ttl,
    grants: { identity, voice: { incoming: { allow: true }, outgoing: { application_sid: appSid } } },
  };
  const data = b64u(JSON.stringify(header)) + "." + b64u(JSON.stringify(payload));
  return data + "." + b64u(crypto.createHmac("sha256", keySecret).update(data).digest());
}

// short-lived signed links (for <Play> of greetings, recording playback)
export function sign(s) { return crypto.createHmac("sha256", TOKEN() || "dev").update(s).digest("hex").slice(0, 32); }
export function signedUrl(path, params, ttlSec = 3600) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const q = new URLSearchParams({ ...params, exp: String(exp) });
  q.set("sig", sign(path + "?" + q.toString()));
  return siteUrl() + path + "?" + q.toString();
}
export function checkSigned(req) {
  const u = new URL(req.url); const sig = u.searchParams.get("sig"); u.searchParams.delete("sig");
  if (!sig || sig !== sign(u.pathname + "?" + u.searchParams.toString())) return false;
  return +u.searchParams.get("exp") > Date.now() / 1000;
}

/* ---------- config ---------- */
export const DEFAULT_SETTINGS = {
  company: "Highpoint Financial",
  callbackNumber: "",          // number read in the abandoned-call message
  maxLines: 3,                 // multi-line cap (agents choose 1..maxLines)
  abandonCap: 3,               // % ; lines auto-drop to 1 when an agent's 30-day abandon rate passes this
  dailyCapPerNumber: 75,       // outbound dials per number per day
  rampDays: 14,                // new numbers ramp up over this many days
  record: true,
  recordNotice: false,         // play "this call may be recorded" to the lead before connecting
  transcribe: true,
  localPresence: true,
  sharedPool: true,            // agents may borrow team numbers for local presence
  agentMaxNumbers: 5,          // numbers an agent may buy themselves (0 = admins only)
  maxAttempts24h: 3,           // per lead, all states (some states require this)
  quietHours: null,            // override {start:8,end:21}
  amdAutoSkip: true,           // multi-line: hang up machines automatically and keep dialing
  inboundGreeting: "You've reached Highpoint Financial. Please leave your name and number and we'll call you right back.",
  abandonMessage: "",          // custom text for the second-answer message
  stateRules: {
    FL: { start: 8, end: 20, max24h: 3 },
    OK: { start: 8, end: 20, max24h: 3 },
    MD: { start: 8, end: 20, max24h: 3 },
    TX: { start: 9, end: 21, sunStart: 12 },
    LA: { start: 8, end: 20, noSunday: true },
    AL: { start: 8, end: 20, noSunday: true },
    MS: { start: 8, end: 20, noSunday: true },
  },
};
export async function config() {
  const c = (await getJ("config", "app")) || {};
  return { ...c, settings: { ...DEFAULT_SETTINGS, ...(c.settings || {}), stateRules: { ...DEFAULT_SETTINGS.stateRules, ...(c.settings?.stateRules || {}) } } };
}

/* ---------- phone helpers ---------- */
export const digits = (s) => String(s || "").replace(/\D/g, "");
export const to10 = (s) => { let d = digits(s); if (d.length === 11 && d[0] === "1") d = d.slice(1); return d.length === 10 ? d : ""; };
export const e164 = (s) => { const d = to10(s); return d ? "+1" + d : ""; };
export const today = (tz = "America/New_York", t = Date.now()) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(t);

// US area code -> state, and timezone(s) for codes that span zones
const AC = {
  AL: "205 251 256 334 659 938", AK: "907", AZ: "480 520 602 623 928", AR: "327 479 501 870",
  CA: "209 213 279 310 323 341 350 369 408 415 424 442 510 530 559 562 619 626 628 650 657 661 669 707 714 747 760 805 818 820 831 840 858 909 916 925 949 951",
  CO: "303 719 720 970 983", CT: "203 475 860 959", DE: "302", DC: "202 771",
  FL: "239 305 321 324 352 386 407 448 561 645 656 689 727 728 754 772 786 813 850 863 904 941 954",
  GA: "229 404 470 478 678 706 762 770 912 943", HI: "808", ID: "208 986",
  IL: "217 224 309 312 331 447 464 618 630 708 730 773 779 815 847 861 872", IN: "219 260 317 463 574 765 812 930",
  IA: "319 515 563 641 712", KS: "316 620 785 913", KY: "270 364 502 606 859", LA: "225 318 337 504 985", ME: "207",
  MD: "227 240 301 410 443 667", MA: "339 351 413 508 617 774 781 857 978", MI: "231 248 269 313 517 586 616 679 734 810 906 947 989",
  MN: "218 320 507 612 651 763 952", MS: "228 601 662 769", MO: "314 417 557 573 636 660 816 975", MT: "406", NE: "308 402 531",
  NV: "702 725 775", NH: "603", NJ: "201 551 609 640 732 848 856 862 908 973", NM: "505 575",
  NY: "212 315 329 332 347 363 516 518 585 607 624 631 646 680 716 718 838 845 914 917 929 934",
  NC: "252 336 472 704 743 828 910 919 980 984", ND: "701", OH: "216 220 234 283 326 330 380 419 436 440 513 567 614 740 937",
  OK: "405 539 572 580 918", OR: "458 503 541 971", PA: "215 223 267 272 412 445 484 570 582 610 717 724 814 835 878",
  RI: "401", SC: "803 821 839 843 854 864", SD: "605", TN: "423 615 629 731 865 901 931",
  TX: "210 214 254 281 325 346 361 409 430 432 469 512 682 713 726 737 806 817 830 832 903 915 936 940 945 956 972 979",
  UT: "385 435 801", VT: "802", VA: "276 434 540 571 686 703 757 804 826 948", WA: "206 253 360 425 509 564",
  WV: "304 681", WI: "262 274 353 414 534 608 715 920", WY: "307", PR: "787 939",
};
const ET = "America/New_York", CT = "America/Chicago", MT = "America/Denver", PT = "America/Los_Angeles";
const STATE_TZ = { AL: CT, AK: "America/Anchorage", AZ: "America/Phoenix", AR: CT, CA: PT, CO: MT, CT: ET, DE: ET, DC: ET, FL: ET, GA: ET, HI: "Pacific/Honolulu", ID: MT, IL: CT, IN: ET, IA: CT, KS: CT, KY: ET, LA: CT, ME: ET, MD: ET, MA: ET, MI: ET, MN: CT, MS: CT, MO: CT, MT: MT, NE: CT, NV: PT, NH: ET, NJ: ET, NM: MT, NY: ET, NC: ET, ND: CT, OH: ET, OK: CT, OR: PT, PA: ET, RI: ET, SC: ET, SD: CT, TN: CT, TX: CT, UT: MT, VT: ET, VA: ET, WA: PT, WV: ET, WI: CT, WY: MT, PR: "America/Puerto_Rico" };
const SPLIT = { 850: [ET, CT], 448: [ET, CT], 219: [CT], 812: [ET, CT], 930: [ET, CT], 270: [CT], 364: [CT], 906: [ET, CT], 423: [ET], 865: [ET], 931: [CT, ET], 915: [MT], 432: [CT, MT], 620: [CT, MT], 785: [CT, MT], 308: [CT, MT], 701: [CT, MT], 605: [CT, MT], 208: [MT, PT], 986: [MT, PT], 541: [PT, MT] };
export const AREA = {};
for (const [st, codes] of Object.entries(AC)) for (const c of codes.split(" ")) AREA[c] = st;
export const stateOf = (num) => AREA[to10(num).slice(0, 3)] || "";
export const zonesOf = (num, leadState) => {
  const ac = to10(num).slice(0, 3);
  if (SPLIT[ac]) return SPLIT[ac];
  const st = AREA[ac] || leadState;
  return st && STATE_TZ[st] ? [STATE_TZ[st]] : [ET, PT]; // unknown: must be OK on both coasts
};
// neighbouring states for local-presence fallback
export const NEAR = { FL: ["GA", "AL"], GA: ["FL", "SC", "AL", "TN", "NC"], AL: ["MS", "GA", "FL", "TN"], TX: ["OK", "LA", "NM", "AR"], CA: ["NV", "AZ", "OR"], NY: ["NJ", "CT", "PA"], NJ: ["NY", "PA", "DE"], PA: ["NJ", "NY", "OH", "MD"], IL: ["IN", "WI", "MO"], OH: ["PA", "IN", "MI", "KY"], NC: ["SC", "VA", "TN", "GA"], SC: ["NC", "GA"], TN: ["KY", "GA", "AL", "MS", "NC"], LA: ["TX", "MS", "AR"], MS: ["LA", "AL", "TN"] };

// Is it legal/polite to call this number right now?
export function callWindow(num, settings, leadState) {
  const st = stateOf(num) || leadState || "";
  const rule = { start: 8, end: 21, ...(settings.quietHours || {}), ...(settings.stateRules?.[st] || {}) };
  for (const tz of zonesOf(num, leadState)) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "numeric", weekday: "short", hourCycle: "h23" }).formatToParts(new Date()).map((p) => [p.type, p.value]));
    const h = +parts.hour + +parts.minute / 60, sun = parts.weekday === "Sun";
    if (sun && rule.noSunday) return { ok: false, why: `${st} doesn't allow these calls on Sunday`, st, rule };
    const start = sun && rule.sunStart ? rule.sunStart : rule.start;
    if (h < start || h >= rule.end) {
      const fmt = (v) => `${((v + 11) % 12) + 1}${v < 12 ? "am" : "pm"}`;
      return { ok: false, why: `It's ${parts.hour}:${parts.minute.padStart(2, "0")} there. ${st || "This area"} allows ${fmt(start)}–${fmt(rule.end)} local time.`, st, rule };
    }
  }
  return { ok: true, st, rule };
}

/* ---------- caller-ID picker (local presence + rotation caps + ramp) ---------- */
export function numberCap(n, settings) {
  const age = (Date.now() - (n.boughtAt || 0)) / 864e5;
  const cap = settings.dailyCapPerNumber;
  if (n.paused) return 0;
  if (age >= settings.rampDays) return cap;
  return Math.max(15, Math.round(cap * Math.min(1, (age + 1) / settings.rampDays)));
}
export async function pickCallerId(user, leadNum, settings, prefer) {
  const all = (await getJ("numbers", "all")) || {};
  const day = today();
  const mine = Object.values(all).filter((n) => n.owner === user.identity && !n.released);
  const team = settings.sharedPool ? Object.values(all).filter((n) => !n.released && (n.shared || !n.owner)) : [];
  const usable = (n) => ((n.days?.[day]?.dials) || 0) < numberCap(n, settings);
  if (prefer) { const p = all[prefer]; if (p && !p.released && (p.owner === user.identity || p.shared || !p.owner || user.admin) && usable(p)) return p; }
  const ac = to10(leadNum).slice(0, 3), st = stateOf(leadNum);
  const byLoad = (a, b) => ((a.days?.[day]?.dials) || 0) / numberCap(a, settings) - ((b.days?.[day]?.dials) || 0) / numberCap(b, settings);
  const tiers = settings.localPresence ? [
    (n) => n.areaCode === ac, (n) => n.state === st, (n) => (NEAR[st] || []).includes(n.state), () => true,
  ] : [() => true];
  for (const pool of [mine, team]) for (const t of tiers) {
    const c = pool.filter((n) => t(n) && usable(n) && n.health !== "flagged").sort(byLoad);
    if (c.length) return c[0];
  }
  // last resort: flagged numbers are still better than nothing, but warn
  const any = [...mine, ...team].filter(usable).sort(byLoad)[0];
  return any || null;
}
export async function bumpNumber(e, field, by = 1) {
  const day = today();
  return updateJ("numbers", "all", (all) => {
    if (!all[e]) return undefined;
    all[e].days = all[e].days || {};
    const d = (all[e].days[day] = all[e].days[day] || {});
    d[field] = (d[field] || 0) + by;
    // keep 30 days
    const keys = Object.keys(all[e].days).sort(); while (keys.length > 30) delete all[e].days[keys.shift()];
    return all;
  });
}

/* ---------- per-lead attempt tracking + DNC ---------- */
export async function attempts24h(num) {
  const a = (await getJ("attempts", to10(num))) || [];
  return a.filter((t) => t > Date.now() - 864e5).length;
}
export async function addAttempt(num) {
  return updateJ("attempts", to10(num), (a) => [...(Array.isArray(a) ? a : []).filter((t) => t > Date.now() - 7 * 864e5), Date.now()], []);
}
export async function isDnc(num) { return !!(await getJ("dnc", to10(num))); }

// all pre-call checks in one place
export async function preflight(user, leadNum, settings, leadState, { override } = {}) {
  const n = to10(leadNum);
  if (!n) return { ok: false, why: "That isn't a valid US phone number." };
  if (await isDnc(n)) return { ok: false, why: "This number is on your Do Not Call list.", hard: true };
  const w = callWindow(n, settings, leadState);
  if (!w.ok && !(override && user.admin)) return { ok: false, why: w.why };
  const max = Math.min(settings.maxAttempts24h || 99, w.rule?.max24h || 99);
  const tries = await attempts24h(n);
  if (tries >= max && !(override && user.admin)) return { ok: false, why: `Already called ${tries}× in the last 24 hours (limit ${max}${w.rule?.max24h ? " in " + w.st : ""}).` };
  return { ok: true, tries };
}

/* ---------- call log + analytics aggregates ---------- */
export async function saveCall(rec) {
  await setJ("calls", `${rec.agent}/${rec.id}`, rec);
  if (rec.sid) await setJ("callidx", rec.sid, { agent: rec.agent, id: rec.id });
}
export async function patchCallBySid(sid, fn) {
  const ix = await getJ("callidx", sid); if (!ix) return null;
  return updateJ("calls", `${ix.agent}/${ix.id}`, (c) => (c && c.id ? fn(c) : undefined), null);
}
export async function aggregate(rec, kind) {
  // kind: "dial" when placed, "end" when completed (adds outcome metrics), "dispo" when an agent logs a result
  const tz = "America/New_York", day = today(tz, rec.at || Date.now());
  const hour = +new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(rec.at || Date.now());
  const add = (o, k, v = 1) => (o[k] = (o[k] || 0) + v);
  const apply = (a) => {
    a.hours = a.hours || {}; const h = (a.hours[hour] = a.hours[hour] || {});
    if (kind === "dial") { add(a, "dials"); add(h, "dials"); }
    if (kind === "end") {
      if (rec.answered) { add(a, "answered"); add(h, "answered"); }
      if (rec.human) { add(a, "connects"); add(h, "connects"); }
      if (rec.machine) add(a, "machines");
      if (rec.abandoned) add(a, "abandoned");
      if (rec.answered && rec.talkSec < 10) add(a, "short");
      add(a, "talkSec", rec.talkSec || 0);
    }
    if (kind === "dispo") { a.dispo = a.dispo || {}; add(a.dispo, rec.disposition || "Other"); if (/Appointment/i.test(rec.disposition)) add(a, "appts"); }
    return a;
  };
  await updateJ("stats", `${day}/a/${rec.agent}`, apply, {});
  if (rec.from && kind !== "dispo") await updateJ("stats", `${day}/n/${rec.from}`, apply, {});
  if (kind === "end" && rec.from) {
    if (rec.answered) await bumpNumber(rec.from, "answered");
    if (rec.answered && rec.talkSec < 10) await bumpNumber(rec.from, "short");
  }
}

export const numberHooks = (base) => ({
  VoiceUrl: base + "/api/dialer/voice?in=1", VoiceMethod: "POST",
  StatusCallback: base + "/api/dialer/events?type=inbound", StatusCallbackMethod: "POST",
  SmsUrl: base + "/api/dialer/sms/in", SmsMethod: "POST",
});
export const later = (ctx, p) => (ctx?.waitUntil ? ctx.waitUntil(p.catch((e) => console.error(e))) : p.catch((e) => console.error(e)));
