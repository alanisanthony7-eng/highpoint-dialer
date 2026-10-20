// Lead posting URLs — local, with in-memory D1, fake Twilio and a fake DNC scrubbing service.
import { DatabaseSync } from "node:sqlite";
const { onRequest } = await import("../functions/api/[[path]].js");
const sql = new DatabaseSync(":memory:");
const norm = (v) => (v instanceof ArrayBuffer ? new Uint8Array(v) : v === undefined ? null : v);
const out = (row) => row && Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Uint8Array ? Array.from(v) : v]));
const stmt = (q, args = []) => ({ bind: (...a) => stmt(q, a.map(norm)), first: async () => out(sql.prepare(q).get(...args)) ?? null, all: async () => ({ results: sql.prepare(q).all(...args).map(out) }), run: async () => { const r = sql.prepare(q).run(...args); return { meta: { changes: r.changes } }; } });
const DB = { prepare: (q) => stmt(q), batch: async (list) => { const r = []; for (const s of list) r.push(await s.run()); return r; } };
const env = { DB, HP_ADMIN_EMAILS: "boss@hp.com", HP_INVITE_CODE: "HP2026", HP_PUBLIC_URL: "https://desk.example.com", TWILIO_ACCOUNT_SID: "AC_test", TWILIO_AUTH_TOKEN: "tok", BLACKLIST_ALLIANCE_KEY: "bl_test" };
const texts = [], scrubbed = [];
globalThis.fetch = async (url, o = {}) => {
  const u = new URL(url);
  const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
  if (/Messages\.json$/.test(u.pathname)) { texts.push(Object.fromEntries(new URLSearchParams(String(o.body)))); return J({ sid: "SM" + texts.length }, 201); }
  if (u.hostname === "api.blacklistalliance.net") { const p = u.searchParams.get("phone"); scrubbed.push(p); return p === "3055550199" ? J({ message: "Blacklisted", code: ["plaintiff"] }) : J({ message: "Good", code: [] }); }
  return J({});
};
const jars = {};
async function call(who, path, { method = "GET", body, raw, type } = {}) {
  const h = {}; if (who && jars[who]) h.cookie = jars[who];
  let b; if (raw !== undefined) { b = raw; if (type) h["content-type"] = type; } else if (body !== undefined) { b = JSON.stringify(body); h["content-type"] = "application/json"; }
  const waits = [];
  const r = await onRequest({ request: new Request("https://desk.example.com" + path, { method, headers: h, body: b, redirect: "manual" }), env, waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  const sc = r.headers.get("set-cookie"); if (sc && who) jars[who] = sc.split(";")[0];
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { s: r.status, j, h: r.headers };
}
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) process.exitCode = 1; };
const leadsOf = (uid) => sql.prepare("SELECT id, data FROM docs WHERE scope=? AND col='leads'").all(uid).map((r) => ({ id: r.id, ...JSON.parse(r.data) }));
const post = (token, o) => call(null, "/api/leads/in/" + token, { method: "POST", ...o });

await call("boss", "/api/auth/signup", { method: "POST", body: { email: "boss@hp.com", password: "password2", name: "Boss Lady" } });
await call("rep", "/api/auth/signup", { method: "POST", body: { email: "rep@hp.com", password: "password1", name: "Rita Rep", invite: "HP2026", agree: true } });
await call("rep2", "/api/auth/signup", { method: "POST", body: { email: "rep2@hp.com", password: "password3", name: "Sam Seller", invite: "HP2026", agree: true } });
const rep = (await call("rep", "/api/auth/me")).j.user, rep2 = (await call("rep2", "/api/auth/me")).j.user;
await call("boss", "/api/dialer/setup", { method: "PUT", body: { settings: { quietHours: { start: 0, end: 24 }, company: "Highpoint Financial" } } });

// make a URL
let r = await call("rep", "/api/leads/urls", { method: "POST", body: { op: "create", name: "EverQuote FEX", product: "FE", stage: "new" } });
const u1 = r.j.url, token = u1.url.split("/").pop();
ok(r.s === 200 && u1.url.startsWith("https://desk.example.com/api/leads/in/") && token.length >= 30 && u1.name === "EverQuote FEX", "an agent makes a secret posting URL: " + u1.url);
r = await call(null, "/api/leads/in/" + token);
ok(r.s === 200 && r.j.status === "ready" && /Rita Rep/.test(r.j.message), "a vendor's test ping to the URL says it's working");
r = await call(null, "/api/leads/in/" + token, { method: "OPTIONS" });
ok(r.s === 204 && r.h.get("access-control-allow-origin") === "*", "website forms can post to it from a browser (CORS)");

// JSON in a typical vendor shape
r = await post(token, { body: { first_name: "MARGARET", last_name: "lee", phone_number: "(212) 555-0142", email: "Margaret@Example.com", state: "New York", zip: "10001", dob: "04/12/1958", coverage_amount: "15000", gender: "F", xxTrustedFormCertUrl: "https://cert.trustedform.com/abc123", jornaya_leadid: "J-LEAD-1", tcpa_consent: "I agree to be contacted", comments: "Wants a call after 5" } });
ok(r.s === 200 && r.j.success && r.j.status === "added" && r.j.id, "a JSON post is added: " + JSON.stringify(r.j));
let L = leadsOf(rep.id).find((x) => x.id === r.j.id);
ok(L && L.first === "Margaret" && L.last === "Lee" && L.phone === "2125550142" && L.email === "margaret@example.com" && L.state === "NY" && L.zip === "10001", "fields are mapped and cleaned (names, phone, email, state name → NY)");
ok(L.age >= 67 && L.age <= 69 && L.product === "FE" && L.stage === "new" && L.source === "EverQuote FEX" && L.callCount === 0 && L.createdAt > 0, "age comes from the birthday; the URL sets product, stage and source");
ok(L.fields?.coverage_amount === "15000" && L.fields?.gender === "F", "fields we don't have a column for are kept on the lead");
ok(L.consent?.trustedForm === "https://cert.trustedform.com/abc123" && L.consent?.jornaya === "J-LEAD-1" && /agree/.test(L.consent?.consentText), "TrustedForm, Jornaya and consent language are saved for compliance");
ok(L.notes?.length === 2 && /Posted by EverQuote FEX/.test(L.notes[0].text) && L.notes[1].text === "Wants a call after 5", "comments become a note");
ok(scrubbed.includes("2125550142") && L.scrub?.status === "good" && !L.scrub.blocked, "the number is scrubbed against the DNC and litigator lists on arrival");
ok(sql.prepare("SELECT v FROM colver WHERE scope=? AND col='leads'").get(rep.id)?.v >= 1, "the CRM's version bumps, so open desks pick the lead up");

// duplicates
r = await post(token, { body: { name: "Margaret Lee", phone: "1-212-555-0142", comments: "second request" } });
ok(r.s === 200 && r.j.success === false && r.j.status === "duplicate" && r.j.id === L.id, "the same phone again is reported as a duplicate");
L = leadsOf(rep.id).find((x) => x.id === L.id);
ok(leadsOf(rep.id).length === 1 && /Posted again by EverQuote FEX: second request/.test(L.notes.at(-1).text), "no second client; a note goes on the existing one");

// form posts, XML, query strings, batches
r = await post(token, { raw: new URLSearchParams({ FirstName: "Earl", LastName: "Jones", Phone: "305 555 0100", State: "fl", Age: "71" }).toString(), type: "application/x-www-form-urlencoded" });
L = leadsOf(rep.id).find((x) => x.id === r.j.id);
ok(r.j.status === "added" && L.first === "Earl" && L.phone === "3055550100" && L.state === "FL" && L.age === 71, "form posts work");
r = await post(token, { raw: `<?xml version="1.0"?><lead><contact><first_name>Ruth</first_name><last_name>Ann</last_name></contact><home_phone>4045550123</home_phone><state>GA</state><notes><![CDATA[Diabetic & on metformin]]></notes></lead>`, type: "text/xml" });
L = leadsOf(rep.id).find((x) => x.id === r.j.id);
ok(r.j.status === "added" && L.first === "Ruth" && L.phone === "4045550123" && L.notes[1].text === "Diabetic & on metformin", "XML posts work (alt phone is used when it's the only one)");
r = await call(null, `/api/leads/in/${token}?fname=Gus&lname=Grant&cell=6155550111&st=TN`);
ok(r.j.status === "added" && leadsOf(rep.id).some((x) => x.first === "Gus" && x.phone === "6155550111"), "GET with a query string works too");
r = await post(token, { body: { campaign: "MP Oct", leads: [{ first: "Ann", phone: "7135550101", mortgage_amount: "$212,000" }, { first: "Bo", phone: "123" }, { first: "Cy", phone: "7135550102", product: "mortgage protection" }] } });
ok(r.s === 200 && r.j.added === 2 && r.j.rejected === 1 && /isn't a valid US phone/.test(r.j.results[1].error), "a batch reports added and rejected leads: " + JSON.stringify(r.j.results.map((x) => x.status)));
L = leadsOf(rep.id).find((x) => x.first === "Ann");
ok(L.mortgageBalance === 212000 && L.product === "MP", "money fields become numbers; the product comes from the lead when it says");
r = await post(token, { body: { first_name: "No", last_name: "Phone" } });
ok(r.s === 400 && r.j.status === "rejected" && /phone number/.test(r.j.error), "a lead with no way to reach them is rejected with a reason");
r = await post(token, { raw: "{bad json", type: "application/json" });
ok(r.s === 400 && /JSON couldn't be read/.test(r.j.error), "broken JSON gets a clear error");

// flagged numbers
r = await post(token, { body: { first_name: "Larry", last_name: "Litigator", phone: "3055550199" } });
L = leadsOf(rep.id).find((x) => x.id === r.j.id);
ok(r.j.status === "added" && r.j.flagged === "litigator" && L.scrub?.blocked === true, "a known TCPA litigator is saved but flagged, so it can't be dialed");

// website form with a thank-you page
r = await post(token, { raw: new URLSearchParams({ name: "Wendy Web", phone: "9045550111", _redirect: "https://example.com/thanks" }).toString(), type: "application/x-www-form-urlencoded" });
ok(r.s === 303 && r.h.get("location") === "https://example.com/thanks" && leadsOf(rep.id).some((x) => x.first === "Wendy"), "a website form can send the visitor to a thank-you page");

// log and management
r = await call("rep", "/api/leads/urls");
ok(r.j.urls.length === 1 && r.j.urls[0].count === 8 && r.j.urls[0].last > 0, "the URL counts its leads (" + r.j.urls[0].count + ")");
const st = r.j.log.map((x) => x.status);
ok(st.includes("added") && st.includes("duplicate") && st.includes("rejected") && r.j.log.find((x) => x.status === "rejected" && x.keys?.includes("first_name")), "recent arrivals show added, duplicate and rejected posts (with the field names sent)");
r = await call("rep", "/api/leads/test", { method: "POST", body: { id: u1.id } });
L = leadsOf(rep.id).find((x) => x.id === r.j.result.id);
ok(r.j.result.status === "added" && L.posted?.test && /\(test\)$/.test(L.source), "Send a test lead puts a sample lead in the CRM");
r = await call("rep2", "/api/leads/urls", { method: "POST", body: { op: "update", id: u1.id, name: "Mine now" } });
ok(r.s === 404, "other agents can't change your URL");
r = await call("rep", "/api/leads/urls", { method: "POST", body: { op: "update", id: u1.id, on: false } });
ok(r.j.url.on === false && (await post(token, { body: { name: "Paused Pat", phone: "2125550177" } })).s === 403, "a paused URL turns leads away");
await call("rep", "/api/leads/urls", { method: "POST", body: { op: "update", id: u1.id, on: true } });
r = await call("rep", "/api/leads/urls", { method: "POST", body: { op: "rotate", id: u1.id } });
const token2 = r.j.url.url.split("/").pop();
ok(token2 !== token && (await post(token, { body: { name: "Old Url", phone: "2125550178" } })).s === 404 && (await post(token2, { body: { name: "New Url", phone: "2125550178" } })).j.status === "added", "a new secret URL replaces the old one right away");
ok((await call(null, "/api/leads/in/nope")).s === 404, "a made-up URL is refused");

// round robin (admins)
r = await call("rep", "/api/leads/urls", { method: "POST", body: { op: "create", name: "Team", assign: "rr", agents: [rep.id, rep2.id] } });
ok(r.s === 403, "only admins can hand leads out round robin");
r = await call("boss", "/api/leads/urls");
ok(r.j.admin && r.j.agents.some((a) => a.id === rep2.id), "admins see the team's agents to pick from");
r = await call("boss", "/api/leads/urls", { method: "POST", body: { op: "create", name: "Agency FEX", product: "FE", assign: "rr", agents: [rep.id, rep2.id] } });
const rr = r.j.url.url.split("/").pop();
const a1 = await post(rr, { body: { name: "Rr One", phone: "8135550101" } }), a2 = await post(rr, { body: { name: "Rr Two", phone: "8135550102" } }), a3 = await post(rr, { body: { name: "Rr Three", phone: "8135550103" } });
const who = (id) => (leadsOf(rep.id).some((x) => x.id === id) ? "rep" : leadsOf(rep2.id).some((x) => x.id === id) ? "rep2" : "?");
ok(who(a1.j.id) === "rep" && who(a2.j.id) === "rep2" && who(a3.j.id) === "rep", "team leads alternate between the agents: " + [a1, a2, a3].map((x) => who(x.j.id)).join(", "));
ok(/round robin to Sam Seller/.test(leadsOf(rep2.id).find((x) => x.id === a2.j.id).notes[0].text), "the note says who it went to");
ok((await post(rr, { body: { name: "Rr One Again", phone: "8135550101" } })).j.status === "duplicate", "a team lead that's already with one of the agents is a duplicate");
r = await call("boss", "/api/leads/urls");
ok(r.j.log.filter((x) => x.urlId === r.j.urls[0].id && x.status === "added").length === 3 && r.j.log.some((x) => x.to === "Sam Seller"), "the admin's log shows where each team lead went");
ok((await call("rep2", "/api/leads/urls")).j.log.some((x) => x.name === "Rr Two"), "the agent who got it sees it too");

// a "new lead" text right away
const { setJ } = await import("../src/lib/hp.mjs");
await setJ("numbers", "all", { "+12125550000": { e164: "+12125550000", areaCode: "212", state: "NY", owner: rep.identity, provider: "twilio" } });
await call("rep", "/api/dialer/sms");
r = await call("rep", "/api/followups/settings", { method: "POST", body: { on: true, newLead: { on: true } } });
ok(r.j.settings.newLead.on && r.j.settings.noAnswer.on, "agents can turn on a text for new posted leads");
r = await post(token2, { body: { first_name: "Hannah", last_name: "Hot", phone: "2125550188", state: "NY" } });
ok(r.j.status === "added" && r.j.texting, "the post says a text is on the way");
ok(texts.length === 1 && texts[0].To === "+12125550188" && /^Hi Hannah, this is Rita with Highpoint Financial\. I just got your request/.test(texts[0].Body) && /Reply STOP to opt out\.$/.test(texts[0].Body), "the text goes out within the same request: " + texts[0]?.Body);
r = await post(token2, { body: { first_name: "Lit", last_name: "Again", phone: "3055550199" } });
ok(r.j.status === "duplicate" && texts.length === 1, "no text for duplicates");
await call("rep", "/api/leads/urls", { method: "POST", body: { op: "delete", id: u1.id } });
ok((await call("rep", "/api/leads/urls")).j.urls.length === 0 && (await post(token2, { body: { name: "Gone", phone: "2125550199" } })).s === 404, "deleting a URL stops it");

const { toLead } = await import("../src/lib/leadpost.mjs");
const t = toLead({ applicant: { FirstName: "Mae", "Last-Name": "West", MobilePhone: "+1 (727) 555-0100" }, insured_dob: "1950-02-03", Coverage: "10k" }).lead;
ok(t.first === "Mae" && t.last === "West" && t.phone === "7275550100" && t.dob === "1950-02-03" && t.age > 70 && t.fields["Coverage"] === "10k", "nested and prefixed field names are recognized");
