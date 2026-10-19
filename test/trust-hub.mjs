// Trust Hub (Telnyx) on the server: business profile → Telnyx enterprise, caller name on every number,
// Free Caller Registry flag, Number Reputation (terms, letter, upload, numbers, scores), and how spam
// risk feeds number health and caller-ID rotation. Run: node test/trust-hub.mjs
import { DatabaseSync } from "node:sqlite";
import { onRequest } from "../functions/api/[[path]].js";
import { getJ, setJ, pickCallerId, config as loadConfig } from "../src/lib/hp.mjs";

const sql = new DatabaseSync(":memory:");
const norm = (v) => (v instanceof ArrayBuffer ? new Uint8Array(v) : v === undefined ? null : v);
const out = (row) => row && Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Uint8Array ? Array.from(v) : v]));
const stmt = (q, args = []) => ({
  bind: (...a) => stmt(q, a.map(norm)),
  first: async () => out(sql.prepare(q).get(...args)) ?? null,
  all: async () => ({ results: sql.prepare(q).all(...args).map(out) }),
  run: async () => { const r = sql.prepare(q).run(...args); return { meta: { changes: r.changes } }; },
});
const DB = { prepare: (q) => stmt(q), batch: async (list) => Promise.all(list.map((s) => s.run())) };
const env = { DB, HP_ADMIN_EMAILS: "boss@hp.com", HP_INVITE_CODE: "HP2026", HP_PUBLIC_URL: "https://desk.example.com", TELNYX_API_KEY: "KEY_test" };

// Fake Telnyx
const telnyx = [];
let monitored = [], scores = {}, FAIL_DOC = false;
globalThis.fetch = async (url, o = {}) => {
  const u = new URL(url);
  const J = (j, st = 200) => new Response(JSON.stringify(j), { status: st, headers: { "content-type": "application/json" } });
  if (u.hostname !== "api.telnyx.com") return J({}, 500);
  const m = o.method || "GET", p = u.pathname;
  const body = o.body instanceof FormData ? { form: [...o.body.keys()], file: o.body.get("file") } : o.body ? JSON.parse(o.body) : undefined;
  telnyx.push({ method: m, path: p, body, query: Object.fromEntries(u.searchParams) });
  if (p === "/v2/enterprises" && m === "POST") return J({ data: { id: "ent1", ...body } }, 201);
  if (p === "/v2/enterprises/ent1" && m === "PUT") return J({ data: { id: "ent1" } });
  if (p === "/v2/terms_of_service/status") return J({ data: { agreed: telnyx.some((x) => x.path.endsWith("/number_reputation/agree")) } });
  if (p === "/v2/terms_of_service/number_reputation/agree") return J({ data: { agreed: true } });
  if (p === "/v2/enterprises/ent1/reputation/loa" && m === "POST") return new Response("%PDF-1.4 letter for ent1", { headers: { "content-type": "application/pdf" } });
  if (p === "/v2/documents" && m === "POST") return FAIL_DOC ? J({ errors: [{ detail: "bad file" }] }, 422) : J({ data: { id: "doc1" } });
  if (p === "/v2/enterprises/ent1/reputation" && m === "POST") return J({ data: { status: "pending", loa_status: "pending" } });
  if (p === "/v2/enterprises/ent1/reputation" && m === "GET") return telnyx.some((x) => x.path === "/v2/enterprises/ent1/reputation" && x.method === "POST") ? J({ data: { status: "approved", loa_status: "approved" } }) : J({ errors: [{ detail: "Not found" }] }, 404);
  if (p === "/v2/enterprises/ent1/reputation/numbers" && m === "POST") { monitored.push(...body.phone_numbers); return J({ data: body.phone_numbers.map((n) => ({ phone_number: n })) }); }
  if (p === "/v2/enterprises/ent1/reputation/numbers" && m === "GET") return J({ data: monitored.map((n) => ({ phone_number: n, reputation_data: scores[n] || null })) });
  if (/^\/v2\/phone_numbers\/[^/]+\/voice$/.test(p) && m === "PATCH") return p.includes("pnBad") ? J({ errors: [{ detail: "CNAM not available" }] }, 422) : J({ data: {} });
  return J({ data: {} });
};

const jars = {};
async function call(who, path, { method = "GET", body, raw, type } = {}) {
  const h = {}; if (jars[who]) h.cookie = jars[who];
  let b; if (body !== undefined) { b = JSON.stringify(body); h["content-type"] = "application/json"; }
  if (raw !== undefined) { b = raw; h["content-type"] = type || "application/pdf"; }
  const r = await onRequest({ request: new Request("https://desk.example.com" + path, { method, headers: h, body: b }), env, waitUntil: () => {} });
  const sc = r.headers.get("set-cookie"); if (sc) jars[who] = sc.split(";")[0];
  const ct = r.headers.get("content-type") || "";
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { s: r.status, j, ct, cd: r.headers.get("content-disposition") || "" };
}
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) process.exitCode = 1; };
const last = (path, method) => telnyx.filter((x) => x.path === path && (!method || x.method === method)).at(-1);

await call("boss", "/api/auth/signup", { method: "POST", body: { email: "boss@hp.com", password: "password2", name: "Boss" } });
await call("rep", "/api/auth/signup", { method: "POST", body: { email: "rep@hp.com", password: "password1", name: "Rep", invite: "HP2026", agree: true } });
await setJ("numbers", "all", {
  "+13055550101": { e164: "+13055550101", provider: "telnyx", sid: "pn1", areaCode: "305", state: "FL" },
  "+13055550102": { e164: "+13055550102", provider: "telnyx", sid: "pn2", areaCode: "305", state: "FL" },
  "+13055550103": { e164: "+13055550103", provider: "telnyx", sid: "pnBad", areaCode: "305", state: "FL" },
  "+13055550199": { e164: "+13055550199", provider: "telnyx", sid: "pnOld", released: true },
});

// ---- access ----
ok((await call("rep", "/api/telnyx/trust")).s === 403, "agents can't open the Trust Hub");
ok((await call("x", "/api/telnyx/trust")).s === 401, "signed-out visitors can't either");

// ---- business profile ----
let r = await call("boss", "/api/telnyx/trust-profile", { method: "POST", body: { legalName: "HP", ein: "123" } });
ok(r.s === 400 && /legal business name/.test(r.j.error) && /EIN/.test(r.j.error) && r.j.missing.length >= 5, "an incomplete profile says exactly what's missing");
ok(!telnyx.some((x) => x.path === "/v2/enterprises"), "nothing is sent to Telnyx until the profile is complete");
const profile = { legalName: "Highpoint Financial LLC", dba: "Highpoint Financial", ein: "123456789", website: "highpointfinancial.com", legalType: "llc", employees: "11-50", incState: "Florida",
  street: "100 Biscayne Blvd", suite: "Suite 400", city: "Miami", state: "fl", zip: "33132", first: "Alanis", last: "Anthony", title: "Owner", email: "Owner@HighpointFinancial.com", phone: "(305) 555-0100" };
r = await call("boss", "/api/telnyx/trust-profile", { method: "POST", body: profile });
ok(r.s === 200 && r.j.enterpriseId === "ent1", "a complete profile registers the business with Telnyx");
const ent = last("/v2/enterprises", "POST")?.body || {};
ok(ent.fein === "12-3456789" && ent.website === "https://highpointfinancial.com" && ent.country_code === "US", "EIN, website and country are sent in Telnyx's format");
ok(ent.industry === "insurance" && ent.organization_type === "commercial" && ent.organization_legal_type === "llc" && ent.number_of_employees === "11-50", "business type, industry and size use Telnyx's values");
ok(ent.organization_contact?.phone_number === "+13055550100" && ent.organization_contact?.job_title === "Owner" && ent.billing_contact?.email === "owner@highpointfinancial.com", "the contact is sent as both organization and billing contact");
ok(ent.organization_physical_address?.administrative_area === "FL" && ent.billing_address?.extended_address === "Suite 400", "the address is sent as both physical and billing address");
r = await call("boss", "/api/telnyx/trust-profile", { method: "POST", body: { ...profile, employees: "51-200" } });
const put = last("/v2/enterprises/ent1", "PUT")?.body || {};
ok(r.s === 200 && put.number_of_employees === "51-200" && !("country_code" in put), "saving again updates the same registration without the fixed country field");

// ---- caller name ----
ok((await call("boss", "/api/telnyx/trust-cnam", { method: "POST", body: { name: "Highpoint Financial!" } })).s === 400, "a caller name over 15 characters or with symbols is refused");
r = await call("boss", "/api/telnyx/trust-cnam", { method: "POST", body: { name: "Highpoint Fin" } });
ok(r.s === 200 && r.j.set === 2 && r.j.failed["+13055550103"], "the caller name is set on every number and failures are reported per number");
ok(last("/v2/phone_numbers/pn1/voice", "PATCH")?.body?.cnam_listing?.cnam_listing_details === "HIGHPOINT FIN", "each number gets the name in capitals");
ok(!telnyx.some((x) => x.path === "/v2/phone_numbers/pnOld/voice"), "released numbers are left alone");

// ---- Free Caller Registry ----
ok((await call("boss", "/api/telnyx/trust-fcr", { method: "POST", body: { done: true } })).j.done === true, "the registry can be marked as submitted");

// ---- Number Reputation ----
let st = (await call("boss", "/api/telnyx/trust")).j;
ok(st.enterpriseId === "ent1" && st.repLive === null && st.tosOk === false && st.fcrAt && st.cnam?.name === "HIGHPOINT FIN", "status shows the registration, caller name, registry and that monitoring is off");
ok(st.stir.owned === 3 && st.numbers.length === 3, "status lists the 3 active numbers (released ones are left out)");
ok((await call("boss", "/api/telnyx/trust-tos", { method: "POST" })).s === 200 && (await call("boss", "/api/telnyx/trust")).j.tosOk === true, "accepting Telnyx's terms is recorded");
r = await call("boss", "/api/telnyx/trust-loa");
ok(r.s === 200 && /pdf/.test(r.ct) && /attachment/.test(r.cd) && /^%PDF/.test(r.j), "the letter of authorization downloads as a PDF");
ok((await call("boss", "/api/telnyx/trust-enable", { method: "POST", raw: "hello", type: "text/plain" })).s === 400, "a file that isn't a PDF is refused");
FAIL_DOC = true;
r = await call("boss", "/api/telnyx/trust-enable", { method: "POST", raw: "%PDF-1.4 signed" });
ok(r.s === 400 && /couldn't take the letter/.test(r.j.error) && !last("/v2/enterprises/ent1/reputation", "POST"), "if Telnyx refuses the upload, monitoring isn't turned on");
FAIL_DOC = false;
r = await call("boss", "/api/telnyx/trust-enable", { method: "POST", raw: "%PDF-1.4 signed" });
ok(r.s === 200 && last("/v2/documents", "POST")?.body?.form?.includes("file"), "the signed letter is uploaded to Telnyx as a file");
ok(last("/v2/enterprises/ent1/reputation", "POST")?.body?.loa_document_id === "doc1", "monitoring is turned on with the uploaded letter");
r = await call("boss", "/api/telnyx/trust-numbers", { method: "POST" });
ok(r.j.added === 3 && monitored.length === 3, "all active numbers are added to monitoring");
r = await call("boss", "/api/telnyx/trust-numbers", { method: "POST" });
ok(r.j.added === 0 && r.j.already === 3, "adding again doesn't send duplicates");

// ---- scores feed health and caller-ID rotation ----
scores = { "+13055550101": { spam_risk: "high", spam_category: "Telemarketer", maturity_score: 40, connection_score: 20, engagement_score: 30, sentiment_score: 10, last_refreshed_at: "2026-10-19T18:00:00Z" }, "+13055550102": { spam_risk: "low", maturity_score: 80 } };
ok((await call("boss", "/api/telnyx/trust-sync", { method: "POST" })).j.numbers === 3, "scores are pulled for every monitored number");
const list = (await call("boss", "/api/dialer/numbers")).j.numbers;
const n1 = list.find((n) => n.e164 === "+13055550101"), n2 = list.find((n) => n.e164 === "+13055550102");
ok(n1.health.status === "flagged" && /high spam risk as telemarketer/.test(n1.health.why[0]) && n1.health.reputation.scores.connection === 20, "a high-risk number shows Flagged, with the reason and scores");
ok(n2.health.status === "healthy" && n2.health.reputation.risk === "low", "a low-risk number stays Healthy");
ok((await getJ("numbers", "all"))["+13055550101"].health === "flagged", "the high-risk number is marked flagged");
const me = (await call("boss", "/api/auth/me")).j.user;
const pick = await pickCallerId(me, "3055551234", { ...(await loadConfig()).settings, sharedPool: true, localPresence: true });
ok(pick && pick.e164 !== "+13055550101", "caller-ID rotation skips the high-risk number");
scores["+13055550101"] = { spam_risk: "low" };
await call("boss", "/api/telnyx/trust-sync", { method: "POST" });
ok(!(await getJ("numbers", "all"))["+13055550101"].health, "once carriers rate it low again, the flag comes off");
st = (await call("boss", "/api/telnyx/trust")).j;
ok(st.repLive?.status === "approved" && st.numbers.find((n) => n.e164 === "+13055550101")?.rep?.spam_risk === "low", "the Trust Hub shows monitoring approved and each number's latest rating");

// ---- once monitoring is on, the fields Telnyx locks aren't sent ----
await call("boss", "/api/telnyx/trust-profile", { method: "POST", body: { ...profile, title: "CEO" } });
const put2 = last("/v2/enterprises/ent1", "PUT")?.body || {};
ok(put2.organization_contact?.job_title === "CEO" && !("legal_name" in put2) && !("fein" in put2) && !("website" in put2), "after monitoring starts, legal name, EIN and website are left out of updates");

console.log("done");
