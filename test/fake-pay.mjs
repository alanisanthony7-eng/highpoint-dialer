// Fake Stripe and Telnyx for buying phone numbers: no real card is charged and no real number is ordered.
//  - imported by test/numbers.mjs (installFakes())
//  - or preloaded into the local desk:  npm run local:fakepay   (opens a pretend Stripe card page at /__fake/checkout)
// Cards: "ok" saves a Visa 4242 that pays; "decline" saves a card that is declined when charged.
// Numbers whose last four digits are 0000 fail to order at Telnyx; area code 999 has no numbers.
import http from "node:http";

export const F = { seq: [], stripe: [], telnyx: [], customers: {}, sessions: {}, intents: {}, pms: {}, subs: {}, invoices: {}, refunds: [], prices: [], products: [], hooks: [], ordered: {}, orders: {} };
let n = 0; const id = (p) => `${p}_fake${++n}`;
const flat = (body) => Object.fromEntries(new URLSearchParams(String(body || "")));
const J = (j, s = 200) => new Response(JSON.stringify(j), { status: s, headers: { "content-type": "application/json" } });
const decline = () => J({ error: { type: "card_error", code: "card_declined", decline_code: "generic_decline", message: "Your card was declined." } }, 402);

function stripe(u, o) {
  const p = u.pathname.replace(/^\/v1\//, ""), b = flat(o.body), m = o.method || "GET";
  F.stripe.push([m, p, b]); F.seq.push(`stripe ${m} ${p}`);
  if (p === "prices" && m === "GET") { const key = u.searchParams.get("lookup_keys[0]"); return J({ data: F.prices.filter((x) => x.lookup_key === key && x.active) }); }
  if (p === "prices") { if (b.transfer_lookup_key) F.prices.forEach((x) => { if (x.lookup_key === b.lookup_key) x.lookup_key = null; }); const x = { id: id("price"), product: b.product, unit_amount: +b.unit_amount, currency: b.currency, lookup_key: b.lookup_key, active: true, recurring: { interval: b["recurring[interval]"] }, metadata: { hp_kind: b["metadata[hp_kind]"], hp_plan: b["metadata[hp_plan]"] } }; F.prices.push(x); return J(x); }
  if (p === "products") { const x = { id: id("prod"), name: b.name }; F.products.push(x); return J(x); }
  if (p === "webhook_endpoints") { const x = { id: id("we"), secret: "whsec_test", url: b.url }; F.hooks.push(x); return J(x); }
  if (p === "customers" && m === "POST") { const x = { id: id("cus"), email: b.email, metadata: { hp_user: b["metadata[hp_user]"] }, invoice_settings: {} }; F.customers[x.id] = x; return J(x); }
  const cu = p.match(/^customers\/(.+)$/);
  if (cu) { const c = F.customers[cu[1]]; if (!c) return J({ error: { message: "No such customer" } }, 404); if (m === "POST" && b["invoice_settings[default_payment_method]"]) c.invoice_settings.default_payment_method = b["invoice_settings[default_payment_method]"]; return J(c); }
  if (p === "checkout/sessions" && m === "POST") {
    const sid = id("cs"), origin = new URL(b.success_url || "http://127.0.0.1").origin;
    const x = { id: sid, object: "checkout.session", mode: b.mode, status: "open", customer: b.customer, client_reference_id: b.client_reference_id, metadata: { hp_user: b["metadata[hp_user]"] }, success_url: b.success_url, cancel_url: b.cancel_url, setup_intent: null, url: `${origin}/__fake/checkout?cs=${sid}`, body: b };
    F.sessions[sid] = x; return J(x);
  }
  const cs = p.match(/^checkout\/sessions\/(.+)$/); if (cs) { const s = F.sessions[cs[1]]; return s ? J(s) : J({ error: { message: "No such session" } }, 404); }
  const si = p.match(/^setup_intents\/(.+)$/); if (si) { const x = F.intents[si[1]]; return J(u.searchParams.get("expand[0]") === "payment_method" ? { ...x, payment_method: F.pms[x.payment_method] } : x); }
  const pm = p.match(/^payment_methods\/(.+)$/); if (pm) return J(F.pms[pm[1]]);
  if (p === "subscriptions" && m === "POST") {
    const card = F.pms[b.default_payment_method];
    if (!card || card.customer !== b.customer) return J({ error: { message: "That payment method isn't on this customer" } }, 400);
    if (card.decline) return decline();
    const price = F.prices.find((x) => x.id === b["items[0][price]"]);
    const inv = { id: id("in"), object: "invoice", amount_paid: price?.unit_amount || 0, payment_intent: id("pi"), status: "paid" }; F.invoices[inv.id] = inv;
    const x = { id: id("sub"), object: "subscription", status: "active", customer: b.customer, default_payment_method: b.default_payment_method, metadata: { hp_kind: b["metadata[hp_kind]"], hp_user: b["metadata[hp_user]"], hp_number: b["metadata[hp_number]"] }, items: { data: [{ id: id("si"), price }] }, latest_invoice: b["expand[0]"] === "latest_invoice" ? inv : inv.id, body: b };
    F.subs[x.id] = x; return J(x);
  }
  if (p === "subscriptions" && m === "GET") { const c = u.searchParams.get("customer"); return J({ data: Object.values(F.subs).filter((s) => s.customer === c) }); }
  const sb = p.match(/^subscriptions\/(.+)$/);
  if (sb) { const s = F.subs[sb[1]]; if (!s) return J({ error: { message: "No such subscription" } }, 404); if (m === "DELETE") s.status = "canceled"; return J(s); }
  const iv = p.match(/^invoices\/(.+)$/); if (iv) return J(F.invoices[iv[1]]);
  if (p === "refunds") { const x = { id: id("re"), payment_intent: b.payment_intent, charge: b.charge, status: "succeeded", metadata: b }; F.refunds.push(x); return J(x); }
  if (p === "billing_portal/sessions") return J({ url: "https://billing.stripe.test/portal" });
  return J({});
}

// Stripe finishing a setup-mode Checkout: the card is saved on the customer
export function completeCheckout(sid, kind = "ok") {
  const s = F.sessions[sid]; if (!s) throw new Error("no session " + sid);
  const pmId = id("pm"), siId = id("seti");
  F.pms[pmId] = { id: pmId, object: "payment_method", customer: s.customer, decline: kind === "decline", card: kind === "decline" ? { brand: "visa", last4: "0002", exp_month: 12, exp_year: 2030 } : { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 } };
  F.intents[siId] = { id: siId, object: "setup_intent", status: "succeeded", payment_method: pmId, customer: s.customer };
  Object.assign(s, { status: "complete", setup_intent: siId });
  return s;
}
export const lastSession = () => Object.values(F.sessions).pop();

const avail = (ac, st) => {
  if (ac === "999" || st === "ZZ") return [];
  const area = ac || { FL: "305", TX: "512", NY: "212", CA: "415" }[st] || "305";
  return ["0142", "0188", "0123", "4417", "7720", "0000"].map((x) => `+1${area}555${x}`).filter((e) => !F.ordered[e] || F.ordered[e].released);
};
function telnyx(u, o) {
  const p = u.pathname, m = o.method || "GET"; let body = {}; try { body = o.body ? JSON.parse(String(o.body)) : {}; } catch {}
  F.telnyx.push([m, p, body]); F.seq.push(`telnyx ${m} ${p}`);
  if (p === "/v2/available_phone_numbers") {
    return J({ data: avail(u.searchParams.get("filter[national_destination_code]") || "", u.searchParams.get("filter[administrative_area]") || "").map((e) => ({ phone_number: e, region_information: [{ region_type: "state", region_name: "FL" }, { region_type: "rate_center", region_name: "MIAMI" }], features: [{ name: "voice" }, { name: "sms" }], cost_information: { monthly_cost: "1.00", upfront_cost: "1.00", currency: "USD" } })) });
  }
  if (p === "/v2/number_orders" && m === "POST") {
    const e = body.phone_numbers?.[0]?.phone_number || "";
    if (/0000$/.test(e)) return J({ errors: [{ code: "10015", title: "Number unavailable", detail: "That number is no longer available" }] }, 422);
    const oid = id("ord"); F.orders[oid] = { id: oid, status: "success", e164: e }; F.ordered[e] = { id: id("pn"), e164: e, connection_id: body.connection_id };
    return J({ data: { id: oid, status: "pending" } });
  }
  if (p.startsWith("/v2/number_orders/")) return J({ data: F.orders[p.split("/").pop()] || { status: "failure" } });
  if (p === "/v2/phone_numbers" && m === "GET") { const e = u.searchParams.get("filter[phone_number]"); const x = e ? F.ordered[e] : null; return J({ data: x && !x.released ? [{ id: x.id, phone_number: e, status: "active" }] : e ? [] : Object.values(F.ordered).filter((z) => !z.released).map((z) => ({ id: z.id, phone_number: z.e164 })) }); }
  if (/^\/v2\/phone_numbers\/[^/]+$/.test(p) && m === "DELETE") { const x = Object.values(F.ordered).find((z) => z.id === p.split("/").pop()); if (x) x.released = true; return J({ data: {} }); }
  if (p.startsWith("/v2/phone_numbers/")) return J({ data: { id: p.split("/")[3] } });
  if (p === "/v2/outbound_voice_profiles") return J({ data: [{ id: "ovp1", name: "Default", enabled: true }] });
  if (p === "/v2/credential_connections") return J({ data: m === "POST" ? { id: "conn1" } : [] });
  if (p.startsWith("/v2/credential_connections/")) return J({ data: { id: "conn1" } });
  if (p.startsWith("/v2/call_control_applications")) return J({ data: { id: "app1" } });
  if (p === "/v2/telephony_credentials") return J({ data: { id: "tc1", sip_username: "sipuser" } });
  if (p.endsWith("/token")) return new Response("aaa.bbb.ccc", { status: 200, headers: { "content-type": "text/plain" } });
  if (p === "/v2/messaging_profiles") return J({ data: [{ id: "mp1", name: "Highpoint Desk" }] });
  if (p === "/v2/public_key") return J({ data: { public: "" } });
  return J({ data: {} });
}

export function installFakes(pass) {
  const real = pass || globalThis.fetch;
  globalThis.fetch = async (url, o = {}) => {
    const u = new URL(typeof url === "string" ? url : url.url);
    if (u.host === "api.stripe.com") return stripe(u, o);
    if (u.host === "api.telnyx.com") return telnyx(u, o);
    return real(url, o);
  };
  return F;
}

// Preloaded into test/serve.mjs: fake APIs plus a pretend Stripe Checkout page.
if (process.env.HP_FAKE_PAY === "1" || process.execArgv.some((a) => a.includes("fake-pay"))) {
  installFakes();
  process.env.STRIPE_SECRET_KEY ||= "sk_test_fake";
  process.env.TELNYX_API_KEY ||= "KEY_fake";
  const make = http.createServer;
  http.createServer = (handler) => make(async (req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/__fake/checkout") {
      const s = F.sessions[url.searchParams.get("cs")];
      res.writeHead(s ? 200 : 404, { "content-type": "text/html; charset=utf-8" });
      res.end(s ? `<!doctype html><meta name="viewport" content="width=device-width"><title>Test card (fake Stripe)</title><body style="font:16px system-ui;max-width:460px;margin:60px auto;padding:0 18px"><p style="color:#a00;font-weight:700">FAKE STRIPE · local test only, no real card</p><h1>Add a card</h1><p>Highpoint saves this card for your phone numbers.</p><p><a id="ok" href="/__fake/checkout/done?cs=${s.id}&card=ok">Save Visa ending 4242</a></p><p><a id="dec" href="/__fake/checkout/done?cs=${s.id}&card=decline">Save a card that will be declined (ending 0002)</a></p><p><a id="cancel" href="${s.cancel_url}">Cancel</a></p></body>` : "No such session");
      return;
    }
    if (url.pathname === "/__fake/checkout/done") {
      const s = completeCheckout(url.searchParams.get("cs"), url.searchParams.get("card"));
      res.writeHead(302, { location: s.success_url }); res.end(); return;
    }
    return handler(req, res);
  });
}
