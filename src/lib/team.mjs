// Highpoint team: memberships (role, plan, billing status), invite links, and Stripe billing.
// Stripe is called over REST (no SDK). Prices and the webhook are created automatically the first
// time they're needed, so the only secret the owner adds is STRIPE_SECRET_KEY.
import { D1, ensureSchema, getStore } from "./store.mjs";

const env = (k, d = "") => globalThis.__ENV?.[k] ?? d;
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const enc = new TextEncoder();
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
export const TERMS_VERSION = "2026-10-07";
/* Plans. Base and Pro include the features listed in settings (admins can change them in Team → Billing);
   Full Access and Early Access include everything. Early Access is sold only while early access is open. */
export const FEATURES = {
  crm: "My CRM, calendar and lead import",
  clients: "Client list",
  quoter: "Quote & compare",
  screen: "Health screener",
  scripts: "Call scripts and Training",
  bot: "Highpoint Bot",
  iul: "IUL illustrator",
  dialer: "Highpoint Dialer: power dialing, local numbers, texting, voicemail drop, recordings, live transcripts and Copilot",
  crew: "Crew lobby, chat and games",
  music: "Spotify in the desk",
};
const ALL = Object.keys(FEATURES);
export const PLANS = {
  early: { name: "Early Access", early: true },
  base: { name: "Base" },
  plus: { name: "Pro" },
  full: { name: "Full Access" },
};
export const ORDER = ["base", "plus", "full"];
// older plan names: Starter became Base; the old Pro (which had the dialer) became Full Access
export const normPlan = (p) => (PLANS[p] ? p : p === "pro" ? "full" : p === "starter" ? "base" : null);
const DEFAULT_FEATURES = { base: ["crm", "clients", "quoter", "screen", "scripts"], plus: ["crm", "clients", "quoter", "screen", "scripts", "bot", "iul"] };
// Dialer minutes included each month (null = no limit). They only count once payment is required; admins and
// free-access agents are never limited. With overage on, extra minutes are billed through Stripe instead of stopping.
const DEFAULT_MINUTES = { early: 1000, base: null, plus: null, full: 2000 };
const DEFAULTS = { required: false, trialDays: 7, prices: { early: 40, base: 50, plus: 75, full: 150 }, defaultPlan: "full", features: DEFAULT_FEATURES, early: { on: true, ends: null }, minutes: DEFAULT_MINUTES, overage: { on: false, rate: 0.04 }, numbers: { charge: true, price: 2 } };
export function featuresFor(plan, settings) {
  const p = normPlan(plan) || "full";
  if (p === "full" || p === "early") return ALL.slice();
  const list = (settings?.features?.[p] || DEFAULT_FEATURES[p]).filter((k) => FEATURES[k]);
  return ["crm", ...list.filter((k) => k !== "crm")];
}
export const earlyOpen = (s) => !!s.early?.on && (!s.early.ends || s.early.ends > Date.now());
// the cheapest plans that include a feature, for "X is part of Pro" messages
export function plansWith(feature, settings) { return ORDER.filter((p) => featuresFor(p, settings).includes(feature)).map((p) => PLANS[p].name); }

/* ---------- schema ---------- */
let teamReady = null;
export function ensureTeam() {
  if (!teamReady) teamReady = ensureSchema().then(() => D1().batch([
    D1().prepare("CREATE TABLE IF NOT EXISTS members (user_id TEXT PRIMARY KEY, role TEXT NOT NULL DEFAULT 'agent', plan TEXT NOT NULL DEFAULT 'full', status TEXT NOT NULL DEFAULT 'none', comp INTEGER NOT NULL DEFAULT 0, disabled INTEGER NOT NULL DEFAULT 0, stripe_customer TEXT, stripe_sub TEXT, period_end INTEGER, invited_by TEXT, agreed_at INTEGER, agreed_ver TEXT, created INTEGER NOT NULL)"),
    D1().prepare("CREATE TABLE IF NOT EXISTS invites (code TEXT PRIMARY KEY, created_by TEXT, plan TEXT NOT NULL DEFAULT 'full', role TEXT NOT NULL DEFAULT 'agent', comp INTEGER NOT NULL DEFAULT 0, uses INTEGER NOT NULL DEFAULT 0, max_uses INTEGER, expires INTEGER, note TEXT, revoked INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL)"),
  ]).then(() => D1().batch([ // old plan names -> new ones (keeps everyone's access the same)
    D1().prepare("UPDATE members SET plan='full' WHERE plan='pro'"), D1().prepare("UPDATE members SET plan='base' WHERE plan='starter'"),
    D1().prepare("UPDATE invites SET plan='full' WHERE plan='pro'"), D1().prepare("UPDATE invites SET plan='base' WHERE plan='starter'"),
  ]))).catch((e) => { teamReady = null; throw e; });
  return teamReady;
}

/* ---------- settings (stored in the key/value table) ---------- */
const kv = () => getStore("hpd-team");
export async function billingSettings() {
  const s = (await kv().get("billing", { type: "json" })) || {}, prices = { ...DEFAULTS.prices };
  for (const k of Object.keys(PLANS)) if (+s.prices?.[k] > 0) prices[k] = +s.prices[k];
  const features = {}; for (const k of ["base", "plus"]) features[k] = Array.isArray(s.features?.[k]) ? s.features[k].filter((f) => FEATURES[f]) : DEFAULT_FEATURES[k];
  const minutes = { ...DEFAULT_MINUTES }; for (const k of Object.keys(PLANS)) if (s.minutes && k in s.minutes) minutes[k] = s.minutes[k] == null || s.minutes[k] === "" ? null : Math.max(0, Math.round(+s.minutes[k] || 0));
  return { ...DEFAULTS, ...s, prices, features, minutes, overage: { ...DEFAULTS.overage, ...(s.overage || {}) }, numbers: { ...DEFAULTS.numbers, ...(s.numbers || {}) }, defaultPlan: normPlan(s.defaultPlan) || DEFAULTS.defaultPlan, early: { ...DEFAULTS.early, ...(s.early || {}) } };
}
async function saveSettings(patch) { const cur = (await kv().get("billing", { type: "json" })) || {}; const next = { ...cur, ...patch }; await kv().setJSON("billing", next); return next; }
async function secretStore() { return (await kv().get("stripe", { type: "json" })) || {}; }
async function saveSecret(patch) { await kv().setJSON("stripe", { ...(await secretStore()), ...patch }); }

/* ---------- members ---------- */
export async function member(userId) {
  await ensureTeam();
  return D1().prepare("SELECT * FROM members WHERE user_id=?1").bind(userId).first();
}
export async function addMember(userId, o = {}) {
  await ensureTeam();
  await D1().prepare("INSERT OR IGNORE INTO members (user_id, role, plan, comp, invited_by, agreed_at, agreed_ver, created) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)")
    .bind(userId, o.role || "agent", normPlan(o.plan) || "full", o.comp ? 1 : 0, o.invitedBy || null, o.agreedAt || null, o.agreedVer || null, Date.now()).run();
}
const ACTIVE = new Set(["active", "trialing"]);
// What this person may use right now.
export function accessFor(m, settings, isOwner) {
  const plan = normPlan(m?.plan) || "full";
  const yes = (p, reason) => { const features = featuresFor(p, settings); return { ok: true, plan: p, reason, features, dialer: features.includes("dialer") }; };
  if (m?.disabled) return { ok: false, dialer: false, features: [], plan, reason: "disabled" };
  if (isOwner || m?.role === "admin") return yes("full", "admin");
  if (m?.comp) return yes(plan, "comp");
  if (!settings.required) return yes(plan, "billing-off");
  if (ACTIVE.has(m?.status) && (!m.period_end || m.period_end > Date.now() - 3 * 864e5)) return yes(plan, m.status);
  return { ok: false, dialer: false, features: [], plan, reason: m?.status === "past_due" ? "past_due" : "unpaid" };
}

/* ---------- dialer minutes ---------- */
const nyDay = (t) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
export const minutesFor = (plan, settings) => { const v = settings.minutes?.[normPlan(plan) || "full"]; return v == null ? null : +v; };
// this month for the agent: their Stripe billing period, else the calendar month
export function cycleOf(m) {
  if (m?.stripe_sub && m.period_end && m.period_end > Date.now() - 40 * 864e5) { const s = new Date(m.period_end); s.setMonth(s.getMonth() - 1); return [s.getTime(), m.period_end]; }
  const n = new Date(); return [new Date(n.getFullYear(), n.getMonth(), 1).getTime(), new Date(n.getFullYear(), n.getMonth() + 1, 1).getTime()];
}
// billable minutes: each connected call rounded up to the minute (older days without that count are estimated)
export async function minutesUsed(identity, [from, to]) {
  const days = new Set(); for (let t = from; t < Math.min(to, Date.now() + 864e5); t += 864e5) days.add(nyDay(t)); days.add(nyDay(Math.min(to, Date.now()) - 1));
  const st = getStore({ name: "hpd-stats" });
  const docs = await Promise.all([...days].map((d) => st.get(`${d}/a/${identity}`, { type: "json" }).catch(() => null)));
  return docs.reduce((n, a) => n + (!a ? 0 : a.billMin != null ? a.billMin : Math.round((a.talkSec || 0) / 60 + (a.answered || 0) * 0.5)), 0);
}
// null when the agent may dial; otherwise why not
export async function minutesGate(user) {
  const settings = await billingSettings(); if (!settings.required) return null;
  const uid = user.id || String(user.identity || "").replace(/^hp_/, ""), m = await member(uid);
  if (!m || m.comp || m.role === "admin" || (await import("./auth.mjs")).admins().includes(String(user.email || "").toLowerCase())) return null;
  const inc = minutesFor(m.plan, settings); if (inc == null) return null;
  if (settings.overage?.on && m.stripe_sub && env("STRIPE_SECRET_KEY")) return null; // extra minutes are billed
  const cyc = cycleOf(m), used = await minutesUsed("hp_" + uid, cyc);
  if (used < inc) return null;
  return `You've used all ${inc.toLocaleString("en-US")} dialer minutes in your plan for this month. They reset ${new Date(cyc[1]).toLocaleDateString("en-US", { month: "short", day: "numeric" })}. Ask your Highpoint admin about more minutes.`;
}
// at the end of a connected call: report its minutes to Stripe (the first ones in the plan cost nothing)
export async function reportMinutes(rec) {
  try {
    const n = Math.ceil((+rec.talkSec || 0) / 60); if (!n || !env("STRIPE_SECRET_KEY")) return;
    const settings = await billingSettings(); if (!settings.overage?.on || !settings.required) return;
    const m = await member(String(rec.agent || "").replace(/^hp_/, "")); if (!m?.stripe_customer || !ACTIVE.has(m.status) || m.comp) return;
    const meter = await ensureMeter();
    await stripe("billing/meter_events", { method: "POST", body: { event_name: meter.event, identifier: "hpcall_" + String(rec.id || rec.sid || Date.now()).slice(0, 90), timestamp: Math.floor((rec.endedAt || Date.now()) / 1000), payload: { stripe_customer_id: m.stripe_customer, value: n } } });
  } catch (e) { console.error("minutes report failed", e.message); }
}

/* ---------- invites ---------- */
const code = () => hex(crypto.getRandomValues(new Uint8Array(9)));
export async function useInvite(c) {
  await ensureTeam();
  const inv = await D1().prepare("SELECT * FROM invites WHERE code=?1").bind(String(c || "").trim()).first();
  if (!inv || inv.revoked) return { error: "That invite link isn't valid anymore. Ask your Highpoint admin for a new one." };
  if (inv.expires && inv.expires < Date.now()) return { error: "That invite link has expired. Ask your Highpoint admin for a new one." };
  if (inv.max_uses && inv.uses >= inv.max_uses) return { error: "That invite link has already been used. Ask your Highpoint admin for a new one." };
  return { inv };
}
export async function markInviteUsed(c) { await D1().prepare("UPDATE invites SET uses = uses + 1 WHERE code=?1").bind(c).run(); }

/* ---------- Stripe ---------- */
function form(obj, pre = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = pre ? `${pre}[${k}]` : k;
    if (typeof v === "object") form(v, key, out); else out.append(key, String(v));
  }
  return out;
}
// e.http is Stripe's own status (402 = the card was declined) and e.stripeCode its error code
export async function stripe(path, { method = "GET", body, query } = {}) {
  const key = env("STRIPE_SECRET_KEY");
  if (!key) { const e = new Error("Billing isn't connected yet. Your admin adds STRIPE_SECRET_KEY in Cloudflare."); e.status = 503; throw e; }
  let url = "https://api.stripe.com/v1/" + path;
  if (query) url += "?" + form(query).toString();
  const r = await fetch(url, { method, headers: { authorization: "Bearer " + key, ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}) }, body: body ? form(body).toString() : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error?.message || "Stripe error"); e.status = 502; e.http = r.status; e.stripeCode = j.error?.decline_code || j.error?.code || ""; throw e; }
  return j;
}
// One monthly price per plan, found by lookup key; a new price is made when the amount changes.
async function priceFor(plan, settings) {
  const amount = Math.round((settings.prices[plan] || DEFAULTS.prices[plan]) * 100);
  if (!PLANS[plan]) { const e = new Error("Unknown plan"); e.status = 400; throw e; }
  const lookup = `hp_${plan}_monthly`;
  const found = (await stripe("prices", { query: { lookup_keys: [lookup], active: true, limit: 1 } })).data?.[0];
  if (found && found.unit_amount === amount && found.currency === "usd") return found.id;
  const product = found?.product || (await stripe("products", { method: "POST", body: { name: `Highpoint ${PLANS[plan].name}`, metadata: { hp_plan: plan } } })).id;
  const p = await stripe("prices", { method: "POST", body: { product, currency: "usd", unit_amount: amount, recurring: { interval: "month" }, lookup_key: lookup, transfer_lookup_key: true, metadata: { hp_plan: plan } } });
  return p.id;
}
async function ensureMeter() {
  const s = await secretStore(); if (s.meterId && s.meterEvent) return { id: s.meterId, event: s.meterEvent };
  const event = "hp_dialer_minutes";
  let m = ((await stripe("billing/meters", { query: { status: "active", limit: 100 } })).data || []).find((x) => x.event_name === event);
  if (!m) m = await stripe("billing/meters", { method: "POST", body: { display_name: "Highpoint dialer minutes", event_name: event, default_aggregation: { formula: "sum" }, customer_mapping: { type: "by_id", event_payload_key: "stripe_customer_id" }, value_settings: { event_payload_key: "value" } } });
  await saveSecret({ meterId: m.id, meterEvent: event });
  return { id: m.id, event };
}
async function minutesPriceFor(plan, settings) {
  if (!settings.overage?.on) return null;
  const inc = minutesFor(plan, settings); if (inc == null) return null;
  const rate = String(Math.max(0, +settings.overage.rate || 0) * 100).replace(/(\.\d{0,6})\d*$/, "$1"), lookup = `hp_${plan}_minutes`;
  const found = (await stripe("prices", { query: { lookup_keys: [lookup], active: true, limit: 1 } })).data?.[0];
  if (found && found.metadata?.hp_minutes === String(inc) && found.metadata?.hp_rate === rate) return found.id;
  const meter = await ensureMeter(), s = await secretStore();
  let product = s.minutesProduct;
  if (!product) { product = (await stripe("products", { method: "POST", body: { name: "Highpoint dialer minutes", metadata: { hp_kind: "minutes" } } })).id; await saveSecret({ minutesProduct: product }); }
  const body = { product, currency: "usd", recurring: { interval: "month", usage_type: "metered", meter: meter.id }, lookup_key: lookup, transfer_lookup_key: true, metadata: { hp_plan: plan, hp_kind: "minutes", hp_minutes: String(inc), hp_rate: rate } };
  if (inc > 0) Object.assign(body, { billing_scheme: "tiered", tiers_mode: "graduated", tiers: [{ up_to: inc, unit_amount: 0 }, { up_to: "inf", unit_amount_decimal: rate }] });
  else body.unit_amount_decimal = rate;
  return (await stripe("prices", { method: "POST", body })).id;
}
export const site = () => (env("HP_PUBLIC_URL") || globalThis.__ORIGIN || "").replace(/\/$/, "");
export async function ensureWebhook() {
  const s = await secretStore();
  if (s.webhookSecret && s.webhookId) return s;
  const url = site() + "/api/billing/webhook";
  const w = await stripe("webhook_endpoints", { method: "POST", body: { url, enabled_events: ["checkout.session.completed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted", "invoice.payment_failed"], description: "Highpoint desk billing" } });
  await saveSecret({ webhookId: w.id, webhookSecret: w.secret, webhookUrl: url });
  return { webhookId: w.id, webhookSecret: w.secret };
}
async function verify(req, raw) {
  const secret = env("STRIPE_WEBHOOK_SECRET") || (await secretStore()).webhookSecret;
  if (!secret) return false;
  const h = req.headers.get("stripe-signature") || "";
  const t = (h.match(/(?:^|,)t=(\d+)/) || [])[1]; const sigs = [...h.matchAll(/(?:^|,)v1=([a-f0-9]+)/g)].map((m) => m[1]);
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - +t) > 600) return false;
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mine = hex(await crypto.subtle.sign("HMAC", k, enc.encode(`${t}.${raw}`)));
  return sigs.some((s) => s.length === mine.length && [...s].reduce((a, c, i) => a | (c.charCodeAt(0) ^ mine.charCodeAt(i)), 0) === 0);
}
const planItem = (sub) => (sub?.items?.data || []).find((i) => i.price?.recurring?.usage_type !== "metered" && i.price?.metadata?.hp_kind !== "minutes") || sub?.items?.data?.[0];
const minutesItem = (sub) => (sub?.items?.data || []).find((i) => i.price?.recurring?.usage_type === "metered" || i.price?.metadata?.hp_kind === "minutes");
const planOf = (sub) => normPlan(planItem(sub)?.price?.metadata?.hp_plan || (planItem(sub)?.price?.lookup_key || "").replace(/^hp_|_monthly$/g, "") || sub?.metadata?.hp_plan);
async function applySub(sub, userId) {
  if (sub?.metadata?.hp_kind === "number") return (await import("./numberpay.mjs")).numberSubChanged(sub); // a phone number's own subscription, not the plan
  const uid = userId || sub.metadata?.hp_user || (await D1().prepare("SELECT user_id FROM members WHERE stripe_customer=?1").bind(sub.customer).first())?.user_id;
  if (!uid) return;
  const plan = planOf(sub);
  await D1().prepare("UPDATE members SET status=?2, stripe_customer=?3, stripe_sub=?4, period_end=?5" + (PLANS[plan] ? ", plan=?6" : "") + " WHERE user_id=?1")
    .bind(uid, sub.status, sub.customer, sub.id, (sub.current_period_end || planItem(sub)?.current_period_end || 0) * 1000, ...(PLANS[plan] ? [plan] : [])).run();
  (await import("./auth.mjs")).clearUserCache();
}

// the subscription's items for a plan: the plan price, and the minutes price when overage is on
async function swapItems(sub, plan, settings) {
  const items = [{ id: planItem(sub).id, price: await priceFor(plan, settings) }];
  const mp = await minutesPriceFor(plan, settings), mi = minutesItem(sub);
  if (mp && mi) items.push({ id: mi.id, price: mp }); else if (mp) items.push({ price: mp }); else if (mi) items.push({ id: mi.id, deleted: true });
  return items;
}
// overage switched on: put a minutes price on every active subscription (switched off: take it off)
async function syncMinutesItems(settings) {
  const r = await D1().prepare("SELECT user_id, stripe_sub, plan FROM members WHERE stripe_sub IS NOT NULL AND status IN ('active','trialing')").all();
  const out = { updated: 0, failed: [] };
  for (const x of r.results || []) {
    try {
      const sub = await stripe("subscriptions/" + x.stripe_sub), mi = minutesItem(sub), mp = await minutesPriceFor(normPlan(x.plan), settings);
      if (mp && (!mi || mi.price?.id !== mp)) await stripe("subscriptions/" + x.stripe_sub, { method: "POST", body: { items: [mi ? { id: mi.id, price: mp } : { price: mp }], proration_behavior: "none" } });
      else if (!mp && mi) await stripe("subscription_items/" + mi.id, { method: "DELETE", query: { clear_usage: false } });
      else continue;
      out.updated++;
    } catch (e) { out.failed.push(x.user_id + ": " + e.message); }
  }
  return out;
}
// the agent's minutes this month, for Billing and the dialer
export async function minutesInfo(user, m, settings) {
  const cyc = cycleOf(m), used = await minutesUsed(user.identity || "hp_" + user.id, cyc);
  const limited = settings.required && !m.comp && m.role !== "admin" && !user.owner;
  const included = limited && featuresFor(m.plan, settings).includes("dialer") ? minutesFor(m.plan, settings) : null;
  return { used, included, resets: cyc[1], overage: limited && included != null && !!settings.overage?.on && !!m.stripe_sub ? +settings.overage.rate : null };
}
// what each plan costs and includes, for the plan screens
function catalog(settings) {
  const open = earlyOpen(settings);
  return {
    plans: Object.entries(PLANS).map(([k, p]) => ({ key: k, name: p.name, price: settings.prices[k], features: featuresFor(k, settings), early: !!p.early, available: k !== "early" || open, minutes: featuresFor(k, settings).includes("dialer") ? minutesFor(k, settings) : null })),
    overage: settings.overage,
    featureNames: FEATURES, earlyOpen: open, earlyEnds: settings.early?.ends || null,
  };
}
// End early access: no new Early Access sign-ups, and (unless kept) every Early Access subscription moves to another plan
// from its next renewal (no charge for the rest of the month they already paid for).
async function endEarly(moveTo, settings) {
  const out = { moved: 0, kept: 0, failed: [] };
  const r = await D1().prepare("SELECT m.user_id, m.stripe_sub, m.status, u.email FROM members m JOIN users u ON u.id = m.user_id WHERE m.plan='early'").all();
  for (const x of r.results || []) {
    if (moveTo === "keep") { out.kept++; continue; }
    try {
      if (x.stripe_sub && ACTIVE.has(x.status)) {
        const sub = await stripe("subscriptions/" + x.stripe_sub);
        const next = await stripe("subscriptions/" + x.stripe_sub, { method: "POST", body: { items: await swapItems(sub, moveTo, settings), proration_behavior: "none", metadata: { hp_user: x.user_id, hp_plan: moveTo } } });
        await applySub(next, x.user_id);
      } else await D1().prepare("UPDATE members SET plan=?2 WHERE user_id=?1").bind(x.user_id, moveTo).run();
      out.moved++;
    } catch (e) { out.failed.push(x.email + ": " + e.message); }
  }
  return out;
}

/* ---------- routes ---------- */
// /api/billing/{status|checkout|portal|sync|webhook}
export async function billingRoute(req, action, user) {
  await ensureTeam();
  if (action === "webhook") {
    const raw = await req.text();
    if (!(await verify(req, raw))) return json({ error: "Bad signature" }, 400);
    const ev = JSON.parse(raw), o = ev.data?.object || {};
    if (ev.type === "checkout.session.completed" && o.subscription) {
      const uid = o.client_reference_id || o.metadata?.hp_user;
      if (uid) await D1().prepare("UPDATE members SET stripe_customer=?2 WHERE user_id=?1").bind(uid, o.customer).run();
      await applySub(await stripe("subscriptions/" + o.subscription), uid);
    } else if (ev.type === "checkout.session.completed" && o.mode === "setup") await (await import("./numberpay.mjs")).finishCardSetup(o);
    else if (ev.type.startsWith("customer.subscription.")) await applySub(o);
    else if (ev.type === "invoice.payment_failed" && o.subscription) await applySub(await stripe("subscriptions/" + o.subscription));
    return json({ received: true });
  }
  if (!user) return json({ error: "Sign in first" }, 401);
  const settings = await billingSettings();
  let m = await member(user.id);
  if (!m) { await addMember(user.id, { plan: settings.defaultPlan }); m = await member(user.id); }
  if (action === "status") {
    return json({ plan: normPlan(m.plan), status: m.status, comp: !!m.comp, periodEnd: m.period_end, required: settings.required, trialDays: settings.trialDays, prices: settings.prices,
      connected: !!env("STRIPE_SECRET_KEY"), hasCustomer: !!m.stripe_customer, subscribed: !!m.stripe_sub && ACTIVE.has(m.status), access: accessFor(m, settings, user.owner), ...catalog(settings), minutes: await minutesInfo(user, m, settings),
      card: await (await import("./numberpay.mjs")).cardOf(user.id), numbers: settings.numbers });
  }
  if (action === "card") return (await import("./numberpay.mjs")).cardRoute(req, user, m);
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const b = await req.json().catch(() => ({}));
  if (action === "checkout" || action === "change") {
    const plan = normPlan(b.plan) || normPlan(m.plan);
    if (plan === "early" && !earlyOpen(settings) && normPlan(m.plan) !== "early") return json({ error: "Early access has ended. Choose Base, Pro or Full Access." }, 400);
    if (m.stripe_sub && ACTIVE.has(m.status)) { // already subscribed: switch the plan on the same subscription (Stripe prorates the difference)
      if (plan === normPlan(m.plan)) return json({ ok: true, plan, access: accessFor(m, settings, user.owner) });
      const sub = await stripe("subscriptions/" + m.stripe_sub), item = planItem(sub);
      if (!item) return json({ error: "Couldn't find your subscription. Open Manage billing, or contact your admin." }, 400);
      const next = await stripe("subscriptions/" + m.stripe_sub, { method: "POST", body: { items: await swapItems(sub, plan, settings), proration_behavior: "create_prorations", metadata: { hp_user: user.id, hp_plan: plan } } });
      await applySub(next, user.id);
      const m2 = await member(user.id);
      return json({ ok: true, changed: true, plan: normPlan(m2.plan), access: accessFor(m2, settings, user.owner) });
    }
    if (action === "change") return json({ error: "You don't have a subscription yet. Choose a plan to check out." }, 400);
    await ensureWebhook();
    let customer = m.stripe_customer;
    if (!customer) { customer = (await stripe("customers", { method: "POST", body: { email: user.email, name: user.name, metadata: { hp_user: user.id } } })).id; await D1().prepare("UPDATE members SET stripe_customer=?2 WHERE user_id=?1").bind(user.id, customer).run(); }
    const trial = m.status === "none" && settings.trialDays > 0 ? settings.trialDays : undefined;
    const s = await stripe("checkout/sessions", { method: "POST", body: {
      mode: "subscription", customer, client_reference_id: user.id, line_items: [{ price: await priceFor(plan, settings), quantity: 1 }, ...((await minutesPriceFor(plan, settings)) ? [{ price: await minutesPriceFor(plan, settings) }] : [])],
      subscription_data: { metadata: { hp_user: user.id, hp_plan: plan }, ...(trial ? { trial_period_days: trial } : {}) },
      metadata: { hp_user: user.id }, allow_promotion_codes: true,
      success_url: site() + "/?billing=success", cancel_url: site() + "/?billing=canceled" } });
    return json({ url: s.url });
  }
  if (action === "portal") {
    if (!m.stripe_customer) return json({ error: "You don't have a subscription yet." }, 400);
    const s = await stripe("billing_portal/sessions", { method: "POST", body: { customer: m.stripe_customer, return_url: site() + "/" } });
    return json({ url: s.url });
  }
  if (action === "sync") { // after checkout, don't wait on the webhook
    if (m.stripe_customer) { const subs = ((await stripe("subscriptions", { query: { customer: m.stripe_customer, status: "all", limit: 20 } })).data || []).filter((x) => x.metadata?.hp_kind !== "number"); if (subs[0]) await applySub(subs[0], user.id); }
    const m2 = await member(user.id);
    return json({ status: m2.status, plan: m2.plan, access: accessFor(m2, settings, user.owner) });
  }
  return json({ error: "Unknown action" }, 404);
}

// /api/team/{members|member|invites|invite|revoke|settings}  (admins only)
export async function teamRoute(req, action, user) {
  await ensureTeam();
  if (!user) return json({ error: "Sign in first" }, 401);
  if (!user.admin) return json({ error: "Admins only" }, 403);
  const b = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  if (action === "members") {
    const r = await D1().prepare("SELECT u.id, u.email, u.name, u.created, m.role, m.plan, m.status, m.comp, m.disabled, m.period_end, m.agreed_at, m.invited_by FROM users u LEFT JOIN members m ON m.user_id = u.id ORDER BY u.created").all();
    const tf = await D1().prepare("SELECT key FROM blobs WHERE store='hpd-auth' AND key LIKE '2fa:%' AND txt LIKE '%\"on\":true%'").all().catch(() => ({ results: [] }));
    const on2 = new Set((tf.results || []).map((x) => String(x.key).slice(4)));
    const seen = await D1().prepare("SELECT user_id, at FROM room").all();
    const at = Object.fromEntries((seen.results || []).map((x) => [x.user_id, x.at]));
    const settings = await billingSettings(); const own = (await import("./auth.mjs")).admins();
    return json({ members: (r.results || []).map((x) => ({ ...x, twofa: on2.has(x.id), owner: own.includes(String(x.email).toLowerCase()), lastSeen: at[x.id] || null, access: accessFor(x.role ? x : null, settings, own.includes(String(x.email).toLowerCase())) })) });
  }
  if (action === "member" && req.method === "POST") {
    const id = String(b.id || ""); if (!id) return json({ error: "Missing agent" }, 400);
    if (id === user.id && (b.disabled || b.role === "agent")) return json({ error: "You can't lock yourself out." }, 400);
    await addMember(id, {});
    const sets = [], vals = [id];
    if (b.role && ["agent", "admin"].includes(b.role)) { sets.push(`role=?${vals.push(b.role)}`); }
    if (b.plan && normPlan(b.plan)) { sets.push(`plan=?${vals.push(normPlan(b.plan))}`); }
    if (b.comp !== undefined) { sets.push(`comp=?${vals.push(b.comp ? 1 : 0)}`); }
    if (b.disabled !== undefined) { sets.push(`disabled=?${vals.push(b.disabled ? 1 : 0)}`); }
    if (sets.length) await D1().prepare(`UPDATE members SET ${sets.join(", ")} WHERE user_id=?1`).bind(...vals).run();
    if (b.role) { try { await (await import("./lounge.mjs")).syncLoungeRoles(); } catch {} }
    if (b.disabled) await D1().prepare("DELETE FROM sessions WHERE user_id=?1").bind(id).run();
    if (b.reset2fa) await getStore("hpd-auth").delete("2fa:" + id);
    return json({ ok: true });
  }
  if (action === "invites") {
    const r = await D1().prepare("SELECT * FROM invites WHERE revoked=0 ORDER BY created DESC LIMIT 100").all();
    return json({ invites: (r.results || []).map((i) => ({ ...i, url: site() + "/?invite=" + i.code })) });
  }
  if (action === "invite" && req.method === "POST") {
    const c = code();
    await D1().prepare("INSERT INTO invites (code, created_by, plan, role, comp, max_uses, expires, note, created) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)")
      .bind(c, user.id, normPlan(b.plan) || "full", b.role === "admin" ? "admin" : "agent", b.comp ? 1 : 0, b.maxUses ? Math.max(1, +b.maxUses) : null, b.days ? Date.now() + Math.max(1, +b.days) * 864e5 : null, String(b.note || "").slice(0, 80) || null, Date.now()).run();
    let emailed = false;
    if (b.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(b.email).trim())) {
      const { emailOn, sendEmail, layout } = await import("./email.mjs");
      if (emailOn()) emailed = (await sendEmail({ to: String(b.email).trim(), subject: `${user.name} invited you to the Highpoint desk`, ...layout({ title: "You're invited to Highpoint", paras: [`${user.name} invited you to join the Highpoint agent desk: your leads, dialer, quotes and follow-ups in one place.`], button: { label: "Create my login", url: site() + "/?invite=" + c }, after: ["The link works once and is only for you."] }) })).ok;
    }
    return json({ code: c, url: site() + "/?invite=" + c, emailed });
  }
  if (action === "revoke" && req.method === "POST") { await D1().prepare("UPDATE invites SET revoked=1 WHERE code=?1").bind(String(b.code || "")).run(); return json({ ok: true }); }
  if (action === "settings") {
    if (req.method === "POST") {
      const patch = {};
      if (b.required !== undefined) {
        if (b.required && !env("STRIPE_SECRET_KEY")) return json({ error: "Connect Stripe first: add STRIPE_SECRET_KEY in Cloudflare, then turn this on." }, 400);
        patch.required = !!b.required;
      }
      if (b.trialDays !== undefined) patch.trialDays = Math.max(0, Math.min(60, Math.round(+b.trialDays || 0)));
      if (b.prices) { patch.prices = {}; for (const k of Object.keys(PLANS)) patch.prices[k] = Math.max(1, Math.round(+b.prices[k] || DEFAULTS.prices[k])); }
      if (b.defaultPlan && normPlan(b.defaultPlan)) patch.defaultPlan = normPlan(b.defaultPlan);
      if (b.features) { patch.features = {}; for (const k of ["base", "plus"]) patch.features[k] = (Array.isArray(b.features[k]) ? b.features[k] : DEFAULT_FEATURES[k]).filter((f) => FEATURES[f]); }
      if (b.minutes) { patch.minutes = {}; for (const k of Object.keys(PLANS)) patch.minutes[k] = b.minutes[k] == null || b.minutes[k] === "" ? null : Math.max(0, Math.round(+b.minutes[k] || 0)); }
      if (b.overage) {
        if (b.overage.on && !env("STRIPE_SECRET_KEY")) return json({ error: "Connect Stripe first to bill extra minutes." }, 400);
        patch.overage = { on: !!b.overage.on, rate: Math.min(5, Math.max(0.001, +b.overage.rate || DEFAULTS.overage.rate)) };
      }
      if (b.numbers) { const cur = (await billingSettings()).numbers; patch.numbers = { charge: b.numbers.charge === undefined ? cur.charge : !!b.numbers.charge, price: b.numbers.price === undefined ? cur.price : Math.round(Math.min(100, Math.max(0.5, +b.numbers.price || DEFAULTS.numbers.price)) * 100) / 100 }; }
      if (b.early) { const cur = (await billingSettings()).early; patch.early = { on: b.early.on === undefined ? cur.on : !!b.early.on, ends: b.early.ends === undefined ? cur.ends : b.early.ends ? Math.max(0, +new Date(b.early.ends)) || null : null }; }
      const before = await billingSettings();
      await saveSettings(patch);
      const after = await billingSettings();
      if (env("STRIPE_SECRET_KEY") && (patch.overage || patch.minutes) && JSON.stringify([before.overage, before.minutes]) !== JSON.stringify([after.overage, after.minutes])) {
        const r = await syncMinutesItems(after); if (r.failed.length) console.error("minutes sync", r.failed);
      }
    }
    const s = await secretStore(), cur = await billingSettings();
    const early = (await D1().prepare("SELECT COUNT(*) AS n FROM members WHERE plan='early'").first())?.n || 0;
    return json({ ...cur, ...catalog(cur), earlyMembers: early, connected: !!env("STRIPE_SECRET_KEY"), webhook: s.webhookUrl || null, testMode: /^sk_test_/.test(env("STRIPE_SECRET_KEY")) });
  }
  if (action === "early-end" && req.method === "POST") {
    const moveTo = b.moveTo === "keep" ? "keep" : ORDER.includes(b.moveTo) ? b.moveTo : null;
    if (!moveTo) return json({ error: "Pick the plan Early Access members move to, or keep their price." }, 400);
    const settings = await billingSettings();
    if (moveTo !== "keep" && !env("STRIPE_SECRET_KEY")) {
      const n = (await D1().prepare("SELECT COUNT(*) AS n FROM members WHERE plan='early' AND stripe_sub IS NOT NULL").first())?.n || 0;
      if (n) return json({ error: "Connect Stripe first so their subscriptions can be moved." }, 400);
    }
    await saveSettings({ early: { on: false, ends: Date.now(), endedTo: moveTo } });
    const r = await endEarly(moveTo, settings);
    (await import("./auth.mjs")).clearUserCache();
    return json({ ok: true, ...r });
  }
  return json({ error: "Unknown action" }, 404);
}
