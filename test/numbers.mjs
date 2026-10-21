// Agents buying their own phone numbers: card on file, the monthly charge, the Telnyx order, refunds and releasing.
// Runs locally with an in-memory D1 and the fake Stripe + Telnyx in test/fake-pay.mjs (no real charges or orders).
import { DatabaseSync } from "node:sqlite";
import { onRequest } from "../functions/api/[[path]].js";
import { installFakes, completeCheckout, lastSession } from "./fake-pay.mjs";
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
const env = { DB, HP_ADMIN_EMAILS: "boss@hp.com", HP_INVITE_CODE: "HP2026", HP_PUBLIC_URL: "https://desk.example.com", TELNYX_API_KEY: "KEY_test" };
const F = installFakes(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));

const jars = {};
async function call(who, path, { method = "GET", body, headers = {}, raw } = {}) {
  const h = { ...headers }; if (jars[who]) h.cookie = jars[who];
  let b = raw; if (body !== undefined) { b = JSON.stringify(body); h["content-type"] = "application/json"; }
  const r = await onRequest({ request: new Request("https://desk.example.com" + path, { method, headers: h, body: b }), env, waitUntil: () => {} });
  const sc = r.headers.get("set-cookie"); if (sc) jars[who] = sc.split(";")[0];
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { s: r.status, j };
}
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) process.exitCode = 1; };
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
async function webhook(ev, secret = "whsec_test") {
  const raw = JSON.stringify(ev), t = Math.floor(Date.now() / 1000);
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${t}.${raw}`)));
  return call("stripe", "/api/billing/webhook", { method: "POST", raw, headers: { "stripe-signature": `t=${t},v1=${sig}` } });
}
const count = (list, m, p) => list.filter((x) => x[0] === m && (typeof p === "string" ? x[1] === p : p.test(x[1]))).length;
const orders = () => F.telnyx.filter((x) => x[0] === "POST" && x[1] === "/v2/number_orders");
const numSubs = () => Object.values(F.subs).filter((s) => s.metadata.hp_kind === "number");

await call("boss", "/api/auth/signup", { method: "POST", body: { email: "boss@hp.com", password: "password2", name: "Boss" } });
await call("rep", "/api/auth/signup", { method: "POST", body: { email: "rep@hp.com", password: "password1", name: "Rep One", invite: "HP2026", agree: true } });
await call("rep2", "/api/auth/signup", { method: "POST", body: { email: "rep2@hp.com", password: "password1", name: "Rep Two", invite: "HP2026", agree: true } });
let r = await call("boss", "/api/dialer/setup", { method: "POST" }); ok(r.s === 200 && r.j.ok, "admin connects Telnyx");

// ---------- without Stripe: unchanged (the team's Telnyx account pays) ----------
r = await call("rep", "/api/dialer/numbers"); ok(r.s === 200 && r.j.buy.charged === false && r.j.buy.allowed, "without Stripe connected, agents aren't charged for numbers");

// ---------- with Stripe ----------
env.STRIPE_SECRET_KEY = "sk_test_123";
r = await call("rep", "/api/dialer/numbers"); ok(r.j.buy.charged && r.j.buy.price === 2 && r.j.buy.card === null, "with Stripe, an agent sees numbers cost $2.00/month and that no card is on file");
r = await call("boss", "/api/dialer/numbers"); ok(r.j.buy.charged === false, "admins are never charged");
r = await call("rep", "/api/dialer/numbers/search?areaCode=305"); ok(r.s === 200 && r.j.results.length === 6 && r.j.results[0].e164 === "+13055550142", "an agent searches an area code");
r = await call("rep", "/api/dialer/numbers/search?areaCode=999"); ok(r.s === 200 && r.j.results.length === 0, "an area code with nothing available returns no results (not an error)");

// no card → must add one; nothing charged, nothing ordered
r = await call("rep", "/api/dialer/numbers/buy", { method: "POST", body: { phoneNumber: "+13055550142", price: 2 } });
ok(r.s === 402 && r.j.code === "card_needed" && /Add a card/.test(r.j.error), "no card on file: buying asks for a card first");
ok(numSubs().length === 0 && orders().length === 0, "and nothing is charged or ordered");

// add a card (Stripe Checkout, setup mode)
r = await call("rep", "/api/billing/card", { method: "POST", body: { next: "numbers" } });
let ses = lastSession();
ok(r.s === 200 && r.j.url === ses.url && ses.mode === "setup" && ses.body["payment_method_types[0]"] === "card", "Add card opens Stripe Checkout in setup mode");
ok(ses.success_url === "https://desk.example.com/?card=saved&next=numbers" && ses.customer && F.customers[ses.customer].metadata.hp_user, "on the agent's own Stripe customer, returning to their numbers");
ok(F.hooks.length === 1, "the Stripe webhook is connected if it wasn't yet");
r = await call("rep", "/api/billing/card"); ok(r.j.card === null, "the card isn't saved until Stripe finishes");
completeCheckout(ses.id, "ok");
r = await call("rep", "/api/billing/card"); ok(r.j.card?.brand === "Visa" && r.j.card.last4 === "4242" && r.j.card.exp === "12/30", "after Stripe, the card shows as Visa •••• 4242 (no waiting on the webhook)");
ok(F.customers[ses.customer].invoice_settings.default_payment_method, "and becomes the customer's default card");
r = await call("rep", "/api/billing/status"); ok(r.j.card?.last4 === "4242", "Billing shows the card too");
r = await call("rep2", "/api/billing/card"); ok(r.j.card === null, "another agent doesn't see it");

// the price they saw must match
r = await call("rep", "/api/dialer/numbers/buy", { method: "POST", body: { phoneNumber: "+13055550142" } });
ok(r.s === 409 && r.j.code === "price_changed" && r.j.price === 2 && numSubs().length === 0, "buying without confirming the price is refused, nothing charged");

// card ok → charge → order
const before = F.seq.length;
r = await call("rep", "/api/dialer/numbers/buy", { method: "POST", body: { phoneNumber: "+13055550142", price: 2 } });
const sub = numSubs()[0];
ok(r.s === 200 && r.j.ok && r.j.charged === 2 && r.j.number.billing.price === 2, "card on file: the agent buys the number");
ok(sub && sub.status === "active" && sub.items.data[0].price.unit_amount === 200 && sub.items.data[0].price.recurring.interval === "month" && sub.body.payment_behavior === "error_if_incomplete" && sub.metadata.hp_number === "+13055550142", "they're charged $2.00 now on a monthly subscription for that number");
const seq = F.seq.slice(before), subAt = seq.indexOf("stripe POST subscriptions"), ordAt = seq.indexOf("telnyx POST /v2/number_orders");
ok(subAt >= 0 && ordAt > subAt && orders().length === 1, "the charge happens before Telnyx is asked for the number");
ok(orders()[0][2].connection_id === "app1" && F.telnyx.some((x) => x[0] === "PATCH" && /\/messaging$/.test(x[1]) && x[2].messaging_profile_id), "the number is wired like every other number (inbound app and texting profile)");
r = await call("rep", "/api/dialer/numbers");
let mine = r.j.numbers.find((x) => x.e164 === "+13055550142");
ok(mine?.mine && mine.billing?.price === 2 && !mine.billing.sub && r.j.buy.card.last4 === "4242", "it shows under Your numbers as theirs, at $2.00/month");
r = await call("rep2", "/api/dialer/numbers"); ok(!r.j.numbers.some((x) => x.e164 === "+13055550142"), "teammates don't see another agent's own number");
const H = await import("../src/lib/hp.mjs");
const repMe = (await call("rep", "/api/auth/me")).j.user;
const cfg = await H.config();
const pick = await H.pickCallerId(repMe, "3055551234", cfg.settings);
ok(pick?.e164 === "+13055550142", "and it's their caller ID for calls in that area code");

// order fails → refund
r = await call("rep", "/api/dialer/numbers/buy", { method: "POST", body: { phoneNumber: "+13055550000", price: 2 } });
const failed = numSubs().find((s) => s.metadata.hp_number === "+13055550000");
ok(r.s === 502 && r.j.code === "order_failed" && r.j.refunded && /refunded/.test(r.j.error) && /no longer available/.test(r.j.error), "if Telnyx can't order it, the agent is told and refunded: " + r.j.error);
ok(failed?.status === "canceled" && F.refunds.length === 1 && F.refunds[0].payment_intent === F.invoices[failed.latest_invoice.id].payment_intent, "the subscription is canceled and the $2.00 payment refunded");
r = await call("rep", "/api/dialer/numbers"); ok(!r.j.numbers.some((x) => x.e164 === "+13055550000"), "and the number isn't added");

// declined card
r = await call("rep", "/api/billing/card", { method: "POST", body: { next: "billing" } });
ses = lastSession(); ok(ses.success_url.endsWith("next=billing") && ses.customer === sub.customer, "Replace card reuses the same Stripe customer");
completeCheckout(ses.id, "decline");
r = await call("rep", "/api/billing/card"); ok(r.j.card?.last4 === "0002", "the new card replaces the old one");
const ordersBefore = orders().length;
r = await call("rep", "/api/dialer/numbers/buy", { method: "POST", body: { phoneNumber: "+13055550188", price: 2 } });
ok(r.s === 402 && r.j.code === "card_declined" && /declined/.test(r.j.error) && /Nothing was charged/.test(r.j.error), "a declined card stops the purchase: " + r.j.error);
ok(orders().length === ordersBefore && !numSubs().some((s) => s.metadata.hp_number === "+13055550188"), "and no number is ordered");
completeCheckout((await call("rep", "/api/billing/card", { method: "POST", body: {} }), lastSession()).id, "ok");

// team rules
r = await call("boss", "/api/dialer/setup", { method: "PUT", body: { settings: { agentMaxNumbers: 0 } } });
r = await call("rep", "/api/dialer/numbers"); ok(r.j.buy.allowed === true && r.j.settings.agentMaxNumbers === 5, "a limit of 0 can't lock agents out: they keep the default limit of 5 and can buy their own numbers");
await call("boss", "/api/dialer/setup", { method: "PUT", body: { settings: { agentMaxNumbers: 1 } } });
r = await call("rep", "/api/dialer/numbers/buy", { method: "POST", body: { phoneNumber: "+13055550188", price: 2 } });
ok(r.s === 403 && /up to 1/.test(r.j.error), "the per-agent number limit still applies");
await call("boss", "/api/dialer/setup", { method: "PUT", body: { settings: { agentMaxNumbers: 5 } } });
r = await call("rep", "/api/dialer/numbers/buy", { method: "POST", body: { phoneNumber: "+13055550142", price: 2 } }); ok(r.s === 409, "a number already on the team can't be bought twice");
r = await call("rep", "/api/dialer/numbers/update", { method: "POST", body: { e164: "+13055550142", owner: "hp_someone" } });
r = await call("rep", "/api/dialer/numbers"); ok(r.j.numbers.find((x) => x.e164 === "+13055550142")?.mine, "agents can't hand their number to someone else (admin-only)");
const subsBefore = numSubs().length;
r = await call("boss", "/api/dialer/numbers/buy", { method: "POST", body: { phoneNumber: "+13055554417" } });
ok(r.s === 200 && numSubs().length === subsBefore && !r.j.number.billing, "admins buy without a card or a charge");
r = await call("rep", "/api/team/settings", { method: "POST", body: { numbers: { price: 0.5 } } }); ok(r.s === 403, "agents can't change the number price");
r = await call("boss", "/api/team/settings", { method: "POST", body: { numbers: { price: 3.5 } } }); ok(r.j.numbers.price === 3.5 && r.j.numbers.charge === true, "admins set the monthly number price");
r = await call("rep", "/api/dialer/numbers"); ok(r.j.buy.price === 3.5, "agents see the new price");
r = await call("rep", "/api/dialer/numbers/buy", { method: "POST", body: { phoneNumber: "+13055550188", price: 2 } }); ok(r.s === 409 && r.j.code === "price_changed", "a purchase at the old price is refused");
r = await call("rep", "/api/dialer/numbers/buy", { method: "POST", body: { phoneNumber: "+13055550188", price: 3.5 } });
ok(r.s === 200 && numSubs().find((s) => s.metadata.hp_number === "+13055550188")?.items.data[0].price.unit_amount === 350, "and the next one is billed at $3.50");

// Stripe webhooks for a number's subscription
const s1 = numSubs().find((s) => s.metadata.hp_number === "+13055550142");
const mRow = () => sql.prepare("SELECT status, stripe_sub, plan FROM members WHERE user_id=?").get(repMe.id);
r = await webhook({ type: "customer.subscription.updated", data: { object: { ...s1, status: "past_due" } } });
let all = await H.getJ("numbers", "all");
ok(r.s === 200 && all["+13055550142"].paused && all["+13055550142"].payPaused && all["+13055550142"].billing.status === "past_due", "a failed monthly payment pauses that number");
ok(mRow().stripe_sub === null && mRow().status === "none", "and doesn't touch the agent's plan subscription");
r = await call("rep", "/api/dialer/numbers"); ok(r.j.numbers.find((x) => x.e164 === "+13055550142").billing.status === "past_due", "the agent sees the payment problem on the number");
await webhook({ type: "customer.subscription.updated", data: { object: { ...s1, status: "active" } } });
all = await H.getJ("numbers", "all"); ok(!all["+13055550142"].paused && !all["+13055550142"].payPaused, "paying again turns it back on");
r = await webhook({ type: "customer.subscription.updated", data: { object: { ...s1, status: "past_due" } } }, "whsec_wrong"); ok(r.s === 400, "webhooks with a bad signature are refused");
// card saved through the webhook (agent closed the tab before coming back)
await call("rep2", "/api/billing/card", { method: "POST", body: {} });
const s2 = completeCheckout(lastSession().id, "ok");
r = await webhook({ type: "checkout.session.completed", data: { object: { ...s2 } } });
ok(r.s === 200 && sql.prepare("SELECT txt FROM blobs WHERE store='hpd-team' AND key LIKE 'card:%'").all().length === 2, "the setup-complete webhook saves the card too");
r = await call("rep2", "/api/dialer/numbers"); ok(r.j.buy.card?.last4 === "4242", "so the agent can buy straight away");
r = await call("rep", "/api/billing/sync", { method: "POST", body: {} }); ok(r.s === 200 && mRow().stripe_sub === null, "billing sync ignores number subscriptions");

// releasing stops billing
r = await call("rep2", "/api/dialer/numbers/release", { method: "POST", body: { e164: "+13055550142" } }); ok(r.s === 403, "agents can't release someone else's number");
r = await call("rep", "/api/dialer/numbers/release", { method: "POST", body: { e164: "+13055550142" } });
ok(r.s === 200 && r.j.billingStopped && F.subs[s1.id].status === "canceled", "releasing their number cancels its monthly charge");
r = await call("rep", "/api/dialer/numbers"); ok(!r.j.numbers.some((x) => x.e164 === "+13055550142"), "and it's gone from Your numbers");
r = await call("boss", "/api/team/settings", { method: "POST", body: { numbers: { charge: false } } });
r = await call("rep", "/api/dialer/numbers"); ok(r.j.buy.charged === false, "admins can turn number charges off (the team's Telnyx account pays)");
console.log(process.exitCode ? "SOME FAILED" : "ALL PASSED");
