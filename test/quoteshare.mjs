// Quote share: a private client page. Copying the link is free. Texts only go out
// when the agent sends one (carrier rates). Automatic follow-ups stay off by default.
import { DatabaseSync } from "node:sqlite";
const { onRequest } = await import("../functions/api/[[path]].js");
const sql = new DatabaseSync(":memory:");
const norm = (v) => (v instanceof ArrayBuffer ? new Uint8Array(v) : v === undefined ? null : v);
const out = (row) => row && Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Uint8Array ? Array.from(v) : v]));
const stmt = (q, args = []) => ({ bind: (...a) => stmt(q, a.map(norm)), first: async () => out(sql.prepare(q).get(...args)) ?? null, all: async () => ({ results: sql.prepare(q).all(...args).map(out) }), run: async () => { const r = sql.prepare(q).run(...args); return { meta: { changes: r.changes } }; } });
const DB = { prepare: (q) => stmt(q), batch: async (list) => { const r = []; for (const s of list) r.push(await s.run()); return r; } };
const env = { DB, HP_ADMIN_EMAILS: "boss@hp.com", HP_INVITE_CODE: "HP2026", HP_PUBLIC_URL: "https://desk.example.com", TWILIO_ACCOUNT_SID: "AC_test", TWILIO_AUTH_TOKEN: "tok", RESEND_API_KEY: "re_test", HP_EMAIL_FROM: "Highpoint Desk <desk@example.com>" };
const texts = [], emails = [];
globalThis.fetch = async (url, o = {}) => {
  const u = new URL(url);
  if (/Messages\.json$/.test(u.pathname)) { const b = Object.fromEntries(new URLSearchParams(String(o.body))); texts.push(b); return new Response(JSON.stringify({ sid: "SM" + texts.length }), { status: 201, headers: { "content-type": "application/json" } }); }
  if (u.hostname === "api.resend.com") { const b = JSON.parse(o.body || "{}"); emails.push(b); return new Response(JSON.stringify({ id: "em_" + emails.length }), { status: 200, headers: { "content-type": "application/json" } }); }
  return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
};
const jars = {};
async function call(who, path, { method = "GET", body } = {}) {
  const h = {}; if (jars[who]) h.cookie = jars[who];
  let b; if (body !== undefined) { b = JSON.stringify(body); h["content-type"] = "application/json"; }
  const waits = [];
  const r = await onRequest({ request: new Request("https://desk.example.com" + path, { method, headers: h, body: b }), env, waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  const sc = r.headers.get("set-cookie"); if (sc) jars[who] = sc.split(";")[0];
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { s: r.status, j };
}
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) process.exitCode = 1; };

await call("boss", "/api/auth/signup", { method: "POST", body: { email: "boss@hp.com", password: "password2", name: "Boss Lady" } });
await call("rep", "/api/auth/signup", { method: "POST", body: { email: "rep@hp.com", password: "password1", name: "Rita Rep", invite: "HP2026", agree: true } });
const rep = (await call("rep", "/api/auth/me")).j.user;
await call("boss", "/api/dialer/setup", { method: "PUT", body: { settings: { quietHours: { start: 0, end: 24 }, company: "Highpoint Financial" } } });
const { setJ } = await import("../src/lib/hp.mjs");
await setJ("numbers", "all", { "+12125550000": { e164: "+12125550000", areaCode: "212", state: "NY", owner: rep.identity, provider: "twilio" } });
await call("rep", "/api/dialer/sms");

const qt = 1_700_000_000_000;
const lead = {
  first: "Margaret", last: "Lee", phone: "2125550111", email: "margaret@example.com", state: "NY", stage: "contacted",
  quotes: [{ product: "FE", carrier: "Transamerica", monthly: 78.5, summary: "$15,000 level final expense", exact: true, t: qt }],
  app: { routing: "021000021", account: "123456789", bankName: "Chase" },
};
await call("rep", "/api/docs/leads/L1", { method: "PUT", body: lead });

let r = await call("rep", "/api/quote/share", { method: "POST", body: { leadId: "L1", t: qt } });
ok(r.s === 200 && /^https:\/\/desk\.example\.com\/q\/[A-Za-z0-9_-]+$/.test(r.j.url) && r.j.canSms && r.j.canEmail, "sharing a quote makes a private link and says email/text are available: " + r.j.url);
ok(texts.length === 0 && emails.length === 0, "making the link does not send a text or an email");
const { token, url } = r.j;
r = await call("rep", "/api/quote/share", { method: "POST", body: { leadId: "L1", t: qt } });
ok(r.j.token === token, "sharing the same quote again reuses the link");

r = await call(null, "/api/quote/p/" + token);
ok(r.s === 200 && r.j.quote.carrier === "Transamerica" && r.j.quote.monthly === 78.5 && r.j.client.first === "Margaret" && r.j.agent.first === "Rita", "the public page shows the quote and first names");
ok(!r.j.client.last && !JSON.stringify(r.j).includes("021000021") && !JSON.stringify(r.j).includes("123456789") && !JSON.stringify(r.j).includes("margaret@example.com"), "the public page never includes bank details, email, or last name");
ok(/not a policy/i.test(r.j.disclaimer), "the public page says it is not a policy");

r = await call("rep", "/api/quote/send", { method: "POST", body: { token } });
ok(r.s === 400 && /Pick Email or Text/i.test(r.j.error) && texts.length === 0 && emails.length === 0, "send without Email or Text does nothing: " + r.j.error);

r = await call("rep", "/api/quote/send", { method: "POST", body: { token, via: "email" } });
ok(r.s === 200 && r.j.via === "email" && emails.length === 1 && emails[0].to[0] === "margaret@example.com" && emails[0].html.includes(url), "emailing the quote is an explicit send and includes the link");
ok(texts.length === 0, "emailing does not also text");

r = await call("rep", "/api/quote/send", { method: "POST", body: { token, via: "sms" } });
ok(r.s === 200 && r.j.via === "sms" && texts.length === 1 && texts[0].To === "+12125550111" && texts[0].From === "+12125550000", "texting the quote is an explicit send from the agent's local number");
ok(texts[0].Body.includes(url) && /Reply STOP to opt out/i.test(texts[0].Body), "the text includes the link and STOP language: " + texts[0].Body);

const saved = (await call("rep", "/api/docs/leads/L1")).j.data;
ok(saved.notes.some((n) => /Texted quote link \(1 SMS/.test(n.text)) && saved.notes.some((n) => /Emailed quote link/.test(n.text)), "the client file notes that the quote was emailed and texted");

r = await call(null, "/api/quote/p/not-a-real-token");
ok(r.s === 404, "a made-up quote link is not found");
r = await call("rep", "/api/quote/share", { method: "POST", body: { leadId: "nope" } });
ok(r.s === 404, "sharing a missing client fails");

const fu = await call("rep", "/api/followups/settings");
ok(fu.j.settings.on === false, "automatic follow-up texts stay off until the agent turns them on");
