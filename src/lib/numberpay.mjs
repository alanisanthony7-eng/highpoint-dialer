// Agents paying for the phone numbers they buy themselves.
// Card on file: Stripe Checkout in setup mode saves a card on the agent's Stripe customer (the same customer as their plan).
// Each number is its own monthly Stripe subscription (metadata hp_kind=number). The first month is charged before Telnyx
// orders the number; if the order fails the subscription is canceled and that charge refunded. Releasing the number
// cancels its subscription. Admins never pay, and nothing is charged while Stripe isn't connected.
import { D1, getStore } from "./store.mjs";
import { stripe, site, billingSettings, ensureWebhook, member, addMember } from "./team.mjs";

const env = (k, d = "") => globalThis.__ENV?.[k] ?? d;
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const err = (status, msg, code) => Object.assign(new Error(msg), { status, ...(code ? { code } : {}) });
const kv = () => getStore("hpd-team");
const pretty = (e) => { const d = String(e).replace(/\D/g, "").slice(-10); return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`; };
const BAD = new Set(["past_due", "unpaid", "canceled", "incomplete_expired"]);

/* ---------- card on file ---------- */
const brandName = (b) => ({ visa: "Visa", mastercard: "Mastercard", amex: "Amex", discover: "Discover", diners: "Diners", jcb: "JCB", unionpay: "UnionPay" }[b] || (b ? b[0].toUpperCase() + b.slice(1) : "Card"));
export const publicCard = (c) => (c ? { brand: brandName(c.brand), last4: c.last4, exp: c.exp_month && c.exp_year ? `${String(c.exp_month).padStart(2, "0")}/${String(c.exp_year).slice(-2)}` : "" } : null);

async function ensureCustomer(user, m) {
  if (m?.stripe_customer) return m.stripe_customer;
  if (!m) await addMember(user.id, {});
  const c = (await stripe("customers", { method: "POST", body: { email: user.email, name: user.name, metadata: { hp_user: user.id } } })).id;
  await D1().prepare("UPDATE members SET stripe_customer=?2 WHERE user_id=?1").bind(user.id, c).run();
  return c;
}

// a finished setup-mode Checkout: make its card the customer's default and remember it (from the webhook or the return trip)
export async function finishCardSetup(session) {
  const uid = session.client_reference_id || session.metadata?.hp_user;
  if (!uid || session.status !== "complete" || !session.setup_intent) return null;
  const m = await member(uid);
  if (!m?.stripe_customer || m.stripe_customer !== session.customer) return null;
  const si = typeof session.setup_intent === "string" ? await stripe("setup_intents/" + session.setup_intent, { query: { expand: ["payment_method"] } }) : session.setup_intent;
  let pm = si.payment_method; if (typeof pm === "string") pm = await stripe("payment_methods/" + pm);
  if (!pm?.id) return null;
  await stripe("customers/" + m.stripe_customer, { method: "POST", body: { invoice_settings: { default_payment_method: pm.id } } });
  const card = { pm: pm.id, customer: m.stripe_customer, brand: pm.card?.brand || "", last4: pm.card?.last4 || "", exp_month: pm.card?.exp_month || null, exp_year: pm.card?.exp_year || null, at: Date.now() };
  await kv().setJSON("card:" + uid, card);
  await kv().delete("cardsetup:" + uid);
  return card;
}

// the agent's saved card; finishes a card they just added if Stripe's webhook hasn't arrived yet
export async function cardFull(uid) {
  if (!env("STRIPE_SECRET_KEY")) return null;
  const pending = await kv().get("cardsetup:" + uid, { type: "json" });
  if (pending?.id) {
    try {
      const s = await stripe("checkout/sessions/" + pending.id);
      if (s.status === "complete") { const c = await finishCardSetup(s); if (c) return c; }
      else if (s.status === "expired" || Date.now() - pending.at > 864e5) await kv().delete("cardsetup:" + uid);
    } catch (e) { console.error("card setup check failed", e.message); }
  }
  const card = await kv().get("card:" + uid, { type: "json" });
  const m = card && (await member(uid));
  return card && m?.stripe_customer === card.customer ? card : null;
}
export const cardOf = async (uid) => publicCard(await cardFull(uid));

// GET /api/billing/card → { card, connected }   POST /api/billing/card {next} → { url } (Stripe Checkout, setup mode)
export async function cardRoute(req, user, m) {
  if (req.method === "GET") return json({ card: await cardOf(user.id), connected: !!env("STRIPE_SECRET_KEY") });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!env("STRIPE_SECRET_KEY")) return json({ error: "Online payments aren't connected yet. Ask your Highpoint admin." }, 400);
  const b = await req.json().catch(() => ({}));
  const next = b.next === "numbers" ? "numbers" : "billing";
  await ensureWebhook();
  const customer = await ensureCustomer(user, m);
  const s = await stripe("checkout/sessions", { method: "POST", body: {
    mode: "setup", customer, client_reference_id: user.id, payment_method_types: ["card"], currency: "usd",
    metadata: { hp_user: user.id, hp_kind: "card" }, setup_intent_data: { metadata: { hp_user: user.id }, description: "Highpoint card on file" },
    success_url: `${site()}/?card=saved&next=${next}`, cancel_url: `${site()}/?card=canceled&next=${next}` } });
  await kv().setJSON("cardsetup:" + user.id, { id: s.id, at: Date.now() });
  return json({ url: s.url });
}

/* ---------- what a number costs this agent ---------- */
export async function numberTerms(user) {
  const settings = await billingSettings(), connected = !!env("STRIPE_SECRET_KEY");
  const charged = connected && !!settings.numbers.charge && !user.admin;
  return { charged, price: settings.numbers.price, connected, card: charged ? await cardFull(user.id) : null };
}
// one monthly price for numbers, found by lookup key; a new price is made when the amount changes
async function numberPrice(amount) {
  const cents = Math.round(amount * 100), lookup = "hp_number_monthly";
  const found = (await stripe("prices", { query: { lookup_keys: [lookup], active: true, limit: 1 } })).data?.[0];
  if (found && found.unit_amount === cents && found.currency === "usd") return found.id;
  const product = found?.product || (await stripe("products", { method: "POST", body: { name: "Highpoint phone number", metadata: { hp_kind: "number" } } })).id;
  return (await stripe("prices", { method: "POST", body: { product, currency: "usd", unit_amount: cents, recurring: { interval: "month" }, lookup_key: lookup, transfer_lookup_key: true, metadata: { hp_kind: "number" } } })).id;
}

// Charge the first month. Throws 402 (code card_declined) when the card doesn't go through; nothing is left behind.
export async function chargeNumber(user, e164, terms) {
  const card = terms.card;
  if (!card) throw err(402, "Add a card first. Your number is billed to it each month.", "card_needed");
  let sub;
  try {
    sub = await stripe("subscriptions", { method: "POST", body: {
      customer: card.customer, items: [{ price: await numberPrice(terms.price) }], default_payment_method: card.pm,
      payment_behavior: "error_if_incomplete", off_session: true, description: `Highpoint phone number ${pretty(e164)}`,
      metadata: { hp_kind: "number", hp_user: user.id, hp_number: e164 }, expand: ["latest_invoice"] } });
  } catch (e) {
    if (e.http === 402 || e.stripeCode === "card_declined") throw err(402, `${/declin|card/i.test(e.message) ? e.message.replace(/\.?$/, ".") : "Your card was declined."} Replace your card and try again. Nothing was charged.`, "card_declined");
    throw e;
  }
  if (sub.status !== "active" && sub.status !== "trialing") {
    await stripe("subscriptions/" + sub.id, { method: "DELETE" }).catch(() => {});
    throw err(402, "Your card couldn't be charged. Replace your card and try again. Nothing was charged.", "card_declined");
  }
  return sub;
}

// The Telnyx order failed after we charged: cancel the number's subscription and refund what was paid.
export async function refundNumber(sub, why) {
  let inv = sub.latest_invoice;
  try { if (typeof inv === "string") inv = await stripe("invoices/" + inv); } catch { inv = null; }
  try { await stripe("subscriptions/" + sub.id, { method: "DELETE" }); } catch (e) { console.error("number refund: cancel failed", sub.id, e.message); }
  const paid = (inv?.amount_paid || 0) / 100;
  if (!paid) return { refunded: false, amount: 0, charged: false };
  let pi = inv.payment_intent, ch = inv.charge;
  if (!pi && !ch) { // newer Stripe API versions list an invoice's payments separately
    const p = (await stripe("invoice_payments", { query: { invoice: inv.id, limit: 1 } }).catch(() => ({}))).data?.[0]?.payment;
    pi = p?.payment_intent; ch = p?.charge;
  }
  pi = pi?.id || pi; ch = ch?.id || ch;
  try {
    if (!pi && !ch) throw new Error("no payment found on " + inv.id);
    await stripe("refunds", { method: "POST", body: { ...(pi ? { payment_intent: pi } : { charge: ch }), reason: "requested_by_customer", metadata: { hp_kind: "number", hp_number: sub.metadata?.hp_number || "", why: String(why || "").slice(0, 200) } } });
    return { refunded: true, amount: paid, charged: true };
  } catch (e) {
    console.error("number refund failed", sub.id, e.message);
    return { refunded: false, amount: paid, charged: true };
  }
}

// Released: stop billing for it (no refund for the rest of the month already paid).
export async function stopNumber(n) {
  if (!n?.billing?.sub) return;
  await stripe("subscriptions/" + n.billing.sub, { method: "DELETE" }).catch((e) => { if (!/No such subscription|canceled/i.test(e.message)) throw e; });
}

// Stripe told us a number's subscription changed: a failed renewal pauses the number, paying again turns it back on.
export async function numberSubChanged(sub) {
  const e = sub.metadata?.hp_number; if (!e) return;
  const { updateJ } = await import("./hp.mjs");
  await updateJ("numbers", "all", (a) => {
    const n = a[e]; if (!n || n.billing?.sub !== sub.id) return undefined;
    n.billing.status = sub.status;
    if (BAD.has(sub.status) && !n.released) { if (!n.paused) n.payPaused = true; n.paused = true; }
    else if (!BAD.has(sub.status) && n.payPaused) { n.paused = false; n.payPaused = false; }
    return a;
  });
}