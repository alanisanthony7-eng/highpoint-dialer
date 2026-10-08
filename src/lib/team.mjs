// Highpoint team: memberships (role, plan, billing status), invite links, and Stripe billing.
// Stripe is called over REST (no SDK). Prices and the webhook are created automatically the first
// time they're needed, so the only secret the owner adds is STRIPE_SECRET_KEY.
import { D1, ensureSchema, getStore } from "./store.mjs";

const env = (k, d = "") => globalThis.__ENV?.[k] ?? d;
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const enc = new TextEncoder();
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
export const TERMS_VERSION = "2026-10-07";
export const PLANS = { starter: { name: "Starter", dialer: false }, pro: { name: "Pro", dialer: true } };
const DEFAULTS = { required: false, trialDays: 7, prices: { starter: 39, pro: 79 }, defaultPlan: "pro" };

/* ---------- schema ---------- */
let teamReady = null;
export function ensureTeam() {
  if (!teamReady) teamReady = ensureSchema().then(() => D1().batch([
    D1().prepare("CREATE TABLE IF NOT EXISTS members (user_id TEXT PRIMARY KEY, role TEXT NOT NULL DEFAULT 'agent', plan TEXT NOT NULL DEFAULT 'pro', status TEXT NOT NULL DEFAULT 'none', comp INTEGER NOT NULL DEFAULT 0, disabled INTEGER NOT NULL DEFAULT 0, stripe_customer TEXT, stripe_sub TEXT, period_end INTEGER, invited_by TEXT, agreed_at INTEGER, agreed_ver TEXT, created INTEGER NOT NULL)"),
    D1().prepare("CREATE TABLE IF NOT EXISTS invites (code TEXT PRIMARY KEY, created_by TEXT, plan TEXT NOT NULL DEFAULT 'pro', role TEXT NOT NULL DEFAULT 'agent', comp INTEGER NOT NULL DEFAULT 0, uses INTEGER NOT NULL DEFAULT 0, max_uses INTEGER, expires INTEGER, note TEXT, revoked INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL)"),
  ])).catch((e) => { teamReady = null; throw e; });
  return teamReady;
}

/* ---------- settings (stored in the key/value table) ---------- */
const kv = () => getStore("hpd-team");
export async function billingSettings() { const s = (await kv().get("billing", { type: "json" })) || {}; return { ...DEFAULTS, ...s, prices: { ...DEFAULTS.prices, ...(s.prices || {}) } }; }
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
    .bind(userId, o.role || "agent", PLANS[o.plan] ? o.plan : "pro", o.comp ? 1 : 0, o.invitedBy || null, o.agreedAt || null, o.agreedVer || null, Date.now()).run();
}
const ACTIVE = new Set(["active", "trialing"]);
// What this person may use right now.
export function accessFor(m, settings, isOwner) {
  const plan = m?.plan && PLANS[m.plan] ? m.plan : "pro";
  if (m?.disabled) return { ok: false, dialer: false, plan, reason: "disabled" };
  if (isOwner || m?.role === "admin") return { ok: true, dialer: true, plan: "pro", reason: "admin" };
  if (m?.comp) return { ok: true, dialer: PLANS[plan].dialer, plan, reason: "comp" };
  if (!settings.required) return { ok: true, dialer: PLANS[plan].dialer, plan, reason: "billing-off" };
  if (ACTIVE.has(m?.status) && (!m.period_end || m.period_end > Date.now() - 3 * 864e5)) return { ok: true, dialer: PLANS[plan].dialer, plan, reason: m.status };
  return { ok: false, dialer: false, plan, reason: m?.status === "past_due" ? "past_due" : "unpaid" };
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
async function stripe(path, { method = "GET", body, query } = {}) {
  const key = env("STRIPE_SECRET_KEY");
  if (!key) { const e = new Error("Billing isn't connected yet. Your admin adds STRIPE_SECRET_KEY in Cloudflare."); e.status = 503; throw e; }
  let url = "https://api.stripe.com/v1/" + path;
  if (query) url += "?" + form(query).toString();
  const r = await fetch(url, { method, headers: { authorization: "Bearer " + key, ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}) }, body: body ? form(body).toString() : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error?.message || "Stripe error"); e.status = 502; throw e; }
  return j;
}
// One monthly price per plan, found by lookup key; a new price is made when the amount changes.
async function priceFor(plan, settings) {
  const amount = Math.round((settings.prices[plan] || DEFAULTS.prices[plan]) * 100);
  const lookup = `hp_${plan}_monthly`;
  const found = (await stripe("prices", { query: { lookup_keys: [lookup], active: true, limit: 1 } })).data?.[0];
  if (found && found.unit_amount === amount && found.currency === "usd") return found.id;
  const product = found?.product || (await stripe("products", { method: "POST", body: { name: `Highpoint ${PLANS[plan].name}`, metadata: { hp_plan: plan } } })).id;
  const p = await stripe("prices", { method: "POST", body: { product, currency: "usd", unit_amount: amount, recurring: { interval: "month" }, lookup_key: lookup, transfer_lookup_key: true, metadata: { hp_plan: plan } } });
  return p.id;
}
const site = () => (env("HP_PUBLIC_URL") || globalThis.__ORIGIN || "").replace(/\/$/, "");
async function ensureWebhook() {
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
const planOf = (sub) => sub?.items?.data?.[0]?.price?.metadata?.hp_plan || sub?.metadata?.hp_plan || (sub?.items?.data?.[0]?.price?.lookup_key || "").replace(/^hp_|_monthly$/g, "") || null;
async function applySub(sub, userId) {
  const uid = userId || sub.metadata?.hp_user || (await D1().prepare("SELECT user_id FROM members WHERE stripe_customer=?1").bind(sub.customer).first())?.user_id;
  if (!uid) return;
  const plan = planOf(sub);
  await D1().prepare("UPDATE members SET status=?2, stripe_customer=?3, stripe_sub=?4, period_end=?5" + (PLANS[plan] ? ", plan=?6" : "") + " WHERE user_id=?1")
    .bind(uid, sub.status, sub.customer, sub.id, (sub.current_period_end || sub.items?.data?.[0]?.current_period_end || 0) * 1000, ...(PLANS[plan] ? [plan] : [])).run();
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
    } else if (ev.type.startsWith("customer.subscription.")) await applySub(o);
    else if (ev.type === "invoice.payment_failed" && o.subscription) await applySub(await stripe("subscriptions/" + o.subscription));
    return json({ received: true });
  }
  if (!user) return json({ error: "Sign in first" }, 401);
  const settings = await billingSettings();
  let m = await member(user.id);
  if (!m) { await addMember(user.id, { plan: settings.defaultPlan }); m = await member(user.id); }
  if (action === "status") {
    return json({ plan: m.plan, status: m.status, comp: !!m.comp, periodEnd: m.period_end, required: settings.required, trialDays: settings.trialDays, prices: settings.prices, connected: !!env("STRIPE_SECRET_KEY"), hasCustomer: !!m.stripe_customer, access: accessFor(m, settings, user.owner) });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const b = await req.json().catch(() => ({}));
  if (action === "checkout") {
    const plan = PLANS[b.plan] ? b.plan : m.plan;
    if (m.stripe_sub && ACTIVE.has(m.status)) { // already subscribed: change plan or card in the portal
      const p = await stripe("billing_portal/sessions", { method: "POST", body: { customer: m.stripe_customer, return_url: site() + "/" } });
      return json({ url: p.url });
    }
    await ensureWebhook();
    let customer = m.stripe_customer;
    if (!customer) { customer = (await stripe("customers", { method: "POST", body: { email: user.email, name: user.name, metadata: { hp_user: user.id } } })).id; await D1().prepare("UPDATE members SET stripe_customer=?2 WHERE user_id=?1").bind(user.id, customer).run(); }
    const trial = m.status === "none" && settings.trialDays > 0 ? settings.trialDays : undefined;
    const s = await stripe("checkout/sessions", { method: "POST", body: {
      mode: "subscription", customer, client_reference_id: user.id, line_items: [{ price: await priceFor(plan, settings), quantity: 1 }],
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
    if (m.stripe_customer) { const subs = (await stripe("subscriptions", { query: { customer: m.stripe_customer, status: "all", limit: 1 } })).data || []; if (subs[0]) await applySub(subs[0], user.id); }
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
    const seen = await D1().prepare("SELECT user_id, at FROM room").all();
    const at = Object.fromEntries((seen.results || []).map((x) => [x.user_id, x.at]));
    const settings = await billingSettings(); const own = (await import("./auth.mjs")).admins();
    return json({ members: (r.results || []).map((x) => ({ ...x, owner: own.includes(String(x.email).toLowerCase()), lastSeen: at[x.id] || null, access: accessFor(x.role ? x : null, settings, own.includes(String(x.email).toLowerCase())) })) });
  }
  if (action === "member" && req.method === "POST") {
    const id = String(b.id || ""); if (!id) return json({ error: "Missing agent" }, 400);
    if (id === user.id && (b.disabled || b.role === "agent")) return json({ error: "You can't lock yourself out." }, 400);
    await addMember(id, {});
    const sets = [], vals = [id];
    if (b.role && ["agent", "admin"].includes(b.role)) { sets.push(`role=?${vals.push(b.role)}`); }
    if (b.plan && PLANS[b.plan]) { sets.push(`plan=?${vals.push(b.plan)}`); }
    if (b.comp !== undefined) { sets.push(`comp=?${vals.push(b.comp ? 1 : 0)}`); }
    if (b.disabled !== undefined) { sets.push(`disabled=?${vals.push(b.disabled ? 1 : 0)}`); }
    if (sets.length) await D1().prepare(`UPDATE members SET ${sets.join(", ")} WHERE user_id=?1`).bind(...vals).run();
    if (b.disabled) await D1().prepare("DELETE FROM sessions WHERE user_id=?1").bind(id).run();
    return json({ ok: true });
  }
  if (action === "invites") {
    const r = await D1().prepare("SELECT * FROM invites WHERE revoked=0 ORDER BY created DESC LIMIT 100").all();
    return json({ invites: (r.results || []).map((i) => ({ ...i, url: site() + "/?invite=" + i.code })) });
  }
  if (action === "invite" && req.method === "POST") {
    const c = code();
    await D1().prepare("INSERT INTO invites (code, created_by, plan, role, comp, max_uses, expires, note, created) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)")
      .bind(c, user.id, PLANS[b.plan] ? b.plan : "pro", b.role === "admin" ? "admin" : "agent", b.comp ? 1 : 0, b.maxUses ? Math.max(1, +b.maxUses) : null, b.days ? Date.now() + Math.max(1, +b.days) * 864e5 : null, String(b.note || "").slice(0, 80) || null, Date.now()).run();
    return json({ code: c, url: site() + "/?invite=" + c });
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
      if (b.prices) patch.prices = { starter: Math.max(1, +b.prices.starter || DEFAULTS.prices.starter), pro: Math.max(1, +b.prices.pro || DEFAULTS.prices.pro) };
      if (b.defaultPlan && PLANS[b.defaultPlan]) patch.defaultPlan = b.defaultPlan;
      await saveSettings(patch);
    }
    const s = await secretStore();
    return json({ ...(await billingSettings()), connected: !!env("STRIPE_SECRET_KEY"), webhook: s.webhookUrl || null, testMode: /^sk_test_/.test(env("STRIPE_SECRET_KEY")) });
  }
  return json({ error: "Unknown action" }, 404);
}
