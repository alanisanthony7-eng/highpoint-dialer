// Plans, Stripe billing and per-agent Spotify, run locally with an in-memory D1, a fake Stripe and a fake Spotify.
import { DatabaseSync } from "node:sqlite";
import { onRequest } from "../functions/api/[[path]].js";
const sql = new DatabaseSync(":memory:");
const norm = (v) => (v instanceof ArrayBuffer ? new Uint8Array(v) : v === undefined ? null : v);
const out = (row) => row && Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Uint8Array ? Array.from(v) : v]));
const stmt = (q, args = []) => ({
  bind: (...a) => stmt(q, a.map(norm)),
  first: async () => out(sql.prepare(q).get(...args)) ?? null,
  all: async () => ({ results: sql.prepare(q).all(...args).map(out) }),
  run: async () => { const r = sql.prepare(q).run(...args); return { meta: { changes: r.changes } }; },
});
const DB = { prepare: (q) => stmt(q), batch: async (list) => { const r = []; for (const s of list) r.push(await s.run()); return r; } };
const env = { DB, HP_ADMIN_EMAILS: "boss@hp.com", HP_INVITE_CODE: "HP2026", HP_PUBLIC_URL: "https://desk.example.com", TWILIO_ACCOUNT_SID: "AC_test", TWILIO_AUTH_TOKEN: "tok" };

/* ---------- fake Stripe ---------- */
const S = { products: [], prices: [], customers: [], sessions: [], subs: {}, hooks: [], calls: [], meters: [], events: [] };
let n = 0; const id = (p) => p + "_" + ++n;
const flat = (body) => Object.fromEntries(new URLSearchParams(String(body || "")));
const priceObj = (pid) => S.prices.find((p) => p.id === pid);
const subObj = (s) => ({ id: s.id, object: "subscription", status: s.status, customer: s.customer, metadata: s.metadata, current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400, items: { data: [{ id: s.item, price: priceObj(s.price) }, ...(s.extra || []).map((x) => ({ id: x.id, price: priceObj(x.price) }))] } });
function stripe(u, o) {
  const p = u.pathname.replace(/^\/v1\//, ""), b = flat(o.body), m = o.method || "GET";
  S.calls.push([m, p, b]);
  if (p === "prices" && m === "GET") { const key = u.searchParams.get("lookup_keys[0]"); return { data: S.prices.filter((x) => x.lookup_key === key && x.active) }; }
  if (p === "products") { const x = { id: id("prod"), name: b.name }; S.products.push(x); return x; }
  if (p === "prices") { if (b.transfer_lookup_key) S.prices.forEach((x) => { if (x.lookup_key === b.lookup_key) x.lookup_key = null; }); const x = { id: id("price"), product: b.product, unit_amount: +b.unit_amount, currency: b.currency, lookup_key: b.lookup_key, active: true, recurring: { interval: b["recurring[interval]"], usage_type: b["recurring[usage_type]"] || "licensed", meter: b["recurring[meter]"] }, tiers: b["tiers[0][up_to]"] ? [{ up_to: b["tiers[0][up_to]"], unit_amount: b["tiers[0][unit_amount]"] }, { up_to: b["tiers[1][up_to]"], unit_amount_decimal: b["tiers[1][unit_amount_decimal]"] }] : null, unit_amount_decimal: b.unit_amount_decimal, metadata: { hp_plan: b["metadata[hp_plan]"], hp_kind: b["metadata[hp_kind]"], hp_minutes: b["metadata[hp_minutes]"], hp_rate: b["metadata[hp_rate]"] } }; S.prices.push(x); return x; }
  if (p === "billing/meters" && m === "GET") return { data: S.meters };
  if (p === "billing/meters") { const x = { id: id("mtr"), event_name: b.event_name, b }; S.meters.push(x); return x; }
  if (p === "billing/meter_events") { S.events.push(b); return { event_name: b.event_name }; }
  const si = p.match(/^subscription_items\/(.+)$/); if (si && m === "DELETE") { for (const s of Object.values(S.subs)) s.extra = (s.extra || []).filter((x) => x.id !== si[1]); return { deleted: true }; }
  if (p === "webhook_endpoints") { const x = { id: id("we"), secret: "whsec_test", url: b.url }; S.hooks.push(x); return x; }
  if (p === "customers") { const x = { id: id("cus"), email: b.email }; S.customers.push(x); return x; }
  if (p === "checkout/sessions") { const x = { id: id("cs"), url: "https://checkout.stripe.test/" + n, ...b }; S.sessions.push(x); return x; }
  if (p === "billing_portal/sessions") return { url: "https://billing.stripe.test/portal" };
  if (p === "subscriptions" && m === "GET") { const c = u.searchParams.get("customer"); return { data: Object.values(S.subs).filter((s) => s.customer === c).map(subObj) }; }
  const sm = p.match(/^subscriptions\/(.+)$/);
  if (sm) {
    const s = S.subs[sm[1]];
    if (m === "POST") {
      for (let i = 0; b[`items[${i}][price]`] || b[`items[${i}][id]`]; i++) {
        const iid = b[`items[${i}][id]`], pr = b[`items[${i}][price]`], del = b[`items[${i}][deleted]`] === "true";
        if (iid === s.item) { if (pr) s.price = pr; continue; }
        s.extra = s.extra || [];
        const ex = s.extra.find((x) => x.id === iid);
        if (ex && del) s.extra = s.extra.filter((x) => x !== ex); else if (ex) ex.price = pr; else if (!iid) s.extra.push({ id: id("si"), price: pr });
      }
      s.proration = b.proration_behavior; if (b["metadata[hp_plan]"]) s.metadata.hp_plan = b["metadata[hp_plan]"];
    }
    return subObj(s);
  }
  return {};
}
/* ---------- fake Spotify ---------- */
const SP = { me: { id: "sp1", display_name: "Rep's Spotify" }, meStatus: 200, refreshes: 0 };
function spotify(u, o) {
  const b = flat(o.body);
  if (u.host === "accounts.spotify.com" && u.pathname === "/api/token") {
    if (!/^Basic /.test(o.headers?.authorization || "")) return [{ error: "invalid_client" }, 401];
    if (b.grant_type === "authorization_code") return b.code === "good" && b.redirect_uri === "https://desk.example.com/api/spotify/callback" ? [{ access_token: "AT1", refresh_token: "RT1", expires_in: 3600 }] : [{ error: "invalid_grant" }, 400];
    if (b.grant_type === "refresh_token") { SP.refreshes++; return b.refresh_token === "RT1" ? [{ access_token: "AT" + (1 + SP.refreshes), expires_in: 3600 }] : [{ error: "invalid_grant" }, 400]; }
  }
  if (u.host === "api.spotify.com" && u.pathname === "/v1/me") return [SP.meStatus === 200 ? SP.me : { error: { status: 403, message: "User not registered in the Developer Dashboard" } }, SP.meStatus];
  return [{}, 404];
}
globalThis.fetch = async (url, o = {}) => {
  const u = new URL(url), J = (j, s = 200) => new Response(JSON.stringify(j), { status: s, headers: { "content-type": "application/json" } });
  if (u.host === "api.stripe.com") return J(stripe(u, o));
  if (/spotify\.com$/.test(u.host)) { const [j, s] = spotify(u, o); return J(j, s); }
  if (u.host === "api.anthropic.com") return J({ content: [{ type: "text", text: "hi" }] });
  return J({});
};

const jars = {};
async function call(who, path, { method = "GET", body, headers = {}, raw } = {}) {
  const h = { ...headers }; if (jars[who]) h.cookie = jars[who];
  let b = raw; if (body !== undefined) { b = JSON.stringify(body); h["content-type"] = "application/json"; }
  const r = await onRequest({ request: new Request("https://desk.example.com" + path, { method, headers: h, body: b, redirect: "manual" }), env, waitUntil: () => {} });
  const sc = r.headers.get("set-cookie"); if (sc) jars[who] = sc.split(";")[0];
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { s: r.status, j, loc: r.headers.get("location") };
}
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) process.exitCode = 1; };
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
async function webhook(ev, secret = "whsec_test") {
  const raw = JSON.stringify(ev), t = Math.floor(Date.now() / 1000);
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${t}.${raw}`)));
  return call("stripe", "/api/billing/webhook", { method: "POST", raw, headers: { "stripe-signature": `t=${t},v1=${sig}` } });
}
// Stripe finishing a checkout: make the subscription, then send the webhook
async function complete(who) {
  const sess = S.sessions[S.sessions.length - 1], sid = id("sub");
  S.subs[sid] = { id: sid, status: "active", customer: sess.customer, price: sess["line_items[0][price]"], item: id("si"), extra: sess["line_items[1][price]"] ? [{ id: id("si"), price: sess["line_items[1][price]"] }] : [], metadata: { hp_user: sess["subscription_data[metadata][hp_user]"], hp_plan: sess["subscription_data[metadata][hp_plan]"] } };
  return webhook({ type: "checkout.session.completed", data: { object: { subscription: sid, customer: sess.customer, client_reference_id: sess.client_reference_id } } });
}
const me = async (who) => (await call(who, "/api/auth/me")).j.user;

// ---------- accounts and plans with billing off ----------
await call("boss", "/api/auth/signup", { method: "POST", body: { email: "boss@hp.com", password: "password2", name: "Boss" } });
await call("rep", "/api/auth/signup", { method: "POST", body: { email: "rep@hp.com", password: "password1", name: "Rep One", invite: "HP2026", agree: true } });
let u = await me("rep");
ok(u.plan === "full" && u.access.ok && u.access.features.length === 10 && u.access.dialer, "new agents start on Full Access while billing is off (nobody loses anything)");
let r = await call("boss", "/api/team/settings");
ok(r.j.prices.early === 40 && r.j.prices.base === 50 && r.j.prices.plus === 75 && r.j.prices.full === 150, "prices: Early Access $40, Base $50, Pro $75, Full Access $150");
ok(r.j.earlyOpen === true && r.j.plans.find((p) => p.key === "early").available, "early access is open");
const P = Object.fromEntries(r.j.plans.map((p) => [p.key, p]));
ok(JSON.stringify(P.base.features) === JSON.stringify(["crm", "clients", "quoter", "screen", "scripts"]), "Base: CRM, clients, quoter, screener, scripts");
ok(P.plus.features.includes("bot") && P.plus.features.includes("iul") && !P.plus.features.includes("dialer"), "Pro adds Highpoint Bot and the IUL illustrator");
ok(P.full.features.length === 10 && P.early.features.length === 10, "Full Access and Early Access include everything");
// old plan names keep working
sql.prepare("UPDATE members SET plan='pro' WHERE user_id=(SELECT id FROM users WHERE email='rep@hp.com')").run();
u = await me("rep"); ok(u.plan === "full" && u.access.dialer, "an agent on the old Pro plan (with the dialer) counts as Full Access");
sql.prepare("UPDATE members SET plan='starter' WHERE user_id=(SELECT id FROM users WHERE email='rep@hp.com')").run();
await call("boss", "/api/team/member", { method: "POST", body: { id: u.id, comp: false } }); // clears the 30s user cache
u = await me("rep"); ok(u.plan === "base" && !u.access.dialer, "the old Starter counts as Base");
// features enforced on the server
r = await call("rep", "/api/ai", { method: "POST", body: { messages: [{ role: "user", content: "hi" }] } });
ok(r.s === 402 && /Highpoint Bot is part of Pro and Full Access/.test(r.j.error) && r.j.feature === "bot", "Base can't use Highpoint Bot: " + r.j.error);
r = await call("rep", "/api/dialer/token"); ok(r.s === 402 && /Full Access/.test(r.j.error), "or the dialer: " + r.j.error);
r = await call("rep", "/api/spotify/status"); ok(r.s === 402, "or Spotify");
r = await call("rep", "/api/docs/leads"); ok(r.s === 200, "the CRM works on Base");
await call("boss", "/api/team/member", { method: "POST", body: { id: u.id, plan: "plus" } });
r = await call("rep", "/api/ai", { method: "POST", body: { messages: [{ role: "user", content: "hi" }] } }); ok(r.s === 503, "on Pro the bot is allowed (503 only because no AI key here)");
r = await call("rep", "/api/dialer/token"); ok(r.s === 402, "Pro still has no dialer");
// admins can change what Base and Pro include
r = await call("boss", "/api/team/settings", { method: "POST", body: { features: { base: ["crm", "clients", "quoter", "screen", "scripts", "crew"], plus: ["crm", "clients", "quoter", "screen", "scripts", "bot", "iul", "crew", "music", "nonsense"] } } });
ok(r.j.features.base.includes("crew") && !r.j.features.plus.includes("nonsense"), "admins can add features to Base and Pro");
u = await me("rep"); ok(u.access.features.includes("music"), "and agents get them");
r = await call("rep", "/api/team/settings", { method: "POST", body: { features: { base: [] } } }); ok(r.s === 403, "agents can't change plans");

// ---------- Stripe ----------
r = await call("boss", "/api/team/settings", { method: "POST", body: { required: true } }); ok(r.s === 400, "payment can't be required before Stripe is connected");
env.STRIPE_SECRET_KEY = "sk_test_123";
r = await call("boss", "/api/team/settings", { method: "POST", body: { required: true } }); ok(r.s === 200 && r.j.required && r.j.testMode, "with Stripe connected, admins require payment");
r = await call("rep", "/api/docs/leads"); ok(r.s === 402, "an agent without a subscription is asked to choose a plan");
r = await call("rep", "/api/billing/status"); ok(r.s === 200 && r.j.plans.length === 4 && r.j.earlyOpen, "the plan screen gets every plan");
r = await call("rep", "/api/billing/checkout", { method: "POST", body: { plan: "early" } });
const ses = S.sessions[S.sessions.length - 1], pr = S.prices.find((p) => p.id === ses["line_items[0][price]"]);
ok(r.s === 200 && /^https:\/\/checkout\.stripe\.test/.test(r.j.url), "checkout opens for Early Access");
ok(pr.unit_amount === 4000 && pr.lookup_key === "hp_early_monthly" && S.products.some((p) => p.name === "Highpoint Early Access"), "Stripe gets a $40/month Early Access price, made automatically");
ok(ses["subscription_data[trial_period_days]"] === "7" && ses.allow_promotion_codes === "true", "with the free trial and promo codes");
ok(S.hooks.length === 1 && S.hooks[0].url === "https://desk.example.com/api/billing/webhook", "the payment webhook connects itself");
r = await webhook({ type: "checkout.session.completed", data: { object: {} } }, "whsec_wrong"); ok(r.s === 400, "a webhook with a bad signature is refused");
r = await complete("rep"); ok(r.s === 200, "Stripe's webhook is accepted");
u = await me("rep"); ok(u.access.ok && u.plan === "early" && u.access.features.length === 10, "after paying, Early Access opens everything");
// switch plans in place
r = await call("rep", "/api/billing/change", { method: "POST", body: { plan: "plus" } });
const subId = Object.keys(S.subs)[0];
ok(r.s === 200 && r.j.plan === "plus" && S.subs[subId].proration === "create_prorations" && S.prices.find((p) => p.id === S.subs[subId].price).unit_amount === 7500, "switching to Pro changes the same subscription to $75 (prorated)");
u = await me("rep"); ok(u.plan === "plus" && !u.access.dialer, "and the dialer turns off");
r = await call("rep", "/api/billing/checkout", { method: "POST", body: { plan: "full" } });
ok(r.s === 200 && r.j.changed && S.prices.find((p) => p.id === S.subs[subId].price).unit_amount === 15000, "checkout while subscribed switches plans instead of a second subscription");
r = await call("rep", "/api/billing/portal", { method: "POST", body: {} }); ok(/portal/.test(r.j.url), "Manage billing opens Stripe's portal");
// failed payment
S.subs[subId].status = "past_due";
await webhook({ type: "customer.subscription.updated", data: { object: { ...S.subs[subId], items: { data: [{ id: S.subs[subId].item, price: S.prices.find((p) => p.id === S.subs[subId].price) }] } } } });
await call("boss", "/api/team/member", { method: "POST", body: { id: u.id, comp: false } });
r = await call("rep", "/api/docs/leads"); ok(r.s === 402 && /payment didn't go through/.test(r.j.error), "a failed payment asks for a new card");
S.subs[subId].status = "active";
await webhook({ type: "customer.subscription.updated", data: { object: { id: subId, status: "active", customer: S.subs[subId].customer, metadata: {}, items: { data: [{ id: S.subs[subId].item, price: S.prices.find((p) => p.id === S.subs[subId].price) }] } } } });
await call("boss", "/api/team/member", { method: "POST", body: { id: u.id, comp: false } });
r = await call("rep", "/api/docs/leads"); ok(r.s === 200, "and access comes back when it's paid");

// ---------- ending early access ----------
await call("rep2", "/api/auth/signup", { method: "POST", body: { email: "rep2@hp.com", password: "password1", name: "Rep Two", invite: "HP2026", agree: true } });
await call("rep2", "/api/billing/checkout", { method: "POST", body: { plan: "early" } }); await complete("rep2");
u = await me("rep2"); ok(u.plan === "early" && u.access.ok, "a second agent joins on Early Access");
r = await call("boss", "/api/team/settings"); ok(r.j.earlyMembers === 1, "admins see how many are on Early Access");
r = await call("boss", "/api/team/early-end", { method: "POST", body: { moveTo: "nope" } }); ok(r.s === 400, "ending early access needs a plan to move them to");
r = await call("boss", "/api/team/early-end", { method: "POST", body: { moveTo: "full" } });
const sub2 = S.subs[Object.keys(S.subs)[1]];
ok(r.s === 200 && r.j.moved === 1 && !r.j.failed.length, "ending early access moves them: " + JSON.stringify(r.j));
ok(S.prices.find((p) => p.id === sub2.price).unit_amount === 15000 && sub2.proration === "none", "to Full Access from their next renewal (no extra charge now)");
u = await me("rep2"); ok(u.plan === "full", "and their plan reads Full Access");
r = await call("boss", "/api/team/settings"); ok(!r.j.earlyOpen && !r.j.plans.find((p) => p.key === "early").available, "Early Access is closed");
await call("rep3", "/api/auth/signup", { method: "POST", body: { email: "rep3@hp.com", password: "password1", name: "Rep Three", invite: "HP2026", agree: true } });
r = await call("rep3", "/api/billing/checkout", { method: "POST", body: { plan: "early" } }); ok(r.s === 400 && /ended/.test(r.j.error), "new agents can't pick Early Access anymore");
r = await call("rep3", "/api/billing/checkout", { method: "POST", body: { plan: "base" } }); ok(r.s === 200 && S.prices.some((p) => p.lookup_key === "hp_base_monthly" && p.unit_amount === 5000), "Base checks out at $50");
// price changes make a new price
await call("boss", "/api/team/settings", { method: "POST", body: { prices: { early: 40, base: 55, plus: 75, full: 150 } } });
await call("rep3", "/api/billing/checkout", { method: "POST", body: { plan: "base" } });
ok(S.prices.filter((p) => p.lookup_key === "hp_base_monthly").length === 1 && S.prices.find((p) => p.lookup_key === "hp_base_monthly").unit_amount === 5500, "a new Base price moves the lookup key to $55");

// ---------- dialer minutes ----------
const { aggregate } = await import("../src/lib/hp.mjs");
r = await call("boss", "/api/team/settings");
ok(r.j.minutes.full === 2000 && r.j.minutes.early === 1000 && r.j.minutes.base === null && r.j.overage.on === false, "plans include dialer minutes: Full Access 2,000 and Early Access 1,000 a month");
const repMe = await me("rep");
r = await call("rep", "/api/billing/status");
ok(r.j.minutes.included === 2000 && r.j.minutes.used === 0 && r.j.minutes.overage === null, "an agent sees their minutes: 0 of 2,000");
await call("boss", "/api/team/settings", { method: "POST", body: { minutes: { early: 1000, base: "", plus: "", full: 3 } } });
r = await call("boss", "/api/dialer/setup", { method: "PUT", body: { settings: { quietHours: { start: 0, end: 24 } } } }); // calling hours depend on the clock; open the window for the test
const callEnd = (sec, i) => aggregate({ id: "call" + i, agent: repMe.identity, talkSec: sec, answered: true, human: true, at: Date.now(), endedAt: Date.now() }, "end");
await callEnd(61, 1); // 2 minutes (rounded up)
r = await call("rep", "/api/billing/status"); ok(r.j.minutes.used === 2, "each call counts rounded up to the minute (61 seconds = 2)");
r = await call("rep", "/api/dialer/calls/check", { method: "POST", body: { to: "2125550123", leadState: "NY" } });
ok(r.j.ok !== false, "under the limit, calls go through");
await callEnd(30, 2); // 3 of 3
r = await call("rep", "/api/dialer/calls/check", { method: "POST", body: { to: "2125550123", leadState: "NY" } });
ok(r.j.ok === false && /used all 3 dialer minutes/.test(r.j.why), "at the limit, dialing stops with a clear reason: " + r.j.why);
r = await call("boss", "/api/dialer/calls/check", { method: "POST", body: { to: "2125550123", leadState: "NY" } });
ok(r.j.ok !== false, "admins are never limited");
// overage: keep dialing, Stripe bills the extra minutes
r = await call("boss", "/api/team/settings", { method: "POST", body: { overage: { on: true, rate: 0.05 } } });
ok(r.j.overage.on && r.j.overage.rate === 0.05, "admins can bill extra minutes instead ($0.05 each)");
const meter = S.meters[0], mp = S.prices.find((p) => p.lookup_key === "hp_full_minutes");
ok(meter && meter.event_name === "hp_dialer_minutes" && meter.b["default_aggregation[formula]"] === "sum", "Stripe gets a dialer-minutes meter");
ok(mp && mp.recurring.usage_type === "metered" && mp.recurring.meter === meter.id && mp.tiers?.[0].up_to === "3" && mp.tiers[0].unit_amount === "0" && mp.tiers[1].unit_amount_decimal === "5", "and a price where the plan's minutes are free and the rest cost 5¢");
const repSub = Object.values(S.subs).find((x) => x.customer === S.customers[0].id);
ok(repSub.extra?.some((x) => x.price === mp.id), "existing subscribers get the minutes price added");
r = await call("rep", "/api/dialer/calls/check", { method: "POST", body: { to: "2125550123", leadState: "NY" } });
ok(r.j.ok !== false, "with overage on, the agent keeps dialing past the limit");
r = await call("rep", "/api/billing/status"); ok(r.j.minutes.overage === 0.05, "and sees the per-minute rate");
await callEnd(125, 3);
const ev = S.events[S.events.length - 1];
ok(ev && ev.event_name === "hp_dialer_minutes" && ev["payload[stripe_customer_id]"] === repSub.customer && ev["payload[value]"] === "3" && ev.identifier === "hpcall_call3", "each call's minutes are reported to Stripe (125 seconds = 3)");
// switching plans swaps the minutes price too
await call("rep", "/api/billing/change", { method: "POST", body: { plan: "plus" } });
ok(!repSub.extra?.length, "a plan without the dialer drops the minutes price");
await call("rep", "/api/billing/change", { method: "POST", body: { plan: "full" } });
ok(repSub.extra?.length === 1 && priceObj(repSub.extra[0].price).lookup_key === "hp_full_minutes", "and switching back adds it again");
r = await call("rep4", "/api/auth/signup", { method: "POST", body: { email: "rep4@hp.com", password: "password1", name: "Rep Four", invite: "HP2026", agree: true } });
await call("rep4", "/api/billing/checkout", { method: "POST", body: { plan: "full" } });
const s4 = S.sessions[S.sessions.length - 1];
ok(s4["line_items[1][price]"] === mp.id && s4["line_items[1][quantity]"] === undefined, "new checkouts include the minutes price (no quantity, it's metered)");
await call("boss", "/api/team/settings", { method: "POST", body: { overage: { on: false }, minutes: { early: 1000, full: 2000 } } });
ok(!repSub.extra?.length, "turning overage off takes the minutes price off");

// ---------- Spotify, one account per login ----------
r = await call("boss", "/api/spotify/status"); ok(r.s === 200 && !r.j.configured && !r.j.connected, "Spotify shows as not set up until the admin adds the app keys");
r = await call("boss", "/api/spotify/login"); ok(r.s === 302 && r.loc === "/?spotify=off", "connecting without app keys explains instead of failing");
env.SPOTIFY_CLIENT_ID = "cid123"; env.SPOTIFY_CLIENT_SECRET = "csecret456";
r = await call("boss", "/api/spotify/login");
const auth = new URL(r.loc); const state = auth.searchParams.get("state");
ok(r.s === 302 && auth.host === "accounts.spotify.com" && auth.searchParams.get("redirect_uri") === "https://desk.example.com/api/spotify/callback" && /streaming/.test(auth.searchParams.get("scope")), "Connect Spotify sends the agent to Spotify's login");
r = await call("rep2", `/api/spotify/callback?code=good&state=${encodeURIComponent(state)}`); ok(r.loc === "/?spotify=error", "another login can't finish someone else's connection");
r = await call("boss", `/api/spotify/callback?code=good&state=${encodeURIComponent(state.replace(/.$/, (c) => (c === "A" ? "B" : "A")))}`); ok(r.loc === "/?spotify=error", "a tampered state is refused");
SP.meStatus = 403;
r = await call("boss", `/api/spotify/callback?code=good&state=${encodeURIComponent(state)}`); ok(r.loc === "/?spotify=notallowed", "someone the Spotify app doesn't allow yet gets told why");
SP.meStatus = 200;
r = await call("boss", `/api/spotify/callback?code=good&state=${encodeURIComponent(state)}`); ok(r.loc === "/?spotify=connected", "the agent comes back connected");
r = await call("boss", "/api/spotify/status"); ok(r.j.connected && r.j.name === "Rep's Spotify" && r.j.product === null, "status shows their Spotify name (Premium is checked in the browser)");
const stored = JSON.stringify(sql.prepare("SELECT * FROM blobs").all?.() || []);
ok(!/RT1|AT1/.test(stored), "Spotify tokens are stored encrypted");
r = await call("boss", "/api/spotify/token"); ok(r.j.access_token === "AT1", "the browser gets a short-lived token");
r = await call("rep2", "/api/spotify/token"); ok(r.s === 401 && r.j.code === "relink", "each login has its own Spotify (another agent isn't connected)");
r = await call("boss", "/api/spotify/product", { method: "POST", body: { product: "premium" } }); ok(r.j.product === "premium", "Premium is saved once the player confirms it");
r = await call("boss", "/api/spotify/prefs", { method: "POST", body: { uri: "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M", autoPause: false } });
ok(r.j.prefs.uri === "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M" && r.j.prefs.autoPause === false, "music settings follow the login");
r = await call("boss", "/api/spotify/prefs", { method: "POST", body: { uri: "javascript:alert(1)" } }); ok(!r.j.prefs.uri, "only real Spotify links are saved");
r = await call("boss", "/api/spotify/disconnect", { method: "POST", body: {} }); r = await call("boss", "/api/spotify/status");
ok(!r.j.connected && r.j.prefs.autoPause === false, "Disconnect forgets the account but keeps the settings");
console.log(process.exitCode ? "SOME FAILED" : "ALL PASSED");
