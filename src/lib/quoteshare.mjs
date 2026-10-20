// Share a saved quote as a private client page.
//  Copying the link is free. Emailing it uses Resend if that's set.
//  Texting it is never automatic: the agent has to send it, and it uses their
//  local number (Twilio/Telnyx carrier rates). Automatic follow-up texts stay
//  on their own off-by-default switch.
//
//   POST /api/quote/share   { leadId, t }           make or reuse a link (sends nothing)
//   GET  /api/quote/p/<token>                       public: the quote (no bank details)
//   POST /api/quote/send    { token, via: email|sms }  only when the agent picks a way
import { getStore, D1, ensureSchema } from "./store.mjs";
import { json, bad, siteUrl, to10, config as loadConfig, isDnc } from "./hp.mjs";
import { requireFeature, userById } from "./auth.mjs";
import { emailOn, sendEmail, layout } from "./email.mjs";
import { sendText } from "./sms.mjs";

const kv = () => getStore("hpd-quote");
const rand = (n) => { const b = crypto.getRandomValues(new Uint8Array(n)); return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const PROD = { FE: "Final expense", MP: "Mortgage protection", IUL: "IUL / cash value", TERM: "Term life" };
const quoteUrl = (token) => `${siteUrl()}/q/${token}`;
const money = (n) => (isFinite(+n) ? "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "");
const hasFeat = (user, k) => !user.access?.features || user.access.features.includes(k);

async function bump(scope, col) {
  await D1().prepare("INSERT INTO colver (scope, col, v) VALUES (?1, ?2, 1) ON CONFLICT(scope, col) DO UPDATE SET v = v + 1").bind(scope, col).run();
}
async function leadDoc(uid, id) {
  const r = await D1().prepare("SELECT data FROM docs WHERE scope=?1 AND col='leads' AND id=?2").bind(uid, id).first();
  return r ? JSON.parse(r.data) : null;
}
async function saveLead(uid, id, lead) {
  lead.updatedAt = Date.now();
  await D1().prepare("UPDATE docs SET data=?3, updated=?4 WHERE scope=?1 AND col='leads' AND id=?2").bind(uid, id, JSON.stringify(lead), lead.updatedAt).run();
  await bump(uid, "leads");
}
async function companyOf() {
  const cfg = await loadConfig().catch(() => ({ settings: {} }));
  return cfg.settings?.company || "Highpoint Financial";
}
async function publicQuote(rec) {
  const lead = await leadDoc(rec.uid, rec.leadId);
  const q = (lead?.quotes || []).find((x) => x.t === rec.t) || rec.quote || {};
  const agent = await userById(rec.uid);
  const first = String(agent?.name || "").split(" ")[0] || "your agent";
  const book = await kvBook(rec.uid);
  return {
    company: await companyOf(),
    agent: { name: agent?.name || "Your agent", first },
    client: { first: String(lead?.first || "").trim() || "there" },
    quote: { product: PROD[q.product] || q.product || "Life insurance", carrier: q.carrier || "", monthly: q.monthly, summary: q.summary || "", exact: !!q.exact, t: q.t || rec.t },
    book,
    disclaimer: "This is a quote your agent prepared. It is not a policy and not a guarantee of approval or price. Your agent will confirm the numbers with the carrier.",
  };
}
async function kvBook(uid) {
  try {
    const s = (await getStore("hpd-book").get("s:" + uid, { type: "json" })) || {};
    if (s.on && s.slug) return { on: true, url: `${siteUrl()}/book/${s.slug}` };
  } catch {}
  return { on: false, url: "" };
}
function pickQuote(lead, t) {
  const list = lead.quotes || [];
  if (!list.length) return null;
  if (t) return list.find((q) => q.t === +t || q.t === t) || null;
  return list[list.length - 1];
}

async function shareRoute(req) {
  const user = await requireFeature(req, "crm", "quoter");
  if (req.method !== "POST") return bad("POST a quote to share", 405);
  const b = await req.json().catch(() => ({}));
  const id = String(b.leadId || "");
  const lead = await leadDoc(user.id, id);
  if (!lead) return bad("Client not found", 404);
  const q = pickQuote(lead, b.t);
  if (!q) return bad("Save a quote to this client first.");
  let token = q.share && (await kv().get("t:" + q.share, { type: "json" }).catch(() => null))?.uid === user.id ? q.share : "";
  if (!token) {
    token = rand(18);
    q.share = token;
    lead.quotes = (lead.quotes || []).map((x) => (x.t === q.t ? { ...x, share: token } : x));
    await saveLead(user.id, id, lead);
    await kv().setJSON("t:" + token, { uid: user.id, leadId: id, t: q.t, quote: { product: q.product, carrier: q.carrier, monthly: q.monthly, summary: q.summary, exact: !!q.exact }, createdAt: Date.now() });
  }
  const phone = to10(lead.phone);
  return json({
    url: quoteUrl(token),
    token,
    canEmail: emailOn() && !!String(lead.email || "").trim(),
    canSms: hasFeat(user, "dialer") && !!phone,
    emailOn: emailOn(),
    hasEmail: !!String(lead.email || "").trim(),
    hasPhone: !!phone,
    first: String(lead.first || "").trim() || "the client",
    quote: { product: q.product, carrier: q.carrier, monthly: q.monthly, summary: q.summary, exact: !!q.exact, t: q.t },
  });
}

async function publicRoute(req, token) {
  await ensureSchema();
  if (!token || token.length < 8) return bad("Quote not found", 404);
  const rec = await kv().get("t:" + token, { type: "json" }).catch(() => null);
  if (!rec) return bad("This quote link isn't valid anymore.", 404);
  return json(await publicQuote(rec));
}

function smsBody({ first, agent, company, url }) {
  let out = `Hi ${first}, this is ${agent} with ${company}. Here's the quote we talked about: ${url}`;
  if (!/\bstop\b/i.test(out)) out += " Reply STOP to opt out.";
  return out.trim();
}

async function sendRoute(req) {
  const user = await requireFeature(req, "crm", "quoter");
  if (req.method !== "POST") return bad("POST to send", 405);
  const b = await req.json().catch(() => ({}));
  const via = String(b.via || "").toLowerCase();
  if (via !== "email" && via !== "sms") return bad("Pick Email or Text. Copying the link is free and doesn't send anything.");
  const token = String(b.token || "");
  const rec = await kv().get("t:" + token, { type: "json" }).catch(() => null);
  if (!rec || rec.uid !== user.id) return bad("Quote not found", 404);
  const lead = await leadDoc(user.id, rec.leadId);
  if (!lead) return bad("Client not found", 404);
  const url = quoteUrl(token);
  const company = await companyOf();
  const agent = String(user.name || "").split(" ")[0] || "your agent";
  const first = String(lead.first || "").trim() || "there";
  const pub = await publicQuote(rec);
  const monthly = money(pub.quote.monthly);

  if (via === "email") {
    if (!emailOn()) return bad("Email isn't set up on this desk (Resend). Copy the link instead.");
    const to = String(lead.email || "").trim();
    if (!to) return bad("This client doesn't have an email. Copy the link or add one.");
    const m = layout({
      title: `${agent} sent you a quote`,
      paras: [
        `Hi ${first},`,
        `${agent} at ${company} prepared a quote for you${pub.quote.carrier ? ` with <b>${pub.quote.carrier}</b>` : ""}${monthly ? ` at <b>${monthly}/month</b>` : ""}.`,
        pub.disclaimer,
      ],
      button: { label: "View your quote", url },
      after: ["This message is not a policy. Reply to your agent with questions."],
    });
    const sent = await sendEmail({ to, subject: `${agent} sent you a quote from ${company}`, ...m });
    if (!sent.ok) return bad(sent.error || "Couldn't send the email.");
    lead.notes = [...(lead.notes || []), { t: Date.now(), text: `Emailed quote link (${pub.quote.carrier || "quote"} ${monthly}/mo)` }];
    await saveLead(user.id, rec.leadId, lead);
    return json({ ok: true, via: "email" });
  }

  if (!hasFeat(user, "dialer")) return bad("Texting is part of the dialer plan. Copy the link instead.");
  const phone = to10(lead.phone);
  if (!phone) return bad("This client doesn't have a phone number.");
  if (await isDnc(phone)) return bad("This number opted out. You can't text it.");
  const body = smsBody({ first, agent, company, url });
  await sendText({ user, to: phone, body, leadId: rec.leadId });
  lead.notes = [...(lead.notes || []), { t: Date.now(), text: `Texted quote link (1 SMS · ${pub.quote.carrier || "quote"} ${monthly}/mo)` }];
  await saveLead(user.id, rec.leadId, lead);
  return json({ ok: true, via: "sms" });
}

export async function quoteRoute(req, parts) {
  const [action, arg] = parts;
  if (action === "p") return publicRoute(req, arg);
  if (action === "share") return shareRoute(req);
  if (action === "send") return sendRoute(req);
  return bad("Not found", 404);
}
