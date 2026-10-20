// Lead posting URLs. Each agent can make secret URLs to give a lead vendor (or point their own website form at),
// and leads posted there land in their CRM in real time: fields are mapped automatically, duplicates (same phone)
// are caught, numbers are checked against the DNC and litigator lists, and an optional "new lead" text goes out.
// Admins can also make team URLs that hand leads out round robin between agents.
//
//   POST|GET /api/leads/in/<token>        public: JSON (one lead, an array, or { leads: [...] }), form posts, XML or query string
//   GET  /api/leads/urls                   your URLs, recent arrivals (and the team's agents, for admins)
//   POST /api/leads/urls  { op: create|update|rotate|delete, ... }
//   POST /api/leads/test  { id }           sends a sample lead through your URL
import { getStore, D1, ensureSchema } from "./store.mjs";
import { to10, isDnc, siteUrl, config as loadConfig } from "./hp.mjs";
import { requireFeature, userById } from "./auth.mjs";
import { scrubOn, scrub, blockWhy } from "./scrub.mjs";

const kv = () => getStore("hpd-leadpost");
const MAX_URLS = 20, PER_HOUR = 600, MAX_BATCH = 100, MAX_BODY = 250_000;
const STAGES = ["new", "contacted", "appointment", "application"];
const PRODUCTS = ["FE", "MP", "IUL"];
const json = (b, s = 200, h = {}) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store", ...h } });
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type" };
const err = (status, msg) => Object.assign(new Error(msg), { status });
const rand = (n) => { const b = crypto.getRandomValues(new Uint8Array(n)); return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const postUrl = (token) => `${siteUrl()}/api/leads/in/${token}`;

/* ---------- reading what the vendor sent ---------- */
const norm = (k) => String(k || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const FIELD_KEYS = {
  first: "first firstname fname givenname forename",
  last: "last lastname lname surname familyname",
  full: "name fullname contactname leadname",
  phone: "phone phonenumber phone1 primaryphone cell cellphone cellnumber mobile mobilephone mobilenumber telephone tel dayphone daytimephone bestphone contactphone wirelessphone",
  phone2: "phone2 altphone alternatephone alternativephone secondaryphone homephone workphone eveningphone otherphone",
  email: "email emailaddress mail",
  address: "address address1 addressline1 streetaddress street",
  city: "city town",
  state: "state st stateabbr stateabbreviation statecode province",
  zip: "zip zipcode postalcode postal zip5",
  age: "age",
  dob: "dob dateofbirth birthdate birthday",
  mortgageBalance: "mortgagebalance mortgageamount loanamount loanbalance mortgage",
  mortgagePayment: "mortgagepayment monthlypayment payment",
  lender: "lender mortgagelender lendername bank",
  product: "product producttype leadtype vertical insurancetype coveragetype campaign",
  notes: "notes note comments comment message details",
  trustedForm: "trustedform trustedformurl trustedformcert trustedformcerturl xxtrustedformcerturl xxtrustedformtoken",
  jornaya: "jornaya jornayaleadid leadid leadidtoken universalleadid",
  consentText: "tcpa tcpaconsent tcpatext tcpalanguage consent consenttext consentlanguage optin optinlanguage",
  ip: "ip ipaddress clientip userip",
  consentAt: "optintime optindate optintimestamp consenttime consentdate consenttimestamp",
};
const KEYMAP = new Map(Object.entries(FIELD_KEYS).flatMap(([f, keys]) => keys.split(" ").map((k) => [k, f])));
const IGNORE = new Set(["key", "token", "apikey", "password", "secret", "redirect", "redirecturl", "returnurl", "thankyouurl"]);
const PREFIX = /^(contact|applicant|lead|customer|client|primary|insured|borrower|consumer|person|prospect|home|mailing)/;
function fieldFor(key) {
  const k = norm(key); if (!k) return null;
  if (IGNORE.has(k)) return "_ignore";
  if (KEYMAP.has(k)) return KEYMAP.get(k);
  const s = k.replace(PREFIX, ""); // contact_first_name, applicant_phone, home_address ...
  return s !== k && s.length > 1 && KEYMAP.has(s) ? KEYMAP.get(s) : null;
}
// nested objects become flat [name, value] pairs (the last part of the path is the name)
function flatten(o, out = [], path = "") {
  for (const [k, v] of Object.entries(o || {})) {
    if (v == null || v === "") continue;
    if (Array.isArray(v)) { if (v.every((x) => typeof x !== "object")) out.push([k, v.join(", "), path + k]); continue; }
    if (typeof v === "object") { flatten(v, out, path + k + "."); continue; }
    out.push([k, String(v), path + k]);
  }
  return out;
}
// the leaf elements of an XML post, e.g. <lead><first_name>Ann</first_name>...</lead>
function fromXml(s) {
  const out = {}, dec = (t) => t.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&").trim();
  for (const m of String(s).matchAll(/<([A-Za-z_][\w.-]*)(?:\s[^>]*)?>([^<]*(?:<!\[CDATA\[[\s\S]*?\]\]>[^<]*)?)<\/\1>/g)) if (!(m[1] in out) && dec(m[2])) out[m[1]] = dec(m[2]);
  return out;
}
async function readItems(req) {
  const u = new URL(req.url), q = {};
  for (const [k, v] of u.searchParams) if (!IGNORE.has(norm(k))) q[k] = v;
  if (req.method === "GET") return { items: Object.keys(q).length ? [q] : [], extra: {} };
  const ct = (req.headers.get("content-type") || "").toLowerCase();
  let data;
  if (ct.includes("multipart/form-data")) { const fd = await req.formData(); data = {}; for (const [k, v] of fd) if (typeof v === "string") data[k] = v; }
  else {
    const raw = await req.text();
    if (raw.length > MAX_BODY) throw err(413, "That post is too big. Send at most 100 leads at a time.");
    const t = raw.trim();
    if (!t) data = {};
    else if (ct.includes("json") || /^[[{]/.test(t)) { try { data = JSON.parse(t); } catch { throw err(400, "That JSON couldn't be read. Check for a missing quote or comma."); } }
    else if (ct.includes("xml") || t.startsWith("<")) data = fromXml(t);
    else data = Object.fromEntries(new URLSearchParams(t));
  }
  const redirect = typeof data === "object" && !Array.isArray(data) ? (data._redirect || data.redirect || data.redirect_url || data.thank_you_url || q._redirect || q.redirect || "") : "";
  // one lead, an array of leads, or { leads: [...] } (other top-level values apply to every lead)
  let list = Array.isArray(data) ? data : null, shared = {};
  if (!list && data && typeof data === "object") {
    const arrKey = Object.keys(data).find((k) => /^(leads|records|contacts|data|items)$/i.test(k) && Array.isArray(data[k]) && data[k].some((x) => x && typeof x === "object"));
    if (arrKey) { list = data[arrKey]; shared = Object.fromEntries(Object.entries(data).filter(([k, v]) => k !== arrKey && typeof v !== "object")); }
    else list = [data];
  }
  list = (list || []).filter((x) => x && typeof x === "object").map((x) => ({ ...q, ...shared, ...x }));
  return { items: list, extra: { redirect: /^https?:\/\//i.test(redirect) ? String(redirect) : "" } };
}

const STATE_NAMES = { alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "puerto rico": "PR" };
const titleCase = (s) => (s === s.toUpperCase() || s === s.toLowerCase() ? s.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (m, a, b) => a + b.toUpperCase()) : s);
const prodFrom = (s) => { s = String(s || "").toLowerCase(); if (/\bfe\b|final|burial|funeral|senior life/.test(s)) return "FE"; if (/mort|\bmp\b/.test(s)) return "MP"; if (/iul|index|universal/.test(s)) return "IUL"; return ""; };
function ageFromDob(s) {
  const t = String(s || "").trim(); let d = new Date(t);
  const m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/); if (m) d = new Date(+(m[3].length === 2 ? (+m[3] > 30 ? "19" : "20") + m[3] : m[3]), +m[1] - 1, +m[2]);
  if (isNaN(d)) return "";
  const n = new Date(); let a = n.getFullYear() - d.getFullYear(); if (n < new Date(n.getFullYear(), d.getMonth(), d.getDate())) a--;
  return a > 0 && a < 120 ? a : "";
}
// a posted record -> a CRM lead (or { error })
export function toLead(raw) {
  const o = {}, at = {}, fields = {}, consent = {};
  for (const [k, v, path] of flatten(raw)) {
    const val = String(v).trim().slice(0, 600); if (!val) continue;
    const f = fieldFor(k);
    if (f === "_ignore") continue;
    if (!f) { if (Object.keys(fields).length < 60) fields[path.slice(0, 60)] = val; continue; }
    if (["trustedForm", "jornaya", "consentText", "ip", "consentAt"].includes(f)) { if (!consent[f]) consent[f] = val.slice(0, f === "consentText" ? 2000 : 300); continue; }
    if (o[f] == null || o[f] === "") { o[f] = val; at[f] = path.slice(0, 60); } else if (Object.keys(fields).length < 60) fields[path.slice(0, 60)] = val;
  }
  if (o.full) { const p = o.full.split(/\s+/); if (!o.first) o.first = p.shift(); if (!o.last) o.last = p.join(" "); delete o.full; }
  const lead = {};
  for (const k of ["first", "last", "email", "address", "city", "zip", "dob", "lender"]) if (o[k]) lead[k] = o[k];
  if (lead.first) lead.first = titleCase(lead.first); if (lead.last) lead.last = titleCase(lead.last);
  if (lead.email) lead.email = lead.email.toLowerCase();
  if (o.phone) { const p = to10(o.phone); if (p) lead.phone = p; else fields[at.phone] = o.phone; }
  if (o.phone2) { const p = to10(o.phone2); if (p && p !== lead.phone) lead.phone2 = p; }
  if (!lead.phone && lead.phone2) { lead.phone = lead.phone2; delete lead.phone2; }
  if (o.state) { const s = o.state.trim(); lead.state = s.length <= 3 ? s.toUpperCase() : STATE_NAMES[s.toLowerCase()] || s; }
  if (o.age) { const a = parseInt(o.age); if (a > 0 && a < 120) lead.age = a; }
  if (!lead.age && lead.dob) { const a = ageFromDob(lead.dob); if (a) lead.age = a; }
  for (const k of ["mortgageBalance", "mortgagePayment"]) if (o[k]) { const n = Number(String(o[k]).replace(/[^\d.]/g, "")); if (n) lead[k] = n; }
  if (o.product) { const p = prodFrom(o.product); if (p) lead.product = p; else fields[at.product] = o.product; }
  if (o.notes) lead.noteText = o.notes.slice(0, 2000);
  if (Object.keys(fields).length) lead.fields = fields;
  if (Object.keys(consent).length) lead.consent = consent;
  if (!lead.phone && !lead.email) return { error: o.phone ? `"${o.phone}" isn't a valid US phone number.` : "Each lead needs a phone number (or at least an email)." };
  if (!lead.first && !lead.last && !lead.phone) return { error: "Each lead needs a name or a phone number." };
  return { lead };
}

/* ---------- the URLs ---------- */
const getRec = (id) => kv().get("i:" + id, { type: "json" }).catch(() => null);
const putRec = (r) => kv().setJSON("i:" + r.id, r);
async function myIds(uid) { return (await kv().get("u:" + uid, { type: "json" }).catch(() => null)) || []; }
async function recByToken(token) {
  if (!/^[A-Za-z0-9_-]{20,60}$/.test(token || "")) return null;
  const id = await kv().get("t:" + token).catch(() => null);
  const r = id ? await getRec(id) : null;
  return r && r.token === token ? r : null;
}
// read-modify-write with the store's etag (counts and round robin from posts arriving at the same time)
async function bumpRec(id, fn) {
  const st = kv();
  for (let i = 0; i < 6; i++) {
    const cur = await st.getWithMetadata("i:" + id, { type: "json" }); if (!cur) return null;
    const next = fn(structuredClone(cur.data));
    const r = await st.setJSON("i:" + id, next, { onlyIfMatch: cur.etag });
    if (r?.modified !== false) return next;
    await new Promise((res) => setTimeout(res, 20 + Math.random() * 60));
  }
  return null;
}
async function logArrival(uid, entry) {
  const key = "log:" + uid, cur = (await kv().get(key, { type: "json" }).catch(() => null)) || [];
  await kv().setJSON(key, [{ at: Date.now(), ...entry }, ...cur].slice(0, 80));
}
const shape = (r) => ({ id: r.id, name: r.name, product: r.product || "", stage: r.stage || "new", assign: r.assign || "me", agents: r.agents || [], on: r.on !== false, created: r.created, count: r.count || 0, last: r.last || null, url: postUrl(r.token) });

async function teamAgents() {
  await ensureSchema();
  const r = await D1().prepare("SELECT u.id, u.name, u.email, m.role FROM users u JOIN members m ON m.user_id = u.id WHERE m.disabled = 0 ORDER BY u.name").all().catch(() => ({ results: [] }));
  return (r.results || []).map((x) => ({ id: x.id, name: x.name || String(x.email).split("@")[0], email: x.email }));
}

/* ---------- saving a posted lead ---------- */
async function findExisting(uids, lead) {
  for (const uid of uids) {
    let r = null;
    if (lead.phone) r = await D1().prepare("SELECT id, data FROM docs WHERE scope=?1 AND col='leads' AND (json_extract(data,'$.phone')=?2 OR json_extract(data,'$.phone2')=?2) LIMIT 1").bind(uid, lead.phone).first();
    else if (lead.email) r = await D1().prepare("SELECT id, data FROM docs WHERE scope=?1 AND col='leads' AND lower(json_extract(data,'$.email'))=?2 LIMIT 1").bind(uid, lead.email).first();
    if (r) return { uid, id: r.id, data: JSON.parse(r.data) };
  }
  return null;
}
const bumpCol = (scope) => D1().prepare("INSERT INTO colver (scope, col, v) VALUES (?1, 'leads', 1) ON CONFLICT(scope, col) DO UPDATE SET v = v + 1").bind(scope).run();
const usable = (u) => u && !u.disabled && u.access?.ok !== false && (!Array.isArray(u.access?.features) || u.access.features.includes("crm"));

// who gets the next lead from this URL (round robin skips agents who can't use the CRM right now)
async function receiverFor(rec) {
  if (rec.assign !== "rr" || !(rec.agents || []).length) { const u = await userById(rec.owner); return usable(u) ? u : null; }
  const n = rec.agents.length;
  for (let i = 0; i < n; i++) {
    let pick = null;
    await bumpRec(rec.id, (r) => { const list = r.agents || []; pick = list[(r.next || 0) % list.length]; r.next = ((r.next || 0) + 1) % Math.max(1, list.length); return r; });
    const u = pick ? await userById(pick) : null;
    if (usable(u)) return u;
  }
  return null;
}

async function ingest(rec, raw, { test = false } = {}) {
  const parsed = toLead(raw);
  if (parsed.error) { await logArrival(rec.owner, { url: rec.name, urlId: rec.id, status: "rejected", note: parsed.error, keys: Object.keys(raw || {}).slice(0, 24) }); return { success: false, status: "rejected", error: parsed.error }; }
  const lead = parsed.lead;
  const pool = rec.assign === "rr" && rec.agents?.length ? [...new Set([...rec.agents, rec.owner])] : [rec.owner];
  const name = [lead.first, lead.last].filter(Boolean).join(" ") || "New lead";
  // already in the CRM: add a note to that client instead of making a second one
  const dup = await findExisting(pool, lead);
  if (dup) {
    const d = dup.data; d.notes = [...(d.notes || []), { t: Date.now(), text: `Posted again by ${rec.name}${lead.noteText ? `: ${lead.noteText}` : ""}` }].slice(-400); d.updatedAt = Date.now();
    await D1().prepare("UPDATE docs SET data=?3, updated=?4 WHERE scope=?1 AND col='leads' AND id=?2").bind(dup.uid, dup.id, JSON.stringify(d), Date.now()).run();
    await bumpCol(dup.uid);
    const entry = { url: rec.name, urlId: rec.id, status: "duplicate", leadId: dup.id, name, phone: lead.phone || "", note: "Already in the CRM; added a note to that client" };
    await logArrival(dup.uid, entry); if (dup.uid !== rec.owner) await logArrival(rec.owner, entry);
    return { success: false, status: "duplicate", id: dup.id, message: "This lead is already in the CRM." };
  }
  const to = await receiverFor(rec);
  if (!to) { const why = rec.assign === "rr" ? "None of the agents on this URL can take leads right now (account off or plan doesn't include the CRM)." : "This account can't take leads right now (account off or plan doesn't include the CRM)."; await logArrival(rec.owner, { url: rec.name, urlId: rec.id, status: "rejected", name, phone: lead.phone || "", note: why }); return { success: false, status: "rejected", error: why, http: 402 }; }
  const now = Date.now(), id = newId();
  const doc = { ...lead, product: lead.product || rec.product || "", stage: STAGES.includes(rec.stage) ? rec.stage : "new", source: rec.name + (test ? " (test)" : ""), callCount: 0, createdAt: now, updatedAt: now, posted: { via: rec.name, urlId: rec.id, at: now, ...(test ? { test: true } : {}) } };
  delete doc.noteText;
  doc.notes = [{ t: now, text: `Posted by ${rec.name}${rec.assign === "rr" ? ` (round robin to ${to.name})` : ""}` }, ...(lead.noteText ? [{ t: now, text: lead.noteText }] : [])];
  // Do Not Call and litigator checks before the lead can be dialed
  let flagged = "";
  if (doc.phone && !test) {
    if (await isDnc(doc.phone)) { doc.dnc = true; flagged = "dnc"; }
    const cfg = await loadConfig().catch(() => ({ settings: {} })), set = cfg.settings?.scrub || {};
    if (scrubOn() && set.on !== false) {
      const res = await scrub(doc.phone).catch(() => ({ status: "error" }));
      if (res.status !== "error") { const block = blockWhy(res, set); doc.scrub = { status: res.status, why: res.why, blocked: !!block, at: res.at || now }; if (block) flagged = res.status; }
    }
  }
  await D1().prepare("INSERT INTO docs (scope, col, id, data, updated) VALUES (?1, 'leads', ?2, ?3, ?4)").bind(to.id, id, JSON.stringify(doc), now).run();
  await bumpCol(to.id);
  await bumpRec(rec.id, (r) => { r.count = (r.count || 0) + 1; r.last = now; return r; });
  const entry = { url: rec.name, urlId: rec.id, status: "added", leadId: id, name, phone: doc.phone || "", to: to.id !== rec.owner ? to.name : undefined, flagged: flagged || undefined, test: test || undefined };
  await logArrival(to.id, entry); if (to.id !== rec.owner) await logArrival(rec.owner, entry);
  // a "new lead" text, if the agent turned it on
  let texting = false;
  if (!test && !flagged && doc.phone) { try { const fu = await import("./followups.mjs"); texting = await fu.onLeadPosted(to, id, doc); } catch (e) { console.error("new lead text", e); } }
  return { success: true, status: "added", id, ...(flagged ? { flagged } : {}), ...(texting ? { texting: true } : {}) };
}

/* ---------- routes ---------- */
export async function leadsRoute(req, parts, ctx) {
  const [action, token] = parts;
  if (action === "in") return postRoute(req, token, ctx);
  const user = await requireFeature(req, "crm");
  const b = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  if (action === "urls" && req.method === "GET") {
    const ids = await myIds(user.id), recs = (await Promise.all(ids.map(getRec))).filter(Boolean);
    return json({ urls: recs.map(shape), log: (await kv().get("log:" + user.id, { type: "json" }).catch(() => null)) || [], admin: !!user.admin, agents: user.admin ? await teamAgents() : [], scrub: scrubOn() });
  }
  if (action === "urls" && req.method === "POST") {
    const op = b.op;
    const clean = (r) => {
      if (b.name !== undefined) r.name = String(b.name || "").trim().slice(0, 60) || r.name || "Lead vendor";
      if (b.product !== undefined) r.product = PRODUCTS.includes(b.product) ? b.product : "";
      if (b.stage !== undefined) r.stage = STAGES.includes(b.stage) ? b.stage : "new";
      if (b.on !== undefined) r.on = !!b.on;
      if (b.assign !== undefined || b.agents !== undefined) {
        if (b.assign === "rr" && !user.admin) throw err(403, "Only an admin can hand leads out round robin.");
        r.assign = b.assign === "rr" ? "rr" : "me";
        r.agents = r.assign === "rr" ? [...new Set((Array.isArray(b.agents) ? b.agents : r.agents || []).map(String))].slice(0, 100) : [];
        if (r.assign === "rr" && !r.agents.length) throw err(400, "Pick at least one agent for the round robin.");
      }
      return r;
    };
    if (op === "create") {
      const ids = await myIds(user.id); if (ids.length >= MAX_URLS) return json({ error: `You can have up to ${MAX_URLS} posting URLs. Delete one you don't use.` }, 400);
      const rec = clean({ id: newId(), token: rand(24), owner: user.id, ownerName: user.name, name: "Lead vendor", product: "", stage: "new", assign: "me", agents: [], on: true, created: Date.now(), count: 0, next: 0 });
      await putRec(rec); await kv().set("t:" + rec.token, rec.id); await kv().setJSON("u:" + user.id, [...ids, rec.id]);
      return json({ url: shape(rec) });
    }
    const rec = await getRec(String(b.id || ""));
    if (!rec || rec.owner !== user.id) return json({ error: "That posting URL wasn't found." }, 404);
    if (op === "update") { const next = await bumpRec(rec.id, (r) => clean(r)); return json({ url: shape(next || rec) }); }
    if (op === "rotate") { // a new secret; the old URL stops working right away
      const token = rand(24); await kv().delete("t:" + rec.token); await kv().set("t:" + token, rec.id);
      const next = await bumpRec(rec.id, (r) => { r.token = token; return r; });
      return json({ url: shape(next) });
    }
    if (op === "delete") {
      await kv().delete("t:" + rec.token); await kv().delete("i:" + rec.id);
      await kv().setJSON("u:" + user.id, (await myIds(user.id)).filter((x) => x !== rec.id));
      return json({ ok: true });
    }
    return json({ error: "Unknown change" }, 400);
  }
  if (action === "test" && req.method === "POST") {
    const rec = await getRec(String(b.id || ""));
    if (!rec || rec.owner !== user.id) return json({ error: "That posting URL wasn't found." }, 404);
    const sample = { first_name: "Test", last_name: "Lead", phone: `(555) 555-01${String(Math.floor(Math.random() * 100)).padStart(2, "0")}`, email: "test.lead@example.com", state: "Florida", zip: "33101", dob: "1958-04-12", comments: "A sample lead from the Send a test lead button." };
    return json({ result: await ingest(rec, sample, { test: true }) });
  }
  return json({ error: "Not found" }, 404);
}

async function postRoute(req, token, ctx) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const out = (b, s = 200) => json(b, s, CORS);
  const rec = await recByToken(token);
  if (!rec) return out({ success: false, error: "This lead posting URL isn't valid. Ask the agent for their current URL." }, 404);
  if (rec.on === false) return out({ success: false, error: "This lead posting URL is paused." }, 403);
  let items, extra;
  try { ({ items, extra } = await readItems(req)); } catch (e) { return out({ success: false, error: e.message }, e.status || 400); }
  if (!items.length) return out({ success: req.method === "GET", status: "ready", message: `This lead posting URL is working. POST leads here as JSON, a form post or XML. Leads go to ${rec.assign === "rr" ? "the team round robin" : rec.ownerName || "the agent"}.` }, req.method === "GET" ? 200 : 400);
  if (items.length > MAX_BATCH) return out({ success: false, error: `Send at most ${MAX_BATCH} leads per request.` }, 413);
  // at most PER_HOUR leads an hour per URL
  const hour = new Date().toISOString().slice(0, 13); let over = false;
  await bumpRec(rec.id, (r) => { if (r.hour !== hour) { r.hour = hour; r.hourCount = 0; } if (r.hourCount + items.length > PER_HOUR) { over = true; return r; } r.hourCount += items.length; return r; });
  if (over) return out({ success: false, error: `Too many leads this hour (the limit is ${PER_HOUR} per URL). Try again later.` }, 429);
  const results = [];
  for (const it of items) { try { results.push(await ingest(await getRec(rec.id) || rec, it)); } catch (e) { console.error("lead post", e); results.push({ success: false, status: "error", error: "The lead couldn't be saved. Try again." }); } }
  // send any "new lead" texts right away instead of waiting for the next job run
  if (results.some((r) => r.texting) && ctx?.waitUntil) {
    const fu = await import("./followups.mjs");
    ctx.waitUntil((async () => { for (let i = 0; i < 4; i++) { const r = await fu.runJobs(10); if (!r.busy) return; await new Promise((res) => setTimeout(res, 2500)); } })().catch((e) => console.error("jobs", e)));
  }
  if (extra.redirect && results.length === 1) return new Response(null, { status: 303, headers: { location: extra.redirect, ...CORS } });
  if (results.length === 1) { const r = results[0]; const { http, ...body } = r; return out(body, http || (r.status === "rejected" ? 400 : r.status === "error" ? 500 : 200)); }
  return out({ success: results.some((r) => r.success), added: results.filter((r) => r.status === "added").length, duplicates: results.filter((r) => r.status === "duplicate").length, rejected: results.filter((r) => r.status === "rejected" || r.status === "error").length, results: results.map(({ http, ...r }) => r) });
}
